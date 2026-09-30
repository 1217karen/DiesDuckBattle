import { clonePlayerBuild, createEmptyPlayerBuild } from "./playerBuildModel.js";
import { normalizePlayerPresentation, createEmptyPlayerPresentation } from "./playerPresentationModel.js";
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

// Validate persistence shape, not battle readiness. Never read local storage/catalogs.
export function encodeOnlinePlayer(data) {
  keys(data, ["build", "presentation", "publicSettings", "battlerName"]);
  requireValue(data.build.schemaVersion === 2 && typeof data.battlerName === "string");
  const build = clonePlayerBuild(data.build);
  requireValue(build.ducks.every(d => isOnlineUuid(d.id)));
  const presentation = normalizePlayerPresentation(data.presentation);
  // The local normalizer is tolerant; online persistence must reject lossy conversion.
  requireValue(same(presentation, data.presentation));
  const settings = normalizePlayerPublicSettings(data.publicSettings);
  requireValue(same(settings, data.publicSettings));
  const ids = new Set(build.ducks.map(d => d.id));
  requireValue(settings.publicDuckId === null || ids.has(settings.publicDuckId));
  // Existing display editor permits icons for Ducks absent from the battle build.
  const detachedDuckPresentation = Object.fromEntries(Object.entries(presentation.ducks).filter(([id]) => !ids.has(id)));
  return {
    dtoVersion: 1,
    battler: {
      build: { schemaVersion: 2, ...build.battler },
      presentation: { schemaVersion: 1, name: data.battlerName, ...presentation.battler, detachedDuckPresentation },
    },
    ducks: build.ducks.map(({ id, name, ...fields }) => ({ id,
      build: { schemaVersion: 2, ...fields },
      presentation: { schemaVersion: 1, name, icon: presentation.ducks[id] ?? null },
    })),
    publicDuckId: settings.publicDuckId,
  };
}

export function decodeOnlinePlayer(snapshot) {
  requireValue(object(snapshot) && Array.isArray(snapshot.ducks) && object(snapshot.battler));
  const b = snapshot.battler;
  // Only the documented registration shape is treated as empty, without writing it back.
  if (same(b.build, {}) && same(Object.keys(b.presentation).sort(), ["name"]) && typeof b.presentation.name === "string"
    && snapshot.ducks.length === 0 && snapshot.publicDuckId === null) {
    return { build: createEmptyPlayerBuild(), presentation: createEmptyPlayerPresentation(),
      publicSettings: { schemaVersion: 1, publicDuckId: null }, battlerName: b.presentation.name };
  }
  keys(b.build, ["schemaVersion", "bSelection", "dSelection"]);
  keys(b.presentation, ["schemaVersion", "name", "standingImageUrl", "defaultIconUrl", "iconSlots", "quotes", "detachedDuckPresentation"]);
  requireValue(b.build.schemaVersion === 2 && b.presentation.schemaVersion === 1 && object(b.presentation.detachedDuckPresentation));
  const { schemaVersion: _bv, ...battler } = b.build;
  const { schemaVersion: _pv, name, detachedDuckPresentation, ...display } = b.presentation;
  const duckDisplay = { ...detachedDuckPresentation };
  const ducks = snapshot.ducks.map(d => {
    requireValue(isOnlineUuid(d.id) && object(d.build) && d.build.schemaVersion === 2);
    keys(d.presentation, ["schemaVersion", "name", "icon"]); requireValue(d.presentation.schemaVersion === 1);
    requireValue(!Object.hasOwn(duckDisplay, d.id));
    const { schemaVersion: _v, ...fields } = d.build;
    if (d.presentation.icon !== null) duckDisplay[d.id] = d.presentation.icon;
    return { id: d.id, name: d.presentation.name, ...fields };
  });
  const data = { build: { schemaVersion: 2, battler, ducks },
    presentation: { schemaVersion: 1, battler: display, ducks: duckDisplay },
    publicSettings: { schemaVersion: 1, publicDuckId: snapshot.publicDuckId }, battlerName: name };
  const encoded = encodeOnlinePlayer(data);
  requireValue(same(encoded.battler, b) && same(encoded.ducks, snapshot.ducks));
  return data;
}
