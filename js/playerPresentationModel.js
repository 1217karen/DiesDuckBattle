export const PLAYER_PRESENTATION_SCHEMA_VERSION = 2;
export const BATTLER_ICON_SLOT_COUNT = 10;

const QUOTE_PATHS = [
  ["battleStart"],
  ["turn", "even"], ["turn", "lead"], ["turn", "behind"],
  ["phaseStart", "first"], ["phaseStart", "second"], ["phaseStart", "third"],
  ["skill", "A"], ["skill", "B"], ["skill", "C"], ["skill", "D"],
  ["battleEnd", "win"], ["battleEnd", "lose"], ["battleEnd", "draw"]
];

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" ? value : "";
const iconSlot = value => Number.isInteger(value) && value >= 1 && value <= BATTLER_ICON_SLOT_COUNT
  ? value : null;
const quote = value => ({ text: text(value?.text), iconSlot: iconSlot(value?.iconSlot) });


export function createEmptyBattlerProfile() {
  return { text: "", iconSlots: [], theme: { background: "#DCEEF3", panel: "#FFFFFF", text: "#20282C", accent: "#4F91B3" }, featuredBattleId: null };
}
export function createEmptyDuckProfile() {
  return { text: "", type: null, attributes: ["", "", ""], statLabelPreset: "default", flavorStats: [] };
}
function normalizeBattlerProfile(value) {
  const result = createEmptyBattlerProfile();
  result.text = text(value?.text);
  result.iconSlots = [...new Set((Array.isArray(value?.iconSlots) ? value.iconSlots : []).filter(v => iconSlot(v) !== null))].sort((a,b) => a-b).slice(0,4);
  for (const key of Object.keys(result.theme)) {
    if (typeof value?.theme?.[key] === "string" && /^#[0-9a-f]{6}$/i.test(value.theme[key])) result.theme[key] = value.theme[key];
  }
  if (typeof value?.featuredBattleId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.featuredBattleId)) result.featuredBattleId = value.featuredBattleId;
  return result;
}
function normalizeDuckProfile(value) {
  const result = createEmptyDuckProfile();
  result.text = text(value?.text);
  if (["attack", "defense", "speed", "heal", "technical", "normal"].includes(value?.type)) result.type = value.type;
  result.attributes = Array.from({ length: 3 }, (_, i) => {
    const v = value?.attributes?.[i];
    return typeof v === "string" && [...v].length <= 1 ? v : "";
  });
  if (["default", "kanji", "english", "hiragana"].includes(value?.statLabelPreset)) result.statLabelPreset = value.statLabelPreset;
  result.flavorStats = (Array.isArray(value?.flavorStats) ? value.flavorStats : []).slice(0,2).map(v => ({
    label: text(v?.label), value: Number.isInteger(v?.value) && v.value >= 0 && v.value <= 6 ? v.value : 0
  }));
  return result;
}

function emptyQuotes() {
  return {
    battleStart: quote(),
    turn: { even: quote(), lead: quote(), behind: quote() },
    phaseStart: { first: quote(), second: quote(), third: quote() },
    skill: { A: quote(), B: quote(), C: quote(), D: quote() },
    battleEnd: { win: quote(), lose: quote(), draw: quote() }
  };
}

export function createEmptyPlayerPresentation() {
  return {
    schemaVersion: PLAYER_PRESENTATION_SCHEMA_VERSION,
    battler: {
      standingImageUrl: "",
      defaultIconUrl: "",
      iconSlots: Array(BATTLER_ICON_SLOT_COUNT).fill(""),
      quotes: emptyQuotes(),
      profile: createEmptyBattlerProfile()
    },
    ducks: {}
  };
}

/** Tolerant boundary for local drafts: unknown/missing values become safe defaults. */
export function normalizePlayerPresentation(value) {
  const result = createEmptyPlayerPresentation();
  const battler = isRecord(value?.battler) ? value.battler : {};
  result.battler.profile = normalizeBattlerProfile(battler.profile);
  result.battler.standingImageUrl = text(battler.standingImageUrl);
  result.battler.defaultIconUrl = text(battler.defaultIconUrl);
  if (Array.isArray(battler.iconSlots)) {
    result.battler.iconSlots = Array.from({ length: BATTLER_ICON_SLOT_COUNT }, (_, index) =>
      text(battler.iconSlots[index]));
  }
  const sourceQuotes = isRecord(battler.quotes) ? battler.quotes : {};
  for (const path of QUOTE_PATHS) {
    let source = sourceQuotes;
    let target = result.battler.quotes;
    for (let index = 0; index < path.length - 1; index += 1) {
      source = isRecord(source?.[path[index]]) ? source[path[index]] : {};
      target = target[path[index]];
    }
    const key = path.at(-1);
    target[key] = quote(source?.[key]);
  }
  if (isRecord(value?.ducks)) {
    for (const [duckId, data] of Object.entries(value.ducks)) {
      if (["__proto__", "prototype", "constructor"].includes(duckId)) continue;
      result.ducks[duckId] = { iconUrl: text(data?.iconUrl), cutinUrl: text(data?.cutinUrl), profile: normalizeDuckProfile(data?.profile) };
    }
  }
  return result;
}

export function clonePlayerPresentation(value) {
  return normalizePlayerPresentation(value);
}

/** Ordered URLs let renderers retry the default icon after an additional icon fails to load. */
export function getQuoteIconUrlCandidates(presentation, quoteValue) {
  const normalized = normalizePlayerPresentation(presentation);
  const slot = iconSlot(quoteValue?.iconSlot);
  const additional = slot === null ? "" : normalized.battler.iconSlots[slot - 1].trim();
  return [...new Set([additional, normalized.battler.defaultIconUrl].filter(value => value.trim()))];
}

/** Empty or stale additional slots immediately fall back to the Battler default icon. */
export function resolveQuoteIconUrl(presentation, quoteValue) {
  return getQuoteIconUrlCandidates(presentation, quoteValue)[0] ?? "";
}
