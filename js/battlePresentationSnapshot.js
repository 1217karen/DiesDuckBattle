import { normalizePlayerPresentation, resolveQuoteIconUrl } from "./playerPresentationModel.js";

/** Detached display data captured before battle execution; no DOM, storage or engine data. */
export function buildBattlePresentationSnapshot(playerPresentation, duckId) {
  const presentation = normalizePlayerPresentation(playerPresentation);
  const { battler, ducks } = presentation;
  const quote = value => ({ text: value.text, iconUrl: resolveQuoteIconUrl(presentation, value) });
  const group = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, quote(value)]));
  return {
    battlerDefaultIconUrl: battler.defaultIconUrl,
    duckIconUrl: ducks[duckId]?.iconUrl ?? "",
    quotes: {
      battleStart: quote(battler.quotes.battleStart),
      turn: group(battler.quotes.turn),
      phaseStart: group(battler.quotes.phaseStart),
      skill: group(battler.quotes.skill),
      battleEnd: group(battler.quotes.battleEnd),
    },
  };
}
