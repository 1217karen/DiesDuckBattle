const sides = ["P1", "P2"];
const escapeHTML = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function snapshotIconHTML(url, className) {
  return typeof url === "string" && url.trim()
    ? `<img class="${className}" data-snapshot-icon src="${escapeHTML(url)}" alt="">` : "";
}

// Adapted from base/result's quoteRow/quoteCell layout; empty sides are omitted.
export function makeQuoteRowLine(p1, p2, order = sides) {
  const quotes = { P1: p1, P2: p2 };
  const cells = order.flatMap(side => {
    const quote = quotes[side];
    if (typeof quote?.text !== "string" || !quote.text.trim()) return [];
    const css = side.toLowerCase();
    return [`<div class="quoteCell ${css}">${snapshotIconHTML(quote.iconUrl, "quoteIcon")}<div class="quoteBubble ${css}">${escapeHTML(quote.text)}</div></div>`];
  });
  return cells.length ? [{ kind: "quoteLine", text: `<div class="quoteRow">${cells.join("")}</div>` }] : [];
}

// Same 20%/40% thresholds and equal-ratio handling as base's turnSituationKeyFor.
export function turnSituationKeyFor(side, state, maxHP) {
  const ratio = key => maxHP?.[key] > 0 ? (state?.hp?.[key] ?? 0) / maxHP[key] : 0;
  const r1 = ratio("P1"), r2 = ratio("P2");
  const p1Crit = r1 < .2, p2Crit = r2 < .2;
  const p1Warn = r1 < .4, p2Warn = r2 < .4;
  if (p1Crit && p2Crit) return "behind";
  if (p1Crit !== p2Crit) return (side === "P1" ? p1Crit : p2Crit) ? "behind" : "lead";
  if (p1Warn && p2Warn) {
    if (r1 === r2) return "behind";
    return (side === "P1" ? r1 < r2 : r2 < r1) ? "behind" : "lead";
  }
  if (p1Warn !== p2Warn) return (side === "P1" ? p1Warn : p2Warn) ? "behind" : "lead";
  return "even";
}

/** One presenter per replay. Reads only record snapshots, never current player data. */
export function createQuotePresenter(presentations = {}, maxHP = {}) {
  let turn;
  let counts = { P1: 0, P2: 0 };
  const seenSkills = new Set();
  const quote = (side, timing, detail) => detail == null
    ? presentations[side]?.quotes?.[timing] : presentations[side]?.quotes?.[timing]?.[detail];
  const pair = (timing, details = {}, order = sides) => makeQuoteRowLine(
    quote("P1", timing, details.P1), quote("P2", timing, details.P2), order);
  const single = (side, timing, detail) => makeQuoteRowLine(
    side === "P1" ? quote(side, timing, detail) : null,
    side === "P2" ? quote(side, timing, detail) : null);
  return event => {
    if (event.type === "battleStart") return pair("battleStart");
    if (event.type === "turnStart" || event.type === "phaseStart") {
      if (turn !== event.turn) { turn = event.turn; counts = { P1: 0, P2: 0 }; }
    }
    if (event.type === "turnStart") return pair("turn", Object.fromEntries(sides.map(side =>
      [side, turnSituationKeyFor(side, event.state, maxHP)])));
    if (event.type === "phaseStart" && sides.includes(event.actor)) {
      const detail = ["first", "second", "third"][counts[event.actor]++];
      return detail ? single(event.actor, "phaseStart", detail) : [];
    }
    if (event.type === "battleEnd") {
      if (event.result === "draw") return pair("battleEnd", { P1: "draw", P2: "draw" });
      const winner = event.result === "P2_win" ? "P2" : "P1";
      const loser = winner === "P1" ? "P2" : "P1";
      return pair("battleEnd", { [winner]: "win", [loser]: "lose" }, [loser, winner]);
    }
    // C's actual activation has its own event; ignore category-C skillTriggered.
    const category = event.type === "cSkillActivated" ? "C"
      : event.type === "skillTriggered" && ["A", "B", "D"].includes(event.skill?.category) ? event.skill.category : null;
    if (!category || !sides.includes(event.actor)) return [];
    if (event.groupId != null) {
      const key = JSON.stringify([event.actor, category, event.groupId]);
      if (seenSkills.has(key)) return [];
      seenSkills.add(key);
    }
    return single(event.actor, "skill", category);
  };
}

export function setHeaderIcon(container, url) {
  if (typeof url !== "string" || !url.trim()) return;
  const fallback = container.textContent;
  const img = container.ownerDocument.createElement("img");
  img.alt = "";
  img.addEventListener("error", () => { container.textContent = fallback; }, { once: true });
  container.replaceChildren(img);
  img.src = url;
}

export function attachImageFallbacks(container) {
  for (const img of container.querySelectorAll("img[data-snapshot-icon]")) {
    const remove = () => img.remove();
    img.addEventListener("error", remove, { once: true });
    if (img.complete && !img.naturalWidth) remove();
  }
}
