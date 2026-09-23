import test from "node:test";
import assert from "node:assert/strict";
import { runBattle } from "../js/battleEngine.js";

const change = (key, value, op = "set", target = "self") =>
  ({ type: "changeValue", target, key, op, value });
const status = (key, value = 1, target = "self") =>
  ({ type: "changeStatus", target, status: key, op: "set", value });
const rule = (id, trigger, effect, when = null) => ({ id, trigger, effect, when });
const phaseIs = phase => ({ left: "phase", op: "==", right: phase });

function battle({ dice = 1, sp = 1, aSkill, bSkills = [], setup = [], enemySetup = [], rng = () => .9 } = {}) {
  return runBattle({
    p1: { battlerId: "b1", duckId: "d1" },
    p2: { battlerId: "b2", duckId: "d2" },
    data: {
      BATTLERS: [
        { id: "b1", bSkills, dSkill: { id: "D1", effect: setup } },
        { id: "b2", dSkill: { id: "D2", effect: enemySetup } },
      ],
      DUCKS: [
        { id: "d1", aSkill, stats: { AT: 5, DF: 3, SP: sp, maxHP: 1000 }, dice: [dice] },
        { id: "d2", stats: { AT: 3, DF: 3, SP: 1, maxHP: 1000 }, dice: [0] },
      ],
    },
    field: "test-no-field",
    maxTurns: 1,
    rng,
  });
}

const nextAT = change("nextAttackATPlus", 3, "add");
const cancelAttack = change("attackTimesOverride", 0);
const addAttack = value => change("attackTimesAdd", value, "add");
const aOnDice = (dice, effect) => ({ id: "A_TEST", trigger: `onDice=${dice}`, effect });
const p1NormalDamage = result => result.events.filter(e => e.type === "normalDamage" && e.actor === "P1");
const consumed = result => result.events.filter(e => e.code === "NEXT_ATTACK_ATPLUS_CONSUMED");

test("nextAttackATPlusは命中した通常攻撃に適用し、その1試行で消費する", () => {
  const result = battle({ setup: [nextAT] });
  assert.deepEqual(p1NormalDamage(result).map(e => e.value), [7]);
  assert.deepEqual(consumed(result).map(e => e.value), [3]);
});

test("steam MISSでも1発目で消費し、2発目へ持ち越さない", () => {
  // 同速の先攻決定→singleton dicePool選択→steam判定。
  const rolls = [0, .9, 0, .9];
  const result = battle({ dice: 2, setup: [nextAT, status("steam")], rng: () => rolls.shift() ?? .9 });
  assert.ok(result.events.some(e => e.code === "ATTACK_MISSED_BY_EFFECT"));
  assert.deepEqual(p1NormalDamage(result).map(e => e.value), [6]);
  assert.deepEqual(consumed(result).map(e => e.value), [3]);
});

test("連続行動の命中率MISSでも消費し、同phaseの2発目へ持ち越さない", () => {
  // P1/P2/P1のdice選択後、2回目行動の2発をMISS→命中にする。
  const rolls = [.9, .9, .9, .1, .9];
  const result = battle({
    dice: 2,
    sp: 2,
    bSkills: [rule("set-next", "phaseStart", nextAT, phaseIs(3))],
    rng: () => rolls.shift() ?? .9,
  });
  const secondActionEvents = result.events.filter(e => e.phase === 3);
  assert.ok(secondActionEvents.some(e => e.code === "ATTACK_MISSED_BY_MULTI_ACTION_ACCURACY"));
  assert.deepEqual(secondActionEvents.filter(e => e.type === "normalDamage").map(e => e.value), [4]);
  assert.deepEqual(secondActionEvents.filter(e => e.code === "NEXT_ATTACK_ATPLUS_CONSUMED").map(e => e.value), [3]);
});

test("tailwind回避でも1発目で消費し、2発目へ持ち越さない", () => {
  const result = battle({ dice: 2, setup: [nextAT], enemySetup: [status("tailwind")] });
  assert.equal(result.events.filter(e => e.code === "ATTACK_AVOIDED_BY_TAILWIND").length, 1);
  assert.deepEqual(p1NormalDamage(result).map(e => e.value), [6]);
  assert.deepEqual(consumed(result).map(e => e.value), [3]);
});

test("通常攻撃0回では消費せず、次の通常攻撃試行まで保持する", () => {
  const result = battle({
    sp: 2,
    setup: [nextAT],
    bSkills: [rule("cancel-first", "beforeDiceResolve", cancelAttack, phaseIs(1))],
  });
  assert.equal(result.events.filter(e => e.phase === 1 && e.type === "normalDamage").length, 0);
  assert.equal(result.events.filter(e => e.phase === 1 && e.code === "NEXT_ATTACK_ATPLUS_CONSUMED").length, 0);
  assert.deepEqual(result.events.filter(e => e.phase === 3 && e.type === "normalDamage").map(e => e.value), [6]);
  assert.deepEqual(consumed(result).map(e => e.value), [3]);
});

for (const additions of [[], [1], [1, 1, 2]]) {
  test(`attackTimesOverride=0は追加攻撃${additions.reduce((a, b) => a + b, 0)}回より優先`, () => {
    const bSkills = additions.map((value, index) => rule(`add-${index}`, "beforeRoll", addAttack(value)));
    const result = battle({ dice: 2, aSkill: aOnDice(2, cancelAttack), bSkills });
    assert.equal(p1NormalDamage(result).length, 0);
  });
}

test("override 0以外はbase攻撃回数への既存加算を維持する", () => {
  const result = battle({ dice: 2, bSkills: [rule("add", "beforeRoll", addAttack(1))] });
  assert.equal(p1NormalDamage(result).length, 3);
});
