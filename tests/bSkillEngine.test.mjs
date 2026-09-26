import test from "node:test";
import assert from "node:assert/strict";
import { runBattle } from "../js/battleEngine.js";
import { applyEffect } from "../js/effects.js";
import { readConditionValue, evaluateCondition } from "../js/conditionEvaluator.js";
import { readModifierSource } from "../js/bPassiveModifiers.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";
import { compileBSkill } from "../js/bSkillCompiler.js";
import { createBDevCatalog } from "../js/bSkillDevFixtures.js";

const catalog = createBDevCatalog();
const compiled = (triggerId, conditionId, effectId, statusId) => compileBSkill({ type: "event", triggerId, conditionId, effectId,
  options: statusId ? { statusId } : {} }, { catalog }).bSkills;
const trait = traitId => compileBSkill({ type: "trait", traitId, options: {} }, { catalog }).bSkills;
const atom = (left, op, right) => ({ left, op, right });
const production = (triggerId, conditionId, effectId, statusId) => {
  const result = compileBSkill({ type: "event", triggerId, conditionId, effectId, options: statusId ? { statusId } : {} });
  assert.equal(result.ok, true, JSON.stringify(result)); return result.bSkills;
};
const first = { all: [atom("turn", "==", 1), atom("phase", "==", 1)] };
const change = (target, key, value, op = "set") => ({ type: "changeValue", target, key, value, op });
const status = (target, status, value) => ({ type: "changeStatus", target, status, value, op: "set" });
const rule = (id, trigger, effect, when = null) => ({ id, trigger, effect, when });
function battle(bSkills = [], { enemySkills = [], setup = [], dice = 0, enemyDice = 0, rng = () => .9, bSkill } = {}) {
  return runBattle({ p1: { battlerId: "b1", duckId: "d1" }, p2: { battlerId: "b2", duckId: "d2" },
    data: { BATTLERS: [{ id: "b1", ...(bSkill ? { bSkill } : { bSkills }), dSkill: { id: "setup", effect: setup } },
      { id: "b2", bSkills: enemySkills }], DUCKS: [
      { id: "d1", stats: { AT: 20, DF: 0, SP: 2, maxHP: 1000 }, dice: [dice] },
      { id: "d2", stats: { AT: 20, DF: 0, SP: 1, maxHP: 1000 }, dice: [enemyDice] },
    ] }, field: "test-no-field", maxTurns: 1, rng }).events;
}

test("statusTotalをcondition/effect/passiveがSSOTから共通参照", () => {
  const ctx = { actor: { ap: 0, status: {} }, enemy: { ap: 0, status: {} } };
  for (const [side, f] of [["self", ctx.actor], ["enemy", ctx.enemy]]) {
    STATUS_GROUPS.all.forEach((key, i) => { f.status[key] = i % 4; }); f.status.unknown = 100;
    for (const group of ["buff", "debuff"]) {
      const path = `${side}.statusTotal:${group}`, expected = STATUS_GROUPS[group].reduce((sum, key) => sum + f.status[key], 0);
      assert.equal(readConditionValue(path, ctx), expected); assert.equal(readModifierSource(path, ctx), expected);
      assert.equal(evaluateCondition(atom(path, ">=", expected), ctx), true);
      applyEffect(change(side, "ap", { read: path }), ctx); assert.equal(f.ap, expected);
    }
  }
});

for (const target of ["self", "enemy"]) for (const full of [false, true]) {
  test(`実heal context ${target} actual=${full ? 0 : 20}・owner保持・legacy発火`, () => {
    const side = target === "self" ? "P1" : "P2";
    const events = battle([
      rule("heal", "phaseStart", { type: "heal", target, amount: 30 }, first),
      ...compiled("after-heal", "always", "target-next-at-up"),
      rule("probe", "afterHeal", change("healTarget", "ap", 7), { all: [
        atom("heal.actual", "==", full ? 0 : 20), atom("heal.hpAfter", "==", 1000),
        atom("heal.hpPctAfter", "==", 1), atom("heal.requested", "==", 30),
        atom("heal.hpBefore", "==", full ? 1000 : 980),
      ] }),
      rule("legacy-BS05", "afterHeal", { type: "heal", target: "self", amount: 1, source: "afterHealBonus" }),
    ], { setup: full ? [] : [change(target, "hp", 980)] });
    const heals = events.filter(e => e.type === "heal");
    assert.equal(heals[0].target, side); assert.equal(heals[0].actor, "P1");
    assert.equal(heals[0].value, full ? 0 : 20);
    assert.ok(events.some(e => e.type === "valueChanged" && e.target === side && e.key === "ap" && e.after === 7));
    assert.equal(events.filter(e => e.type === "skillTriggered" && e.skill.skillId === "legacy-BS05").length, 1);
    const next = events.filter(e => e.type === "valueChanged" && e.key === "nextAttackATPlus");
    assert.equal(next.length, full ? 0 : 1); if (!full) assert.equal(next[0].target, side);
  });
}

test("回復snapshot actual/before/after、追加回復で外側contextは変化せず再帰なし", () => {
  const events = battle([
    rule("heal", "phaseStart", { type: "heal", target: "enemy", amount: 30 }, first),
    ...compiled("after-heal", "always", "target-heal"),
    rule("snapshot", "afterHeal", change("healTarget", "ap", 9), { all: [
      atom("heal.actual", "==", 20), atom("heal.hpAfter", "==", 1000), atom("heal.hpPctAfter", "==", 1),
    ] }),
  ], { setup: [change("enemy", "hp", 980)] });
  const heals = events.filter(e => e.type === "heal");
  assert.equal(heals.length, 2);
  assert.deepEqual(heals.map(e => [e.target, e.value, e.hpBefore, e.hpAfter]), [["P2", 20, 980, 1000], ["P2", 0, 1000, 1000]]);
  assert.equal(events.filter(e => e.type === "skillTriggered" && e.skill.skillId === "snapshot").length, 1);
  assert.ok(events.some(e => e.type === "valueChanged" && e.target === "P2" && e.after === 9));
});

test("最大HP割合と現在HP割合は別、HP変動後canonical passive再評価", () => {
  const events = battle([
    ...trait("hp-high-at"),
    rule("cost", "phaseStart", [{ type: "fixedDamage", target: "self", amountMaxHpPct: .2 },
      { type: "fixedDamage", target: "self", amountPct: .2 }], first),
  ], { setup: [change("self", "hp", 600)] });
  const damage = events.filter(e => e.type === "fixedDamage");
  assert.deepEqual(damage.map(e => e.value), [200, 80]);
  assert.ok(events.some(e => e.type === "passiveSkillStateChanged" && e.active === false && e.phase === 1));
});

for (const canceled of [false, true]) test(`phaseEndは1回、buff失効・status減衰より前 canceled=${canceled}`, () => {
  const events = battle([
    rule("start", "phaseStart", [
      { type: "addBuff", target: "self", stat: "AT", amount: 2, duration: { kind: "phase" } },
      status("self", "focus", 2), status("self", "crack", 2), ...(canceled ? [status("self", "roughWave", 1)] : []),
    ], first),
    rule("legacy-BS08", "phaseEnd", { type: "heal", target: "self", byStatusCount: { statuses: [...STATUS_GROUPS.buff], n: 2 } }),
  ], { setup: [change("self", "hp", 500)], rng: () => 0 });
  const phases = events.filter(e => e.type === "phaseStart" && e.actor === "P1").map(e => e.phase);
  for (const phase of phases) assert.equal(events.filter(e => e.phase === phase && e.type === "skillTriggered" && e.skill.skillId === "legacy-BS08").length, 1);
  const end = events.findIndex(e => e.type === "skillTriggered" && e.skill.skillId === "legacy-BS08");
  const expired = events.findIndex(e => e.type === "buffExpired");
  const decay = events.findIndex(e => e.code === "STATUS_DECAY" && e.status === "crack" && e.after === 1);
  assert.ok(end < expired && expired < decay);
  assert.equal(events.some(e => e.type === "actionCanceled"), canceled);
});

for (const mode of ["hit", "miss", "avoid", "counter"]) test(`after-hit compilerは実命中のみ ${mode}`, () => {
  const skills = compiled("after-hit", mode === "counter" ? "counter" : "always", "enemy-debuff", "steam");
  const events = battle([
    ...skills, ...(mode === "miss" ? [rule("miss", "beforeAttack", { type: "changeAttack", op: "miss" })] : []),
  ], { dice: mode === "counter" ? 0 : 1, enemyDice: mode === "counter" ? 1 : 0,
    setup: mode === "avoid" ? [status("enemy", "tailwind", 3)] : mode === "counter" ? [status("self", "counter", 3)] : [], rng: () => 0 });
  const activated = events.filter(e => e.type === "skillTriggered" && e.skill.skillId === skills[0].id);
  assert.equal(activated.length > 0, ["hit", "counter"].includes(mode));
});

test("trait倍率は通常攻撃でoutgoing/incoming双方へ反映、legacy倍率も保持", () => {
  const damage = events => events.filter(e => e.type === "normalDamage" && e.actor === "P1")[0].value;
  const base = damage(battle([], { dice: 1 }));
  const doubled = damage(battle(trait("damage-both-up"), { dice: 1, enemySkills: trait("damage-both-up") }));
  assert.equal(doubled, Math.trunc(base * 2.25));
  const legacy = damage(battle([], { dice: 1, bSkill: rule("BS20", "beforeAttack", { type: "changeAttack", op: "mulDamage", value: 1.5 }),
    enemySkills: [rule("BS25", "beforeTakeDamage", { type: "changeAttack", op: "mulDamage", value: .5 })] }));
  assert.equal(legacy, Math.trunc(base * .75));
});

for (const target of ["self", "enemy"]) test(`実戦healTargetへbuff/解除/APを適用 ${target}`, () => {
  const side = target === "self" ? "P1" : "P2";
  const events = battle([
    rule("heal", "phaseStart", { type: "heal", target, amount: 10 }, first),
    ...compiled("after-heal", "always", "target-buff", "focus"),
    ...compiled("after-heal", "always", "target-debuff-remove"),
    ...compiled("after-heal", "hp-medium", "target-ap-up"),
  ], { setup: [change(target, "hp", 100), status(target, "steam", 2)] });
  const grants = events.filter(e => e.type === "statusChange" && e.status === "focus" && e.delta > 0);
  assert.deepEqual(grants.map(e => [e.target, e.delta]), [[side, 2]]);
  const removals = events.filter(e => e.code === "RANDOM_STATUS_STACK_REMOVED");
  assert.deepEqual(removals.map(e => [e.target, e.status, e.before, e.after]), [[side, "steam", 2, 1]]);
  const ap = events.filter(e => e.type === "valueChanged" && e.key === "ap" && e.delta === 5);
  assert.deepEqual(ap.map(e => e.target), [side]);
});

test("beforeAttack ATはその攻撃で消費、HP特性attackTimesAddはreset後に反映", () => {
  const events = battle([
    ...compiled("before-attack", "enemy-has-debuff", "attack-at-up"), ...trait("hp-high-extra-attack"),
  ], { dice: 1, setup: [status("enemy", "crack", 3)] });
  const attacks = events.filter(e => e.type === "normalDamage" && e.actor === "P1");
  const phases = events.filter(e => e.type === "phaseStart" && e.actor === "P1");
  assert.equal(attacks.length, phases.length * 2);
  assert.equal(events.filter(e => e.code === "NEXT_ATTACK_ATPLUS_CONSUMED").length, attacks.length);
  assert.ok(events.filter(e => e.code === "NEXT_ATTACK_ATPLUS_CONSUMED").every(e => e.value === 5));
});

test("被命中回復後も確定attack contextを保持し後続のdamage条件が成立", () => {
  const events = battle([], { enemyDice: 1, dice: 1,
    enemySkills: [rule("heal", "afterTakeDamage", { type: "heal", target: "self", amount: 1 }),
      rule("damage-probe", "afterTakeDamage", change("self", "ap", 2, "add"), atom("attack.damage", ">=", 1))] });
  assert.ok(events.some(e => e.type === "skillTriggered" && e.skill.skillId === "damage-probe"));
});

function productionContext({ damage = 10, counter = false, actions = 1, ap = 0 } = {}) {
  const fighter = side => ({ side, hp: 10, maxHP: 100, ap, actionsThisTurn: actions,
    status: Object.fromEntries(STATUS_GROUPS.all.map(key => [key, 0])), nextAttackATPlus: 0 });
  const actor = fighter("P1"), enemy = fighter("P2"), heals = [], damages = [];
  const ctx = { actor, enemy, rng: () => 0, attack: { kind: "normalAttack", isCounter: counter, damage }, helpers: {
    heal: (target, amount) => { heals.push({ side: target.side, amount, ap: target.ap }); target.hp += amount; },
    dealDamage: (target, amount) => { damages.push({ side: target.side, amount }); target.hp -= amount; },
  } };
  return { actor, enemy, ctx, heals, damages, run: rules => {
    for (const r of rules) if (evaluateCondition(r.when, ctx)) applyEffect(r.effect, ctx);
  } };
}

test("production通常命中/被命中の全variantは反撃と非通常攻撃を除外、反撃専用は発動", async () => {
  const { createBSkillCatalog } = await import("../js/bSkillCatalog.js");
  for (const d of createBSkillCatalog().events.filter(d => ["after-hit", "after-take-hit"].includes(d.triggerId))) {
    const rules = production(d.triggerId, d.conditionId, d.effectId, d.optionAxes.statusId ? "random" : undefined);
    const h = productionContext({ damage: 100, counter: true, ap: 10 });
    assert.equal(evaluateCondition(rules[0].when, h.ctx), d.conditionId === "counter", d.id);
    h.ctx.attack.isCounter = false; assert.equal(evaluateCondition(rules[0].when, h.ctx), d.conditionId !== "counter", d.id);
    h.ctx.attack.kind = "fixedDamage"; assert.equal(evaluateCondition(rules[0].when, h.ctx), false, d.id);
  }
  const h = productionContext({ counter: true }); h.run(production("after-hit", "counter", "self-heal"));
  assert.equal(h.actor.hp, 13);
});

test("実battleで通常Bは反撃に反応せず、反撃Bだけ発動", () => {
  const outgoing = production("after-hit", "always", "enemy-buff-remove");
  const counter = production("after-hit", "counter", "self-heal");
  const incoming = production("after-take-hit", "always", "self-next-at-up");
  const events = battle([...outgoing, ...counter], { setup: [status("self", "counter", 3)], enemySkills: incoming, enemyDice: 1, rng: () => 0 });
  assert.ok(events.some(e => e.type === "counterDamage"));
  const count = rules => events.filter(e => e.type === "skillTriggered" && e.skill?.skillId === rules[0].id).length;
  assert.equal(count(outgoing), events.filter(e => e.type === "normalDamage" && e.actor === "P1").length);
  assert.equal(count(incoming), events.filter(e => e.type === "normalDamage" && e.actor === "P1").length);
  assert.equal(count(counter), events.filter(e => e.type === "counterDamage" && e.actor === "P1").length);
  assert.ok(count(counter) > 0);
});

test("damage7/10境界と50%回復の切り捨て・cap5/cap10", () => {
  for (const [condition, cases] of [["damage-medium", [[6,0],[7,3],[9,4],[10,5],[99,5]]],
    ["damage-high", [[9,0],[10,5],[11,5],[19,9],[20,10],[99,10]]]]) {
    for (const [damage, expected] of cases) {
      const h = productionContext({ damage }); h.run(production("after-hit", condition, "self-heal"));
      assert.equal(h.actor.hp, 10 + expected, `${condition}/${damage}`);
    }
  }
  for (const [condition, threshold, stacks] of [["damage-medium", 7, 2], ["damage-high", 10, 3]]) {
    for (const damage of [threshold - 1, threshold]) {
      const h = productionContext({ damage }); h.run(production("after-take-hit", condition, "self-buff", "focus"));
      assert.equal(h.actor.status.focus ?? 0, damage >= threshold ? stacks : 0);
    }
  }
});

test("状態異常合計の参照元self→enemy×2/×4、未指定の従来target参照も維持", () => {
  for (const [condition, n] of [["always", 2], ["first-action", 4]]) for (const actions of [1,2]) {
    const h = productionContext({ actions }); Object.assign(h.actor.status, { crack: 2, steam: 3, focus: 99, unknown: 99 });
    h.enemy.status.crack = 40;
    h.run(production("phase-end", condition, "damage-by-debuff"));
    assert.equal(h.enemy.hp, 10 - (condition === "always" || actions === 1 ? 5 * n : 0));
    assert.equal(h.actor.hp, 10);
  }
  const h = productionContext(); h.actor.status.crack = 99; h.enemy.status.crack = 3;
  applyEffect({ type: "fixedDamage", target: "enemy", byStatusCount: { statuses: ["crack"], n: 2 } }, h.ctx);
  assert.equal(h.enemy.hp, 4);
});

test("first phase-end全5variantは2回目の自分フェイズでは発動しない", () => {
  for (const id of ["heal-by-buff", "damage-by-debuff", "ap-up-cost-5", "ap-up-cost-8", "ap-up-cost-10"]) {
    const rules = production("phase-end", "first-action", id);
    const h = productionContext({ actions: 2 }); h.actor.status.focus = 3; h.actor.status.crack = 2; h.run(rules);
    assert.deepEqual([h.actor.hp,h.enemy.hp,h.actor.ap], [10,10,0]);
    const events = battle(rules);
    assert.equal(events.filter(e => e.type === "skillTriggered" && e.skill?.skillId === rules[0].id).length, 1);
  }
  const h = productionContext(); Object.assign(h.actor.status, { focus: 2, counter: 1, crack: 100 });
  h.run(production("phase-end", "first-action", "heal-by-buff")); assert.equal(h.actor.hp, 22);
});

test("被通常damage7/10のAP1消費は所持時だけ、AP回復量はcap7/10", () => {
  for (const [condition, threshold, heal, cap] of [["damage-medium",7,10,7],["damage-high",10,15,10]]) {
    for (const ap of [0,1,2]) for (const damage of [threshold-1,threshold]) {
      const h = productionContext({ ap, damage }); h.run(production("after-take-hit", condition, "ap-cost-heal"));
      const active = ap >= 1 && damage >= threshold;
      assert.equal(h.actor.ap, ap - (active ? 1 : 0)); assert.equal(h.actor.hp, 10 + (active ? heal : 0));
      if (active) assert.equal(h.heals[0].ap, ap-1);
    }
    for (const ap of [0,3,7,10,99]) {
      const h = productionContext({ ap, damage: threshold }); h.run(production("after-take-hit", condition, "heal-by-ap"));
      assert.equal(h.actor.hp, 10 + Math.min(ap,cap)); assert.equal(h.actor.ap, ap);
    }
  }
});
