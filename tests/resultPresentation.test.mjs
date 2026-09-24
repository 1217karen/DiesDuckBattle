import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createQuotePresenter, makeQuoteRowLine, turnSituationKeyFor, setHeaderIcon, attachImageFallbacks } from "../js/resultPresentation.js";
import { buildBlocks } from "../js/resultBlocks.js";

const quote = text => ({ text, iconUrl: `https://example.com/${text}.png` });
function presentation(side) {
  const group = keys => Object.fromEntries(keys.map(key => [key, quote(`${side}-${key}`)]));
  return { battlerDefaultIconUrl: `${side}-battler.png`, duckIconUrl: `${side}-duck.png`, quotes: {
    battleStart: quote(`${side}-start`), turn: group(["even", "lead", "behind"]),
    phaseStart: group(["first", "second", "third"]), skill: group(["A", "B", "C", "D"]),
    battleEnd: group(["win", "lose", "draw"]),
  } };
}
const presentations = { P1: presentation("P1"), P2: presentation("P2") };
const maxHP = { P1: 100, P2: 200 };
const context = { presentations, maxHP, names: { P1: { battler: "One", duck: "Red" }, P2: { battler: "Two", duck: "Blue" } } };

test("base HP ratio thresholds include 20/40 percent and equal-ratio boundaries", () => {
  for (const [p1, p2, expected] of [
    [40,40,["even","even"]], [100,50,["even","even"]],
    [39,40,["behind","lead"]], [40,39,["lead","behind"]],
    [20,39,["behind","lead"]], [39,20,["lead","behind"]],
    [20,20,["behind","behind"]], [30,30,["behind","behind"]],
    [19,10,["behind","behind"]], [19,20,["behind","lead"]], [20,19,["lead","behind"]],
  ]) assert.deepEqual(["P1","P2"].map(side => turnSituationKeyFor(side, { hp: { P1: p1, P2: p2 * 2 } }, maxHP)), expected);
});

test("quote row escapes text and URL, suppresses empty cells and uses only resolved iconUrl", () => {
  assert.deepEqual(makeQuoteRowLine(null, { text: "  " }), []);
  const [line] = makeQuoteRowLine(null, { text: '<script>"&', iconUrl: 'snapshot.png" onerror="bad', iconSlot: 3 });
  assert.match(line.text, /quoteCell p2/);
  assert.doesNotMatch(line.text, /quoteCell p1|<script>|iconSlot/);
  assert.match(line.text, /&lt;script&gt;&quot;&amp;/);
  assert.match(line.text, /src="snapshot.png&quot; onerror=&quot;bad"/);
  assert.doesNotMatch(makeQuoteRowLine({ text: "no icon", iconUrl: "" }, null)[0].text, /<img/);
});

test("phase occurrence is counted independently for each actor and resets with turn", () => {
  const render = createQuotePresenter(presentations, maxHP);
  for (const [turn, actor, phase, key] of [
    [1,"P1",1,"first"], [1,"P2",2,"first"], [1,"P2",3,"second"],
    [1,"P1",4,"second"], [1,"P1",5,"third"], [1,"P2",6,"third"],
    [2,"P2",7,"first"], [2,"P1",8,"first"],
  ]) {
    const lines = render({ type: "phaseStart", turn, actor, phase });
    assert.equal(lines.length, 1);
    assert.match(lines[0].text, new RegExp(`${actor}-${key}`));
    assert.doesNotMatch(lines[0].text, new RegExp(`quoteCell ${actor === "P1" ? "p2" : "p1"}`));
  }
});

test("A/B/D use skillTriggered; C uses only cSkillActivated, once per activation group", () => {
  const render = createQuotePresenter(presentations, maxHP);
  for (const category of ["A","B","C","D"]) {
    const event = { type: category === "C" ? "cSkillActivated" : "skillTriggered", actor: "P2", skill: { category }, groupId: category };
    if (category === "C") assert.deepEqual(render({ ...event, type: "skillTriggered" }), []);
    assert.match(render(event)[0].text, new RegExp(`P2-${category}`));
    assert.deepEqual(render(event), []);
    assert.deepEqual(render({ ...event, type: "fixedDamage" }), []);
    assert.equal(render({ ...event, groupId: `${category}-next` }).length, 1);
  }
});

test("start and end choose both quotes; victory orders loser before winner like base", () => {
  const render = createQuotePresenter(presentations, maxHP);
  const start = render({ type: "battleStart" })[0].text;
  assert.match(start, /P1-start/); assert.match(start, /P2-start/);
  for (const winner of ["P1", "P2"]) {
    const loser = winner === "P1" ? "P2" : "P1";
    const html = render({ type: "battleEnd", result: `${winner}_win` })[0].text;
    assert.match(html, new RegExp(`${winner}-win`)); assert.match(html, new RegExp(`${loser}-lose`));
    assert.ok(html.indexOf(`${loser}-lose`) < html.indexOf(`${winner}-win`));
  }
  const draw = render({ type: "battleEnd", result: "draw" })[0].text;
  assert.match(draw, /P1-draw/); assert.match(draw, /P2-draw/);
});

test("existing blocks and logs remain intact; old records generate the same non-presentation lines", () => {
  const state = { hp: { P1: 30, P2: 100 }, ap: { P1: 2, P2: 3 } };
  const events = [
    { type: "battleStart", meta: { first: "P1", field: { name: "Field" } } },
    { type: "turnStart", turn: 1, state },
    { type: "phaseStart", turn: 1, phase: 1, actor: "P1", state },
    ...["A","B","D"].map(category => ({ type: "skillTriggered", actor: "P1", skill: { category }, groupId: category })),
    { type: "cSkillActivated", actor: "P1", groupId: "C" },
    { type: "roll", actor: "P1", diceValue: 1 },
    { type: "battleEnd", turn: 1, phase: 1, state },
  ];
  const blocks = buildBlocks(events, "P2_win", context);
  const legacy = buildBlocks(events, "P2_win", { ...context, presentations: undefined });
  assert.equal(blocks.length, 4);
  for (let i = 0; i < blocks.length; i++) {
    assert.equal(blocks[i].headerText, legacy[i].headerText);
    assert.deepEqual(blocks[i].stateAfter, legacy[i].stateAfter);
    assert.deepEqual(blocks[i].lines.filter(line => !line.kind.includes("quoteLine") && !line.kind.includes("rollLine")),
      legacy[i].lines.filter(line => !line.kind.includes("rollLine")));
  }
  assert.match(blocks[0].lines.at(-1).text, /P1-start/);
  assert.match(blocks[1].lines.at(-1).text, /P1-behind/);
  assert.match(blocks[1].lines.at(-1).text, /P2-lead/);
  assert.match(blocks[2].lines[0].text, /P1-first/);
  assert.match(blocks[2].lines.find(line => line.kind.includes("rollLine")).text, /P1-duck.png/);
  assert.match(blocks[3].lines[0].text, /P2-win/);
  assert.equal(legacy.flatMap(block => block.lines).filter(line => line.kind.includes("quoteLine")).length, 0);
});

test("image failures restore header placeholder or remove only the failing inline icon", () => {
  let onError;
  const img = { addEventListener: (type, handler) => { onError = handler; } };
  const container = { textContent: "1P", ownerDocument: { createElement: () => img }, replaceChildren(child) { this.child = child; } };
  setHeaderIcon(container, "snapshot.png");
  assert.equal(img.src, "snapshot.png");
  onError(); assert.equal(container.textContent, "1P");
  let removed = 0;
  attachImageFallbacks({ querySelectorAll: () => [{ complete: true, naturalWidth: 0, addEventListener() {}, remove() { removed++; } }] });
  assert.equal(removed, 1);
});

test("result modules never read current presentation, icon slots or fixed character data", async () => {
  for (const name of ["result.js", "resultBlocks.js", "resultPresentation.js"]) {
    const source = await readFile(new URL(`../js/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /playerPresentationStorage|iconSlot|BATTLERS|img\/Battlers|from ["']\.\/data\.js/);
  }
});
