import test from "node:test";
import assert from "node:assert/strict";
import { evaluateBModifier, normalizeBPassive, readModifierSource, refreshPassiveBonuses } from "../js/bPassiveModifiers.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";
import { applyEffect } from "../js/effects.js";
import { runBattle } from "../js/battleEngine.js";
import { Triggers, compileAllRulesForFighter } from "../js/ruleEngine.js";
import { compileBSkill } from "../js/bSkillCompiler.js";

const cond = (left, op = ">=", right = 1, bonus = { AT: 2 }) =>
  ({ kind: "conditional", when: { left, op, right }, bonus });
const scaled = (source, extra = {}) => ({ kind: "scaled", source, targetStat: "AT", scale: 1, offset: 0, min: 0, max: 5, ...extra });
const passive = (modifier, id = "p") => ({ id, trigger: "passive", modifier });
const value = (key, amount, target = "self") => ({ type: "changeValue", key, target, op: "set", value: amount });
const status = (key, amount, target = "self", op = "set") => ({ type: "changeStatus", status: key, target, op, value: amount });
const turn1 = { left: "turn", op: "==", right: 1 };
const first = { all: [turn1, { left: "phase", op: "==", right: 1 }] };
const event = (trigger, effect, when = first, id = trigger) => ({ id, trigger, effect, when });

function harness(skills, enemySkills = []) {
  const fighter = (side, bSkills) => ({ side, hp: 100, maxHP: 100, ap: 0, buffs: [], battler: { bSkills },
    status: Object.fromEntries(STATUS_GROUPS.all.map(key => [key, 0])) });
  const actor = fighter("P1", skills), enemy = fighter("P2", enemySkills), logs = [];
  const ctx = { turn: 1, actor, enemy, push: (type, side, data) => logs.push({ type, side, ...data }), helpers: {} };
  ctx.helpers.refreshPassives = () => {
    refreshPassiveBonuses(ctx, actor); refreshPassiveBonuses(ctx, enemy);
  };
  ctx.helpers.refreshPassives();
  return { ctx, actor, enemy, logs, sync: ctx.helpers.refreshPassives, apply: effect => applyEffect(effect, ctx) };
}
function battle(bSkills, { enemySkills = [], dEffect, cSkill, aSkill, dice = 1, maxTurns = 1, rng = () => .9 } = {}) {
  return runBattle({ p1: { battlerId: "b1", duckId: "d1" }, p2: { battlerId: "b2", duckId: "d2" },
    data: { BATTLERS: [{ id: "b1", bSkills, dSkill: { id: "D", effect: dEffect } }, { id: "b2", bSkills: enemySkills }],
      DUCKS: [{ id: "d1", stats: { AT: 5, DF: 5, SP: 2, maxHP: 1000 }, dice: [dice], aSkill, cSkill },
        { id: "d2", stats: { AT: 5, DF: 5, SP: 1, maxHP: 1000 }, dice: [1] }] },
    maxTurns, field: "test-no-field", rng }).events;
}
const changes = (logs, id = "p") => logs.filter(e => e.skill?.skillId === id && ["passiveSkillStateChanged", "passiveModifierChanged"].includes(e.type));
const attacks = logs => logs.filter(e => e.type === "normalDamage" && e.actor === "P1").map(e => e.value);

for (const side of ["self", "enemy"]) {
  for (const op of ["<=", ">="]) test(`${side}.hpPct ${op}がdamage/healで反転`, () => {
    const logs = battle([passive(cond(`${side}.hpPct`, op, .5)),
      event("beforeRoll", { type: "fixedDamage", target: side, amount: 600 }),
      event("phaseEnd", { type: "heal", target: side, amount: 1000 })]);
    assert.deepEqual(changes(logs).map(e => e.active), op === "<=" ? [true, false] : [true, false, true]);
    assert.equal(changes(logs).at(-1).after.AT, op === "<=" ? 0 : 2);
  });
  test(`${side}.ap条件は増減直後に更新、同じ状態では無ログ`, () => {
    const h = harness([passive(cond(`${side}.ap`, ">=", 3))]);
    h.apply(value("ap", 3, side)); h.sync(); h.sync();
    assert.equal(h.actor.runtime.passive.AT, 2);
    h.apply(value("ap", 2, side)); h.sync();
    assert.equal(h.actor.runtime.passive.AT, 0);
    assert.deepEqual(changes(h.logs).map(e => e.active), [true, false]);
  });
  test(`${side}.status条件は付与・直接減少に追従`, () => {
    const h = harness([passive(cond(`${side}.status:crack`))]);
    h.apply(status("crack", 2, side)); h.apply(status("crack", -2, side, "add"));
    assert.deepEqual(changes(h.logs).map(e => e.active), [true, false]);
  });
  test(`${side}.ap scaledは加算・clamp・値不変のログ抑制`, () => {
    const h = harness([passive(scaled(`${side}.ap`))]);
    for (const n of [2, 3, 3, 8, 9, 0]) { h.apply(value("ap", n, side)); h.sync(); }
    assert.deepEqual(changes(h.logs).map(e => e.after.AT), [2, 3, 5, 0]);
  });
  test(`${side}.status:crack scaledはstackの現在値`, () => {
    const h = harness([passive(scaled(`${side}.status:crack`))]);
    for (const n of [2, 1, 0]) h.apply(status("crack", n, side));
    assert.deepEqual(changes(h.logs).map(e => e.after.AT), [2, 1, 0]);
  });
  for (const group of ["debuff", "buff"]) test(`${side}.statusTotal:${group}は分類内stackのみを合計`, () => {
    const h = harness([passive(scaled(`${side}.statusTotal:${group}`, { max: 20 }))]);
    const target = side === "self" ? h.actor : h.enemy;
    // 集計のfixture。付与・消費経路は別の統合テストで検証する。
    Object.assign(target.status, { crack: 2, Headwind: 1, steam: 2, tailwind: 2, focus: 1, counter: 1, unknown: 999 });
    h.sync();
    assert.equal(h.actor.runtime.passive.AT, group === "debuff" ? 5 : 4);
    assert.equal(readModifierSource(`${side}.statusTotal:${group}`, h.ctx), group === "debuff" ? 5 : 4);
  });
}
for (const [op, expected] of [["<=", [[1, true], [3, false]]], [">=", [[2, true]]], ["==", [[2, true], [3, false]]]]) {
  test(`turn ${op} 2を進行時に更新しturn0のONログなし`, () => {
    const logs = battle([passive(cond("turn", op, 2))], { maxTurns: 3 });
    assert.deepEqual(changes(logs).map(e => [e.turn, e.active]), expected);
    assert.ok(changes(logs).every(e => e.phase === 0));
  });
}
test("初期化はcanonical無効・無ログ、旧形式の初期補正は維持", () => {
  const h = harness([]); h.ctx.turn = 0;
  h.actor.battler.bSkills = [passive(cond("turn", "<=", 3)),
    { id: "old", trigger: "passiveHp", hpCond: { op: ">=", value: .6 }, bonus: { DF: 2 } }];
  h.sync(); assert.equal(h.actor.runtime.passive.AT, 0); assert.equal(h.actor.runtime.passive.DF, 2);
  assert.equal(changes(h.logs).length, 0);
  h.ctx.turn = 1; h.sync(); assert.equal(h.actor.runtime.passive.AT, 2);
});
test("scaledのscale/offset/min/max、負数・小数は式のまま、max5固定なし", () => {
  const ctx = { actor: { ap: 3 }, enemy: {} };
  for (const [extra, expected] of [[{ scale: 2, offset: -1, min: -10, max: 10 }, 5],
    [{ scale: -2, offset: 1, min: -4, max: 10 }, -4], [{ scale: 0, offset: 7, min: 0, max: 10 }, 7],
    [{ scale: .5, offset: .25, max: 10 }, 1.75], [{ min: 4 }, 4], [{ max: 2 }, 2]]) {
    assert.equal(evaluateBModifier(scaled("self.ap", extra), ctx).AT, expected);
  }
});
test("両者参照を所有者へ向け直す（呼出ctxが逆向きでも同じ）", () => {
  const h = harness([passive(scaled("enemy.ap"))], [passive(scaled("self.ap"))]);
  h.apply(value("ap", 3, "enemy"));
  assert.equal(h.actor.runtime.passive.AT, 3); assert.equal(h.enemy.runtime.passive.AT, 3);
  [h.ctx.actor, h.ctx.enemy] = [h.enemy, h.actor]; h.sync();
  assert.equal(h.actor.runtime.passive.AT, 3); assert.equal(h.enemy.runtime.passive.AT, 3);
  assert.equal(changes(h.logs).length, 2);
});
test("同一ID conditional/scaled、負補正をすべて独立合算", () => {
  const h = harness([passive(cond("turn")), passive(cond("turn", ">=", 1, { AT: -1, DF: 2 })),
    passive(scaled("self.ap")), passive(scaled("self.ap"))]);
  h.apply(value("ap", 3));
  assert.equal(h.actor.runtime.passive.AT, 7); assert.equal(h.actor.runtime.passive.DF, 2);
  assert.equal(h.actor.buffs.length, 0);
  assert.deepEqual(changes(h.logs).map(e => e.modifierIndex), [0, 1, 2, 3]);
  const length = h.logs.length; h.sync(); assert.equal(h.logs.length, length);
});
for (const kind of ["phase", "turns"]) test(`常時補正と${kind} buffが実ダメージで加算`, () => {
  const duration = kind === "phase" ? { kind } : { kind, count: 1 };
  const logs = battle([passive(cond("turn")), passive(scaled("self.ap")),
    event("beforeDiceResolve", { type: "addBuff", stat: "AT", amount: 3, duration })]);
  assert.deepEqual(attacks(logs), kind === "phase" ? [8, 5] : [8, 8]);
});
for (const key of STATUS_GROUPS.all) test(`${key}付与・発動消費/自然減衰を両者のmodifierへ同期`, () => {
  const p = [passive(scaled(`self.status:${key}`, { max: 20 })), passive(cond(`self.status:${key}`), "c")];
  if (key === "clean") p.push(event("phaseStart", status("crack", 2, "self", "add")));
  const logs = battle(p, {
    enemySkills: [passive(scaled(`enemy.status:${key}`, { max: 20 }), "enemy-watch")],
    dEffect: status(key, key === "clean" ? 2 : 1),
    aSkill: { id: "A", trigger: "onDice=1", effect: value("ap", 1) },
  });
  assert.deepEqual(changes(logs).map(e => e.after.AT), key === "tailwind" || key === "counter" ? [1, 0] : key === "clean" ? [2, 0] : [1, 0]);
  assert.deepEqual(changes(logs, "enemy-watch").map(e => e.after.AT), key === "clean" ? [2, 0] : [1, 0]);
  assert.deepEqual(changes(logs, "c").map(e => e.active), [true, false]);
});
test("出目4の直接counter付与もbuff合計へ同期", () => {
  const logs = battle([passive(scaled("self.statusTotal:buff"))], { dice: 4 });
  assert.deepEqual(changes(logs).map(e => e.after.AT), [1, 0, 1]);
});
test("複数stackの亀裂自然減衰でscaled合計が2→1→0", () => {
  const logs = battle([passive(scaled("self.statusTotal:debuff"))], { dEffect: status("crack", 2) });
  assert.deepEqual(changes(logs).map(e => e.after.AT), [2, 1, 0]);
});
test("荒波キャンセル経路でも減衰とmodifier同期を行う", () => {
  const logs = battle([passive(scaled("self.statusTotal:debuff"))], { dEffect: [status("roughWave", 1), status("crack", 2)], rng: () => 0 });
  assert.ok(logs.some(e => e.type === "actionCanceled" && e.reason === "roughWave"));
  assert.deepEqual(changes(logs).map(e => e.after.AT), [3, 2, 1, 0]);
});
for (const old of [
  { trigger: "passiveHp", hpCond: { op: ">=", value: .6 }, bonus: { AT: 2, DF: 2 } },
  { trigger: "passiveHp", hpCond: { op: "<=", value: .4 }, bonus: { AT: 3, DF: 1 } },
  { trigger: "passiveAp", apBonus: { stat: "AT", bias: 0, min: 0, max: 5 } },
  { trigger: "passiveAp", apBonus: { stat: "DF", bias: -2, min: -2, max: 3 } },
]) test(`旧${old.trigger} ${JSON.stringify(old)}とcanonicalは戦闘結果同値`, () => {
  const actions = [event("beforeRoll", value("hp", 350)), event("phaseEnd", { type: "heal", amount: 1000, target: "self" })];
  const legacy = battle([{ id: "old", ...old }, ...actions], { maxTurns: 3 });
  const modern = battle([passive(normalizeBPassive(old)), ...actions], { maxTurns: 3 });
  const outcomes = events => events.filter(e => ["normalDamage", "heal", "turnEnd", "battleEnd"].includes(e.type))
    .map(e => [e.type, e.actor, e.value, e.result]);
  assert.deepEqual(outcomes(legacy), outcomes(modern));
});
test("旧APのbias/整数化・既定値と旧HPのop制限を維持", () => {
  const modifier = normalizeBPassive({ trigger: "passiveAp", apBonus: { stat: "AT", bias: -1.7 } });
  assert.equal(evaluateBModifier(modifier, { actor: { ap: 3.9 } }).AT, 2);
  assert.equal(normalizeBPassive({ trigger: "passiveHp", hpCond: { op: ">", value: .5 }, bonus: { AT: 2 } }), null);
});
test("通常Cと特殊CのAP消費直後も両者のmodifierを同期", () => {
  for (const special of [false, true]) {
    const logs = battle([passive(scaled("self.ap"))], { cSkill: { id: "C", trigger: special ? "beforeTurnEnd" : undefined,
      costAP: 1, effect: special ? { type: "revive", hp: 100 } : value("hp", 1000) },
      dEffect: special ? value("hp", -100) : undefined,
      enemySkills: [passive(scaled("enemy.ap"), "watch")] });
    const c = logs.find(e => e.type === "cSkillActivated"); assert.ok(c);
    assert.ok(changes(logs).some(e => e.after.AT < e.before.AT));
    assert.ok(changes(logs, "watch").some(e => e.after.AT < e.before.AT));
  }
});
test("passiveはeventとしてcompileせず、beforeAttack/beforeTakeDamageのchangeAttack順を保持", () => {
  assert.equal(Object.values(Triggers).includes("passive"), false);
  assert.deepEqual(compileAllRulesForFighter({ side: "P1", battler: { bSkills: [passive(cond("turn"))] } }), []);
  const logs = battle([passive(cond("turn")), event("beforeAttack", { type: "changeAttack", op: "mulDamage", value: 2 })],
    { enemySkills: [event("beforeTakeDamage", { type: "changeAttack", op: "mulDamage", value: .5 })] });
  assert.equal(attacks(logs)[0], 4);
  assert.deepEqual(logs.filter(e => e.phase === 1 && e.type === "skillTriggered").map(e => e.trigger), ["beforeAttack", "beforeTakeDamage"]);
});
test("不明source・不正係数は補正なし、凍結入力の純粋評価", () => {
  const modifier = Object.freeze(scaled("enemy.statusTotal:debuff"));
  const ctx = Object.freeze({ enemy: Object.freeze({ status: Object.freeze({ crack: 2 }) }) });
  assert.equal(evaluateBModifier(modifier, ctx).AT, 2);
  for (const extra of [{ source: "self.hp" }, { scale: NaN }, { min: 4, max: 2 }])
    assert.equal(evaluateBModifier(scaled("self.ap", extra), { actor: { ap: 3 } }).AT, 0);
});

test("production HP75以上/50以上/50以下/25以下は境界とHP変動でON/OFF再評価", () => {
  for (const [level, hp, delta, bonus] of [["high",75,-1,6],["mid-high",50,-1,4],["mid-low",50,1,4],["low",25,1,6]]) {
    for (const stat of ["AT", "DF"]) {
      const result = compileBSkill({ type: "trait", traitId: `hp-${level}-${stat.toLowerCase()}`, options: {} });
      assert.equal(result.ok, true); const h = harness(result.bSkills);
      h.apply(value("hp", hp)); assert.equal(h.actor.runtime.passive[stat], bonus);
      h.apply(value("hp", hp + delta)); assert.equal(h.actor.runtime.passive[stat], 0);
      h.apply(value("hp", hp)); assert.equal(h.actor.runtime.passive[stat], bonus);
    }
  }
});

test("production AP/5-APのAT/DFは上限5・下限0、AP変動へ追従", () => {
  for (const stat of ["AT", "DF"]) for (const inverse of [false,true]) {
    const result = compileBSkill({ type: "trait", traitId: `ap-${inverse ? "inverse-" : ""}${stat.toLowerCase()}`, options: {} });
    assert.equal(result.ok, true); const h = harness(result.bSkills);
    for (const ap of [0,1,3,5,8,2,0]) {
      h.apply(value("ap", ap));
      assert.equal(h.actor.runtime.passive[stat], inverse ? Math.max(0,5-ap) : Math.min(5,ap));
    }
  }
});
