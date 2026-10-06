import test from "node:test";
import assert from "node:assert/strict";
import { buildBlocks } from "../js/resultBlocks.js";
import { runBattle } from "../js/battleEngine.js";

const context = { maxHP: { P1: 1000, P2: 1000 }, names: {
  P1: { battler: "バトラーA", duck: "アヒルA" }, P2: { battler: "バトラーB", duck: "アヒルB" },
} };
const start = { type: "battleStart" };
const phase = { type: "phaseStart", actor: "P1", turn: 1, phase: 1 };
const event = (type, extra = {}) => ({ type, actor: "P1", target: "P1", turn: 1, phase: 1, ...extra });
const blocksFor = events => buildBlocks([start, phase, ...events], "draw", context);
const textFor = events => blocksFor(events).flatMap(block => block.lines).map(line => line.text).join("\n");

for (const [status, name] of [["crack","⚡亀裂"],["focus","🎯集中"],["Headwind","🌪️逆風"],["headwind","🌪️逆風"],["counter","🛡️反撃"]]) {
  test("aura application names the owner, existing localized status and duration: " + status, () => {
    const text = textFor([event("timedRuleApplied", { target: "P2", status, duration: { kind: "turns", remainingTurns: 3 } })]);
    assert.ok(text.includes(`アヒルBは${name}付与のオーラを纏った！（3ターン）`));
    assert.doesNotMatch(text, /バトラーBは|P2は/);
  });
}
test("aura activation retains skill grouping and following status-change output", () => {
  const blocks = blocksFor([
    event("cSkillActivated", { groupId: 1, skill: { category: "C", skillName: "付与オーラ" } }),
    event("timedRuleApplied", { groupId: 1, status: "crack", duration: { remainingTurns: 3 } }),
    event("timedRuleTriggered", { actor: "P2", groupId: 2, status: "crack" }),
    event("statusChange", { actor: "P2", target: "P1", groupId: 2, status: "crack", before: 0, after: 1 }),
  ]);
  const lines = blocks[1].lines.filter(line => line.kind !== "spacer");
  assert.match(lines[0].text, /アヒルAのチャージスキル！/);
  assert.match(lines[1].text, /アヒルAは⚡亀裂付与のオーラ/);
  assert.equal(lines[2].text, "アヒルBのオーラ効果！");
  assert.match(lines[3].text, /アヒルAに⚡亀裂を.*付与！/);
  for (const line of lines) assert.match(line.kind, /skill/);
  assert.equal(blocks[1].stateAfter.status.P1.crack, 1);
});
for (const after of [2, 1, 0, -1]) test("aura tick shows only positive remaining turns: " + after, () => {
  const blocks = blocksFor([event("timedRuleTick", { actor: "system", target: "P2", status: "crack", after })]);
  const tail = blocks.find(block => block.headerText === "");
  if (after > 0) {
    assert.equal(tail.side, "system");
    assert.equal(tail.lines[0].text, `アヒルBのオーラ効果（⚡亀裂 / 残り${after}T）`);
  } else {
    assert.equal(tail, undefined);
    assert.doesNotMatch(blocks.flatMap(block => block.lines).map(line => line.text).join(""), /オーラ効果/);
  }
});
for (const after of [2, 1, 0, -1]) test("ordinary buff tick shows only positive remaining turns: " + after, () => {
  const text = textFor([event("buffTick", { stat: "AT", amount: 2, after })]);
  if (after > 0) assert.ok(text.includes(`アヒルAのターン効果（AT+2／残り${after}T）`));
  else assert.doesNotMatch(text, /ターン効果/);
});
test("zero ticks stay in the record and only expiry logs are rendered in the turn tail", () => {
  const events = [event("timedRuleTick", { actor: "system", status: "crack", before: 1, after: 0 }),
    event("timedRuleExpired", { actor: "system", status: "crack" }),
    event("buffTick", { stat: "AT", amount: 2, before: 1, after: 0 }),
    event("buffExpired", { stat: "AT", amount: 2, duration: { kind: "turns" } }),
    event("turnEnd"), { type: "turnStart", turn: 2, phase: 0, apPlus: 1 }];
  const original = structuredClone(events), blocks = blocksFor(events), tail = blocks.find(block => block.headerText === "");
  assert.deepEqual(events, original);
  assert.equal(tail.side, "system");
  assert.deepEqual(tail.lines.map(line => line.text), ["アヒルAのオーラ効果が終了（⚡亀裂）", "アヒルAのターン効果が終了（AT+2）"]);
  assert.doesNotMatch(tail.lines.map(line => line.text).join(""), /残り0T/);
  assert.ok(blocks.indexOf(tail) > blocks.findIndex(block => block.side === "P1"));
  assert.ok(blocks.indexOf(tail) < blocks.findIndex(block => block.turn === 2));
});
test("aura names and unknown historical status strings remain HTML escaped", () => {
  const unsafeContext = { ...context, names: { ...context.names, P1: { duck: '<img src=x onerror=alert(1)>' } } };
  const blocks = buildBlocks([start, phase, event("timedRuleApplied", { status: '<script>x</script>', duration: { remainingTurns: 3 } })], "draw", unsafeContext);
  const text = blocks.flatMap(block => block.lines).map(line => line.text).join("\n");
  assert.match(text, /&lt;img/); assert.match(text, /&lt;script&gt;/); assert.doesNotMatch(text, /<script>|<img src=x/);
});
for (const owner of ["self", "enemy"]) test("engine retains duration, zero tick events and effect behavior while adding status metadata: " + owner, () => {
  const aura = { type: "addTimedHitRule", id: "aura", target: owner, duration: { kind: "turns", count: 3 },
    effect: { type: "changeStatus", target: "enemy", status: "crack", op: "add", value: 1 } };
  const result = runBattle({ p1: { battlerId: "b1", duckId: "d1" }, p2: { battlerId: "b2", duckId: "d2" },
    data: { BATTLERS: [{ id: "b1", bSkills: [], dSkill: { id: "D1", effect: [aura] } }, { id: "b2", bSkills: [] }],
      DUCKS: ["d1", "d2"].map(id => ({ id, stats: { AT: 0, DF: 0, SP: 1, maxHP: 1000 }, dice: [1] })) },
    field: "test-no-field", maxTurns: 3, rng: () => .9 });
  const side = owner === "self" ? "P1" : "P2";
  const auraEvents = result.events.filter(e => e.type.startsWith("timedRule"));
  for (const e of auraEvents) { assert.equal(e.status, "crack"); assert.equal(e.id, "aura"); }
  assert.equal(auraEvents.find(e => e.type === "timedRuleApplied").target, side);
  assert.deepEqual(auraEvents.filter(e => e.type === "timedRuleTriggered").map(e => [e.turn, e.actor]), [[1, side], [2, side], [3, side]]);
  assert.deepEqual(auraEvents.filter(e => e.type === "timedRuleTick").map(e => [e.turn, e.before, e.after]), [[1,3,2],[2,2,1],[3,1,0]]);
  assert.equal(auraEvents.filter(e => e.type === "timedRuleExpired").length, 1);
  assert.ok(result.events.some(e => e.type === "statusChange" && e.status === "crack"));
  const original = structuredClone(result.events);
  const text = buildBlocks(result.events, result.result, context).flatMap(b => b.lines).map(line => line.text).join("\n");
  assert.deepEqual(result.events, original);
  assert.ok(text.includes(`${context.names[side].duck}は⚡亀裂付与のオーラを纏った！（3ターン）`));
  assert.match(text, /残り2T/); assert.match(text, /残り1T/); assert.doesNotMatch(text, /残り0T/);
});
