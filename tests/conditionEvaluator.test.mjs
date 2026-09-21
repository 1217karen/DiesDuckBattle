import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition, readConditionValue } from "../js/conditionEvaluator.js";
import { applyEffect } from "../js/effects.js";
import { compileAllRulesForFighter, runTrigger, Triggers } from "../js/ruleEngine.js";

const atom = (left, op, right) => ({ left, op, right });
function context() {
  return {
    turn: 5, phase: 2, diceValue: 3,
    actor: { side: "P1", hp: 50, maxHP: 100, ap: 3, at: 4, df: 2, sp: 3,
      actionsThisTurn: 2, nextAttackATPlus: 5, status: { crack: 1, Headwind: 2 },
      cooldowns: { turn: { "B:skill": 2 }, phase: { "B:skill": 1 } } },
    enemy: { side: "P2", hp: 20, maxHP: 80, ap: 2, at: 5, df: 1, sp: 2,
      actionsThisTurn: 1, status: { counter: 2, crack: 1 },
      cooldowns: { turn: { skill: 3 }, phase: { skill: 4 } } },
    attack: { kind: "normalAttack", dice: 3, damage: 12, hit: true, avoided: false, isCounter: false },
  };
}
test("HP比率の境界>=/<=、enemy比率、HP/AP", () => {
  const ctx = context();
  for (const op of [">=", "<=", "=="]) assert.equal(evaluateCondition(atom("self.hpPct", op, 0.5), ctx), true);
  assert.equal(evaluateCondition(atom("self.hpPct", "<", 0.5), ctx), false);
  assert.equal(evaluateCondition(atom("enemy.hpPct", "==", 0.25), ctx), true);
  for (const [path, value] of [["self.hp", 50], ["enemy.hp", 20], ["self.ap", 3], ["enemy.ap", 2]]) {
    assert.equal(evaluateCondition(atom(path, "==", value), ctx), true);
  }
});
test("全状態key、存在しない状態の0、キーのtrimを維持", () => {
  const ctx = context();
  assert.equal(evaluateCondition(atom("self.status:crack", ">=", 1), ctx), true);
  assert.equal(evaluateCondition(atom("enemy.status:counter", "==", 2), ctx), true);
  for (const key of ["crack", "Headwind", "roughWave", "steam", "tailwind", "focus", "counter", "clean", "futureState"]) {
    ctx.actor.status[key] = 2;
    assert.equal(readConditionValue(`self.status: ${key} `, ctx), 2);
  }
  assert.equal(readConditionValue("enemy.status:missing", ctx), 0);
});
test("self/enemy cooldownのturn/phase、未設定は0", () => {
  const ctx = context();
  for (const [path, value] of [["self.cdTurn:B:skill", 2], ["self.cdPhase:B:skill", 1],
    ["enemy.cdTurn:skill", 3], ["enemy.cdPhase:skill", 4], ["self.cdTurn:missing", 0]]) {
    assert.equal(evaluateCondition(atom(path, "==", value), ctx), true);
  }
});
test("進行・行動回数・基礎ステータス・次回ATを読む", () => {
  const ctx = context();
  ctx.actor.buffs = [{ stat: "AT", amount: 99 }];
  ctx.actor.runtime = { passive: { AT: 99, DF: 99 } };
  for (const [path, value] of [["turn", 5], ["phase", 2], ["self.actionsThisTurn", 2], ["enemy.actionsThisTurn", 1],
    ["self.at", 4], ["enemy.at", 5], ["self.df", 2], ["enemy.df", 1], ["self.sp", 3], ["enemy.sp", 2],
    ["self.nextAttackATPlus", 5]]) assert.equal(readConditionValue(path, ctx), value);
});
test("diceと既存attack情報、情報がないタイミング", () => {
  const ctx = context();
  assert.equal(evaluateCondition(atom("dice", "==", 3), ctx), true);
  for (const [key, value] of Object.entries(ctx.attack)) assert.equal(readConditionValue(`attack.${key}`, ctx), value);
  assert.equal(evaluateCondition(atom("attack.damage", ">", 10), ctx), true);
  assert.equal(readConditionValue("attack.damage", {}), undefined);
  assert.equal(readConditionValue("dice", {}), undefined);
});
test("all/anyの入れ子と短絡、既存の空条件・優先順", () => {
  const ctx = context();
  const spec = { all: [atom("enemy.status:crack", ">=", 1),
    { any: [atom("self.hpPct", "<=", 0.5), atom("self.ap", ">=", 10)] }] };
  assert.equal(evaluateCondition(spec, ctx), true);
  ctx.enemy.status.crack = 0; assert.equal(evaluateCondition(spec, ctx), false);
  assert.equal(evaluateCondition({ all: [] }, ctx), true);
  assert.equal(evaluateCondition({ any: [] }, ctx), false);
  assert.equal(evaluateCondition({ all: [], any: [] }, ctx), true);
  const neverRead = { get left() { throw Error("not short-circuited"); } };
  assert.equal(evaluateCondition({ any: [null, neverRead] }, ctx), true);
  assert.equal(evaluateCondition({ all: [false, neverRead] }, ctx), false);
});
test("演算子の既存意味を維持（厳密等価、大小は数値化）", () => {
  const ctx = context();
  assert.equal(evaluateCondition(atom("self.ap", "==", "3"), ctx), false);
  assert.equal(evaluateCondition(atom("self.ap", "!=", "3"), ctx), true);
  assert.equal(evaluateCondition(atom("self.ap", ">=", "3"), ctx), true);
  assert.equal(evaluateCondition(atom("self.ap", "<", 4), ctx), true);
  assert.equal(evaluateCondition({ left: "self.ap", right: 3 }, ctx), true);
  assert.equal(evaluateCondition(atom("self.ap", "unsupported", 3), ctx), false);
  assert.equal(evaluateCondition(null, ctx), true);
  assert.equal(evaluateCondition(undefined, ctx), true);
  assert.equal(evaluateCondition("invalid", ctx), false);
  // 未知pathで!=がtrueになる点も既存互換。今回厳格化しない。
  assert.equal(evaluateCondition(atom("unknown", "!=", 1), ctx), true);
});
test("ctx欠落・不正HP比率でthrowせず未定義を返す", () => {
  assert.equal(readConditionValue("self.hp", undefined), undefined);
  assert.equal(readConditionValue("self.status:crack", undefined), 0);
  assert.equal(readConditionValue("self.nextAttackATPlus", {}), 0);
  assert.equal(readConditionValue("actor.constructor", context()), undefined);
  for (const [hp, maxHP] of [[1, 0], [1, -1], [NaN, 10], [Infinity, 10], [1, Infinity], ["1", 10]]) {
    assert.equal(readConditionValue("self.hpPct", { actor: { hp, maxHP } }), undefined);
  }
});
test("effect.when: 通常30+亀裂時20、条件不成立なら追加効果なし", () => {
  for (const [crack, expected] of [[0, 30], [1, 50]]) {
    const ctx = context(); ctx.enemy.hp = 100; ctx.enemy.status.crack = crack;
    ctx.helpers = { dealDamage: (target, amount) => { target.hp -= amount; } };
    applyEffect([
      { type: "fixedDamage", target: "enemy", amount: 30 },
      { type: "fixedDamage", target: "enemy", amount: 20, when: atom("enemy.status:crack", ">=", 1) },
    ], ctx);
    assert.equal(ctx.enemy.hp, 100 - expected);
    assert.equal(ctx.actor.ap, 3); // 個別effect.whenはAP消費処理をしない。
  }
});
test("effect.whenは配列の各実行時点の状態を見る", () => {
  const ctx = context(); ctx.actor.ap = 0;
  applyEffect([
    { type: "changeValue", target: "self", key: "ap", op: "add", value: 2 },
    { type: "changeValue", target: "self", key: "ap", op: "add", value: 1,
      when: { all: [atom("self.ap", "==", 2), atom("enemy.status:counter", ">=", 1)] } },
  ], ctx);
  assert.equal(ctx.actor.ap, 3);
});
test("BコンパイルからrunTriggerまで既存whenが発動/抑止する", () => {
  const ctx = context();
  const spec = { all: [atom("self.hpPct", "<=", 0.5), atom("enemy.hpPct", "<=", 0.25),
    atom("self.status:crack", ">=", 1), atom("enemy.status:counter", "==", 2),
    atom("self.cdTurn:B:skill", "==", 2), atom("self.cdPhase:B:skill", "==", 1),
    atom("dice", "==", 3), atom("attack.damage", ">=", 12), atom("attack.hit", "==", true),
    atom("self.nextAttackATPlus", "==", 5)] };
  ctx.actor.battler = { bSkill: { id: "old-b", trigger: "afterDamage", when: spec,
    effect: { type: "changeValue", target: "self", key: "ap", op: "add", value: 1 } } };
  const compiled = compileAllRulesForFighter(ctx.actor);
  const logs = []; ctx.push = (...args) => logs.push(args);
  ctx.newGroupId = () => 1; ctx.withOrigin = (_, fn) => fn();
  runTrigger(Triggers.afterDamage, ctx.actor, ctx.enemy, ctx, () => compiled);
  assert.equal(ctx.actor.ap, 4); assert.ok(logs.some(entry => entry[0] === "skillTriggered"));
  ctx.enemy.status.counter = 0;
  runTrigger(Triggers.afterDamage, ctx.actor, ctx.enemy, ctx, () => compiled);
  assert.equal(ctx.actor.ap, 4);
});
test("共通評価は凍結入力を変更しない", () => {
  const ctx = context(); const spec = { all: [atom("self.hpPct", "<=", 0.5), atom("self.status:crack", ">=", 1)] };
  const before = structuredClone({ ctx, spec });
  const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(ctx); freeze(spec);
  assert.equal(evaluateCondition(spec, ctx), true);
  assert.deepEqual({ ctx, spec }, before);
});
