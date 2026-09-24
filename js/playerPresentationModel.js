export const PLAYER_PRESENTATION_SCHEMA_VERSION = 1;
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
      quotes: emptyQuotes()
    },
    ducks: {}
  };
}

/** Tolerant boundary for local drafts: unknown/missing values become safe defaults. */
export function normalizePlayerPresentation(value) {
  const result = createEmptyPlayerPresentation();
  const battler = isRecord(value?.battler) ? value.battler : {};
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
      result.ducks[duckId] = { iconUrl: text(data?.iconUrl) };
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
