import { createQuotePresenter } from "./resultPresentation.js";

/** Post-battle display randomness only. Engine events and source snapshots are never mutated. */
export function freezeBattleQuoteSelections(events, presentations, rng = Math.random) {
  const meta = events.find(event => event?.type === "battleStart")?.meta;
  const maxHP = { P1: meta?.P1?.maxHP ?? 0, P2: meta?.P2?.maxHP ?? 0 };
  let selected;
  const present = createQuotePresenter(presentations, maxHP, (quote, side) => {
    const candidates = (quote?.candidates ?? [quote]).filter(line => typeof line?.text === "string" && line.text.trim());
    const pick = candidates.length ? candidates[Math.floor(rng() * candidates.length)] : null;
    selected[side] = pick ? { text: pick.text, iconUrl: pick.iconUrl } : null;
    return selected[side];
  });
  const frozenEvents = events.map(event => {
    const copy = structuredClone(event);
    selected = {};
    present(copy);
    if (Object.keys(selected).length) copy.quoteSelections = selected;
    return copy;
  });
  // Results retain only the actual selections, never unused targeted dialogue.
  const snapshots = structuredClone(presentations);
  const clean = value => {
    if (!value || typeof value !== "object") return;
    delete value.candidates;
    for (const child of Object.values(value)) clean(child);
  };
  clean(snapshots);
  return { events: frozenEvents, presentations: snapshots };
}
