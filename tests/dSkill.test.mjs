import test from "node:test";
import assert from "node:assert/strict";
import { D_SKILL_OPTIONS } from "../js/dSkillCatalog.js";
import { compileDSkill } from "../js/dSkillCompiler.js";
import { runDSkillTestBattle } from "../js/dSkillTestHarness.js";
import { runBattle } from "../js/battleEngine.js";

const expected = [...Array.from({ length: 7 }, (_, value) => ({ id: `add-self-${value}`, target: "self", value })),
  { id: "add-enemy-0", target: "enemy", value: 0 }];
test("production catalogはself 0～6とenemy 0の完成8択だけ", () => {
  assert.deepEqual(D_SKILL_OPTIONS.map(o => ({ id: o.id, target: o.semantics.target, value: o.semantics.values[0] })), expected);
  for (const option of D_SKILL_OPTIONS) {
    assert.deepEqual(option.semantics, { type: "addDice", target: option.semantics.target, values: [option.semantics.values[0]] });
    assert.ok(option.label);
    assert.ok(Object.isFrozen(option) && Object.isFrozen(option.semantics) && Object.isFrozen(option.semantics.values));
  }
});

for (const { id, target, value } of expected) test(`${id}: compile → P1 D → battleStartで1回追加 → 追加後poolでroll`, () => {
  const selection = { optionId: id };
  const compilation = compileDSkill(selection);
  assert.equal(compilation.ok, true);
  assert.deepEqual(compilation.errors, []);
  assert.deepEqual(compilation.skill.effect, { type: "addDice", target, values: [value] });
  assert.ok(compilation.skill.id && compilation.skill.name && compilation.skill.description);
  const { battle, compilation: actual } = runDSkillTestBattle(selection, { p1Dice: 1, p2Dice: 2, rng: () => .999 });
  assert.deepEqual(actual, compilation);
  const events = battle.events, side = target === "self" ? "P1" : "P2";
  const start = events.find(e => e.type === "battleStart");
  assert.deepEqual(start.meta.P1.dicePool, [1]); assert.deepEqual(start.meta.P2.dicePool, [2]);
  const triggered = events.filter(e => e.type === "skillTriggered");
  assert.equal(triggered.length, 1);
  assert.equal(triggered[0].actor, "P1");
  assert.equal(triggered[0].trigger, "battleStart");
  assert.equal(triggered[0].skill.category, "D");
  const added = events.filter(e => e.type === "diceAdded");
  assert.equal(added.length, 1);
  assert.equal(added[0].actor, "P1"); assert.equal(added[0].target, side);
  assert.deepEqual(added[0].values, [value]);
  assert.ok(events.indexOf(triggered[0]) < events.indexOf(added[0]));
  const rolls = events.filter(e => e.type === "roll");
  assert.equal(rolls.length, 6);
  assert.ok(events.indexOf(added[0]) < events.indexOf(rolls[0]));
  assert.ok(rolls.filter(e => e.actor === side).every(e => e.diceValue === value));
  const other = side === "P1" ? "P2" : "P1";
  assert.ok(rolls.filter(e => e.actor === other).every(e => e.diceValue === (other === "P1" ? 1 : 2)));
  // 2要素poolの境界直前/直後を抽選し、上書き・先頭挿入・複数追加も検出する。
  for (const [rngValue, rolled] of [[.499, side === "P1" ? 1 : 2], [.501, value]]) {
    const r = runDSkillTestBattle(selection, { rng: () => rngValue }).battle;
    assert.ok(r.events.filter(e => e.type === "roll" && e.actor === side).every(e => e.diceValue === rolled));
  }
  assert.deepEqual(selection, { optionId: id });
});

test("不正DTOを拒否しharnessも戦闘を開始しない", () => {
  const invalid = [null, undefined, [], "add-self-0", 0, true, new Date(), {}, { optionId: 0 },
    { optionId: null }, { optionId: "unknown" }, { optionId: "add-enemy-1" }, { optionId: "add-self-7" },
    ...["target", "value", "values", "effect", "trigger", "amount", "cost", "type", "unknown", "__proto__"].map(key =>
      ({ optionId: "add-self-0", [key]: "raw" })),
    { optionId: "add-self-0", [Symbol("raw")]: true },
    Object.create({ optionId: "add-self-0" }),
    Object.defineProperty({ optionId: "add-self-0" }, "raw", { value: 1 }),
    { get optionId() { throw new Error("getterは実行しない"); } },
  ];
  for (const selection of invalid) {
    const result = compileDSkill(selection);
    assert.equal(result.ok, false); assert.equal(result.skill, null); assert.ok(result.errors.length);
    const run = runDSkillTestBattle(selection, { rng: () => { throw new Error("戦闘を開始しない"); } });
    assert.equal(run.battle, null); assert.deepEqual(run.compilation, result);
  }
});

test("compiler出力を変更してもcatalog/次回compileは変わらない", () => {
  const result = compileDSkill({ optionId: "add-self-4" });
  result.skill.effect.values.push(6); result.skill.effect.target = "enemy";
  assert.deepEqual(compileDSkill({ optionId: "add-self-4" }).skill.effect, { type: "addDice", target: "self", values: [4] });
});

test("harnessの初期dice検証と0保持", () => {
  for (const key of ["p1Dice", "p2Dice"]) for (const value of [-1, 7, .5, NaN, "1"])
    assert.throws(() => runDSkillTestBattle({ optionId: "add-self-0" }, { [key]: value }), TypeError);
  const result = runDSkillTestBattle({ optionId: "add-self-0" }, { p1Dice: 0, p2Dice: 0, rng: () => .9 });
  assert.ok(result.battle.events.filter(e => e.type === "roll").every(e => e.diceValue === 0));
});

test("legacy raw Dも両者で従来どおりP1→P2、末尾追加・0保持", () => {
  const data = { BATTLERS: [
    { id: "p1", dSkill: { id: "legacy1", effect: { type: "addDice", target: "self", values: [0, 4] } } },
    { id: "p2", dSkill: { id: "legacy2", effect: { type: "addDice", target: "enemy", values: [0] } } },
  ], DUCKS: [
    { id: "d1", dice: [1, 2], stats: { AT: 1, DF: 1, SP: 1, maxHP: 1000 } },
    { id: "d2", dice: [3], stats: { AT: 1, DF: 1, SP: 1, maxHP: 1000 } },
  ] };
  for (const [index, value] of [1, 2, 0, 4, 0].entries()) {
    const r = runBattle({ p1: { battlerId: "p1", duckId: "d1" }, p2: { battlerId: "p2", duckId: "d2" },
      data, maxTurns: 2, field: "dev-no-field", rng: () => (index + .5) / 5 });
    assert.deepEqual(r.events.filter(e => e.type === "skillTriggered").map(e => [e.actor, e.trigger]), [["P1", "battleStart"], ["P2", "battleStart"]]);
    assert.deepEqual(r.events.filter(e => e.type === "diceAdded").map(e => [e.target, e.values]), [["P1", [0, 4]], ["P1", [0]]]);
    assert.ok(r.events.filter(e => e.type === "roll" && e.actor === "P1").every(e => e.diceValue === value));
    assert.ok(r.events.filter(e => e.type === "roll" && e.actor === "P2").every(e => e.diceValue === 3));
  }
  assert.deepEqual(data.DUCKS[0].dice, [1, 2]);
});
