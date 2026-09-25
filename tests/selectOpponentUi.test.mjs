import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as selectState from "../js/selectState.js";
import { listOpponents, getOpponent } from "../js/opponentSource.js";

test("real SELECT handlers switch public names and presentation with no P2 Duck interaction", async () => {
  const opponents = await Promise.all((await listOpponents()).map(o => getOpponent(o.id)));
  for (const o of opponents) o.presentation = {
    battler: { standingImageUrl: `${o.id}-standing.png` },
    ducks: { [o.publicDuckId]: { iconUrl: `${o.id}-public.png` } },
  };
  function element() {
    return { children: [], handlers: {}, classList: { toggle() {} }, setAttribute() {}, focus() {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(type, handler) { this.handlers[type] = handler; },
      showModal() { this.open = true; }, close() { this.open = false; this.handlers.close?.(); },
    };
  }
  const elements = new Map();
  const document = { createElement: element, getElementById(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  } };
  const shown = [];
  const ui = await readFile(new URL("../js/select.js", import.meta.url), "utf8");
  vm.runInNewContext(ui.replace(/^import .*;\r?\n/gm, ""), {
    ...selectState, document,
    createPlayerBuildStorage: () => ({ load: () => ({ ok:true, status:"loaded", build:opponents[1].build }) }),
    createPlayerPresentationStorage: () => ({ load: () => ({}) }),
    createSelectPresentation: () => (side, presentation, id) => shown.push({ side, presentation, id }),
    listOpponents: async () => opponents.map(({ id, name }) => ({ id, name })),
    getOpponent: async id => opponents.find(o => o.id === id),
  });
  assert.equal(document.getElementById("p2-duck-name").textContent, "公開Duck");
  const flush = () => new Promise(resolve => setImmediate(resolve));
  async function choose(index) {
    document.getElementById("p2-battler-slot").handlers.click();
    await flush();
    assert.equal(document.getElementById("trayGrid").children.length, 2);
    await document.getElementById("trayGrid").children[index].children[0].handlers.click();
  }
  for (const index of [0, 1]) {
    await choose(index);
    const opponent = opponents[index], last = shown.filter(s => s.side === "p2").at(-1);
    assert.equal(last.id, opponent.publicDuckId);
    assert.equal(last.presentation.battler.standingImageUrl, `${opponent.id}-standing.png`);
    assert.equal(last.presentation.ducks[last.id].iconUrl, `${opponent.id}-public.png`);
    assert.equal(document.getElementById("p2-duck-name").textContent,
      opponent.build.ducks.find(d => d.id === opponent.publicDuckId).name);
    assert.match(document.getElementById("p2-duck-info").textContent, /AT .*DF .*SP .*HP .*\nダイス：.*\nA：.*\nC：/);
    assert.equal(document.getElementById("tray").open, false);
    assert.equal(document.getElementById("p2-duck-slot").handlers.click, undefined);
  }
  delete opponents[0].presentation;
  await choose(0);
  assert.equal(shown.filter(s => s.side === "p2").at(-1).presentation.battler.standingImageUrl, "");
  const html = await readFile(new URL("../select.html", import.meta.url), "utf8");
  const slot = html.match(/<div[^>]*id="p2-duck-slot"[^>]*>/)?.[0];
  assert.ok(slot);
  assert.doesNotMatch(slot, /aria-haspopup|aria-controls|tabindex|role="button"/);
  assert.doesNotMatch(ui, /opponentDuckId|opponentDuckChoices|selectOpponentDuck|2P DUCKから/);
});
