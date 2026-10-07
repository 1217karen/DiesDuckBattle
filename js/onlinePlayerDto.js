import { battlerNameError } from "./nameValidation.js";
import { presentationTextIssues } from "./profileTextValidation.js";
import { migratePlayerBuild } from "./playerBuildMigration.js";
import { clonePlayerBuild, createEmptyPlayerBuild } from "./playerBuildModel.js";
import { PLAYER_PRESENTATION_SCHEMA_VERSION, normalizePlayerPresentation, createEmptyPlayerPresentation, QUOTE_PATHS, QUOTE_TEXT_MAX, presentationForPersistence } from "./playerPresentationModel.js";
import { normalizePlayerPublicSettings } from "./playerPublicSettingsModel.js";

export const isOnlineUuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const requireValue = value => { if (!value) throw new TypeError("Invalid online data"); };
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { requireValue(Number.isFinite(value)); return JSON.stringify(value); }
  requireValue(object(value) || Array.isArray(value));
  requireValue(Object.getOwnPropertySymbols(value).length === 0);
  if (Array.isArray(value)) { requireValue(Object.keys(value).length === value.length); return "[" + value.map(canonical).join(",") + "]"; }
  requireValue([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  return "{" + Object.keys(value).sort().map(key => {
    const d = Object.getOwnPropertyDescriptor(value, key); requireValue(Object.hasOwn(d, "value"));
    return JSON.stringify(key) + ":" + canonical(d.value);
  }).join(",") + "}";
}
const same = (a, b) => canonical(a) === canonical(b);
const keys = (value, names) => requireValue(object(value) && same(Object.keys(value).sort(), [...names].sort()));

// The only v1 presentation compatibility addition: missing cutinUrl on old icon objects.
// Preserve unknown/malformed fields so canonical validation still rejects lossy data.
const upgradeDuckDisplay = value => object(value) && same(Object.keys(value), ["iconUrl"]) && typeof value.iconUrl === "string"
  ? { ...value, cutinUrl: "" } : value;
const upgradeDuckDisplays = values => object(values)
  ? Object.fromEntries(Object.entries(values).map(([id, value]) => [id, upgradeDuckDisplay(value)])) : values;


/** Check each version in its original shape before migrating; never discard unknown data. */
export function migrateOnlinePlayerPresentation(value) {
  requireValue(object(value) && [1, 2, 3, 4, 5].includes(value.schemaVersion));
  const normalized = normalizePlayerPresentation(value);
  const expected = structuredClone(normalized);
  expected.schemaVersion = value.schemaVersion;
  if (value.schemaVersion < 5) { delete expected.battler.profile.message; delete expected.battler.profile.messageTail; }
  if (value.schemaVersion < 4) delete expected.battler.profile.showBestStreak;
  if (value.schemaVersion < 3) {
    expected.schemaVersion = value.schemaVersion;
    for (const path of QUOTE_PATHS) {
      const parent = path.slice(0, -1).reduce((v, k) => v[k], expected.battler.quotes);
      const line = parent[path.at(-1)].lines[0];
      parent[path.at(-1)] = { text: line.text, iconSlot: line.iconSlot };
    }
    if (value.schemaVersion === 1) {
      delete expected.battler.profile;
      for (const duck of Object.values(expected.ducks)) delete duck.profile;
    }
  }
  requireValue(same(expected, value.schemaVersion === 1 ? { ...value, ducks: upgradeDuckDisplays(value.ducks) } : value));
  // Legacy text is preserved on load, including historical values longer than the new limit.
  if (value.schemaVersion >= 3) for (const path of QUOTE_PATHS) {
    const timing = path.reduce((v, k) => v[k], normalized.battler.quotes);
    requireValue(timing.lines.every(line => [...line.text].length <= QUOTE_TEXT_MAX));
  }
  return normalized;
}

// Validate persistence shape, not battle readiness. Never read local storage/catalogs.
export function encodeOnlinePlayer(data) { return encodePlayerData(data, true); }
function encodePlayerData(data, forSave) {
  keys(data, ["build", "presentation", "publicSettings", "battlerName"]);
  requireValue(data.build.schemaVersion === 3 && typeof data.battlerName === "string");
  const build = clonePlayerBuild(data.build, { allowOverlongText: !forSave });
  if (forSave) requireValue(!battlerNameError(data.battlerName));
  requireValue(build.ducks.every(d => isOnlineUuid(d.id)));
  const presentation = presentationForPersistence(migrateOnlinePlayerPresentation(data.presentation));
  for (const path of QUOTE_PATHS) requireValue(path.reduce((v,k) => v[k], presentation.battler.quotes).lines.every(line => [...line.text].length <= QUOTE_TEXT_MAX));
  if (forSave) requireValue(presentationTextIssues(presentation).length === 0);
  const settings = normalizePlayerPublicSettings(data.publicSettings);
  requireValue(same(settings, data.publicSettings));
  const ids = new Set(build.ducks.map(d => d.id));
  requireValue(settings.publicDuckId === null || ids.has(settings.publicDuckId));
  // Existing display editor permits icons for Ducks absent from the battle build.
  const detachedDuckPresentation = Object.fromEntries(Object.entries(presentation.ducks).filter(([id]) => !ids.has(id)));
  return {
    dtoVersion: 1,
    battler: {
      build: { schemaVersion: 3, ...build.battler },
      presentation: { schemaVersion: PLAYER_PRESENTATION_SCHEMA_VERSION, name: data.battlerName, ...presentation.battler, detachedDuckPresentation },
    },
    ducks: build.ducks.map(({ id, name, ...fields }) => ({ id,
      build: { schemaVersion: 3, ...fields },
      presentation: { schemaVersion: PLAYER_PRESENTATION_SCHEMA_VERSION, name, icon: presentation.ducks[id] ?? null },
    })),
    publicDuckId: settings.publicDuckId,
  };
}

export function decodeOnlinePlayer(snapshot) {
  requireValue(object(snapshot) && Array.isArray(snapshot.ducks) && object(snapshot.battler));
  // Validate each stored presentation version independently, including detached Ducks.
  let b = snapshot.battler;
  // Only the documented registration shape is treated as empty, without writing it back.
  if (same(b.build, {}) && same(Object.keys(b.presentation).sort(), ["name"]) && typeof b.presentation.name === "string"
    && snapshot.ducks.length === 0 && snapshot.publicDuckId === null) {
    return { build: createEmptyPlayerBuild(), presentation: createEmptyPlayerPresentation(),
      publicSettings: { schemaVersion: 1, publicDuckId: null }, battlerName: b.presentation.name };
  }
  requireValue(object(b.presentation));
  const { schemaVersion: version, name: storedName, detachedDuckPresentation: detached, ...storedDisplay } = b.presentation;
  const migratedDisplay = migrateOnlinePlayerPresentation({ schemaVersion: version, battler: storedDisplay, ducks: detached });
  b = { ...b, presentation: { schemaVersion: PLAYER_PRESENTATION_SCHEMA_VERSION, name: storedName, ...migratedDisplay.battler, detachedDuckPresentation: migratedDisplay.ducks } };
  const storedDucks = snapshot.ducks.map(d => {
    keys(d.presentation, ["schemaVersion", "name", "icon"]);
    requireValue([1, 2, 3, 4, 5].includes(d.presentation.schemaVersion));
    let icon = d.presentation.icon;
    if (icon !== null) {
      const empty = createEmptyPlayerPresentation();
      empty.schemaVersion = d.presentation.schemaVersion;
      if (empty.schemaVersion < 3) for (const path of QUOTE_PATHS) {
        const parent = path.slice(0,-1).reduce((v,k) => v[k], empty.battler.quotes);
        parent[path.at(-1)] = { text: "", iconSlot: null };
      }
      if (empty.schemaVersion < 5) { delete empty.battler.profile.message; delete empty.battler.profile.messageTail; }
      if (empty.schemaVersion < 4) delete empty.battler.profile.showBestStreak;
      if (empty.schemaVersion === 1) delete empty.battler.profile;
      empty.ducks = { duck: icon };
      icon = migrateOnlinePlayerPresentation(empty).ducks.duck;
    }
    return { ...d, presentation: { ...d.presentation, schemaVersion: PLAYER_PRESENTATION_SCHEMA_VERSION, icon } };
  });
  keys(b.build, ["schemaVersion", "bSelection", "dSelection", ...(b.build.schemaVersion === 3 ? ["skillLabels"] : [])]);
  keys(b.presentation, ["schemaVersion", "name", "standingImageUrl", "defaultIconUrl", "iconSlots", "quotes", "profile", "detachedDuckPresentation"]);
  requireValue([2,3].includes(b.build.schemaVersion) && b.presentation.schemaVersion === PLAYER_PRESENTATION_SCHEMA_VERSION && object(b.presentation.detachedDuckPresentation));
  const { schemaVersion: _bv, ...battler } = b.build;
  const { schemaVersion: _pv, name, detachedDuckPresentation, ...display } = b.presentation;
  const duckDisplay = { ...detachedDuckPresentation };
  const ducks = storedDucks.map(d => {
    requireValue(isOnlineUuid(d.id) && object(d.build) && d.build.schemaVersion === b.build.schemaVersion);
    keys(d.presentation, ["schemaVersion", "name", "icon"]); requireValue(d.presentation.schemaVersion === PLAYER_PRESENTATION_SCHEMA_VERSION);
    requireValue(!Object.hasOwn(duckDisplay, d.id));
    const { schemaVersion: _v, ...fields } = d.build;
    if (d.presentation.icon !== null) duckDisplay[d.id] = d.presentation.icon;
    return { id: d.id, name: d.presentation.name, ...fields };
  });
  const migrated = migratePlayerBuild({ schemaVersion: b.build.schemaVersion, battler, ducks });
  requireValue(migrated.ok);
  const data = { build: migrated.build,
    presentation: { schemaVersion: PLAYER_PRESENTATION_SCHEMA_VERSION, battler: display, ducks: duckDisplay },
    publicSettings: { schemaVersion: 1, publicDuckId: snapshot.publicDuckId }, battlerName: name };
  const comparisonData = structuredClone(data);
  // Quotes were already validated above; compare the remaining DTO independently
  // so loading legacy text never applies the new save-only length restriction.
  comparisonData.presentation.battler.quotes = createEmptyPlayerPresentation().battler.quotes;
  const encoded = encodePlayerData(comparisonData, false);
  encoded.battler.presentation.quotes = structuredClone(display.quotes);
  if (b.build.schemaVersion === 2) {
    encoded.battler.build.schemaVersion = 2; delete encoded.battler.build.skillLabels;
    for (const d of encoded.ducks) { d.build.schemaVersion = 2; delete d.build.skillLabels; }
  }
  requireValue(same(encoded.battler, b) && same(encoded.ducks, storedDucks));
  return data;
}
