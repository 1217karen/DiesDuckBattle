import test from "node:test";
import assert from "node:assert/strict";
import { createBSkillCatalog } from "../js/bSkillCatalog.js";
import { createBDevCatalog } from "../js/bSkillDevFixtures.js";
import { compileBSkill, validateBSkillSelection } from "../js/bSkillCompiler.js";
import { evaluateCondition } from "../js/conditionEvaluator.js";
import { applyEffect } from "../js/effects.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";
import { evaluateBModifier } from "../js/bPassiveModifiers.js";
import { migrateSelection } from "../js/selectionNormalization.js";

const catalog = createBDevCatalog();
const event = (triggerId, conditionId, effectId, statusId) => ({ type: "event", triggerId, conditionId, effectId,
  options: statusId ? { statusId } : {} });
const trait = traitId => ({ type: "trait", traitId, options: {} });
const compile = selection => {
  const result = compileBSkill(selection, { catalog }); assert.equal(result.ok, true, JSON.stringify(result)); return result.bSkills;
};
const chosen = d => d.triggerId ? event(d.triggerId, d.conditionId, d.effectId, d.optionAxes.statusId ? catalog.optionSets[d.optionAxes.statusId][0].id : undefined) : trait(d.id);

test("productionの指定/ランダム状態はv2でもtrustedに解決、raw @groupは拒否", () => {
  const production = createBSkillCatalog();
  for (const [trigger, effect, group, specific] of [["after-hit", "enemy-debuff", "debuff", "crack"], ["after-take-hit", "self-buff", "buff", "focus"]]) {
    for (const status of [specific, "random"]) {
      const s = event(trigger, "always", effect, status);
      for (const selection of [s, migrateSelection("B", s, production)]) {
        const r = compileBSkill(selection); assert.equal(r.ok, true);
        assert.equal(r.bSkills[0].effect.status, status === "random" ? `@${group}` : specific);
      }
    }
    assert.equal(compileBSkill(event(trigger, "always", effect, `@${group}`)).ok, false);
  }
});

test("削除済み4selectionはvalidation error、別効果へ変換しない", () => {
  for (const s of [event("after-hit", "always", "enemy-next-at-down"),
    event("after-take-hit", "damage-medium", "enemy-next-at-down"), event("after-take-hit", "damage-high", "enemy-next-at-down"),
    event("after-take-hit", "damage-high", "damage-by-enemy-ap"),
    { type: "event", triggerId: "after-hit", conditionId: "always", effectId: "change-next-at", targetId: "enemy", options: { direction: "decrease" } },
    { type: "event", triggerId: "after-take-hit", conditionId: "damage-high", effectId: "damage-by-ap", targetId: "enemy", options: {} },
  ]) {
    const snapshot = structuredClone(s), result = compileBSkill(s);
    assert.equal(result.ok, false); assert.equal(result.bSkills, null); assert.ok(result.errors.length);
    assert.deepEqual(s, snapshot);
  }
});

test("新first phase-endとAP逆補正のtrusted値をcompile", () => {
  const r = compileBSkill(event("phase-end", "first-action", "damage-by-debuff"));
  assert.equal(r.ok, true); assert.equal(r.bSkills[0].trigger, "phaseEnd");
  assert.deepEqual(r.bSkills[0].when, { left: "self.actionsThisTurn", op: "==", right: 1 });
  assert.deepEqual(r.bSkills[0].effect.byStatusCount, { source: "self", statuses: STATUS_GROUPS.debuff, n: 4 });
  for (const stat of ["AT", "DF"]) {
    const result = compileBSkill(trait(`ap-inverse-${stat.toLowerCase()}`)); assert.equal(result.ok, true);
    assert.deepEqual(result.bSkills[0].modifier, { kind: "scaled", source: "self.ap", targetStat: stat, scale: -1, offset: 5, min: 0, max: 5 });
  }
});
function harness() {
  const fighter = side => ({ side, hp: 40, maxHP: 100, ap: 5, actionsThisTurn: 1,
    nextAttackATPlus: 0, temp: { attackTimesAdd: 0 }, status: Object.fromEntries(STATUS_GROUPS.all.map(k => [k, 0])) });
  const actor = fighter("P1"), enemy = fighter("P2"), logs = [];
  const ctx = { actor, enemy, rng: () => 0, attack: { kind: "normalAttack", isCounter: false, damage: 30 },
    push: (type, side, data) => logs.push({ type, side, ...data }), helpers: {
      heal: (f, amount) => { f.hp = Math.min(f.maxHP, f.hp + amount); logs.push({ type: "heal", ap: f.ap }); },
      dealDamage: (f, amount) => { f.hp -= amount; },
    } };
  return { ctx, actor, enemy, logs, run: selection => {
    for (const rule of compile(selection)) if (evaluateCondition(rule.when, ctx)) applyEffect(rule.effect, ctx);
  } };
}

test("production/dev全完成optionはcompile可能", () => {
  const production = createBSkillCatalog();
  for (const definition of [...catalog.events, ...catalog.traits]) {
    const selection = chosen(definition), result = compileBSkill(selection);
    assert.equal(result.valid, true);
    const original = [...production.events, ...production.traits].find(d => d.id === definition.id);
    assert.ok(Object.values(original.tuning).every(Number.isFinite));
    assert.equal(result.ok, true); assert.deepEqual(result.unresolved, []);
    assert.ok(compile(selection).length);
  }
  assert.deepEqual(production.triggers.map(t => t.engineTrigger), ["phaseStart", "beforeAttack", "afterDamage", "afterTakeDamage", "afterHeal", "phaseEnd"]);
  assert.equal(JSON.stringify(production.traits).includes("statusTotal"), false);
});

test("DTOはIDのみ、raw・未知・違法組合せ・status別groupを拒否", () => {
  const valid = event("after-hit", "always", "enemy-debuff", "crack");
  for (const key of ["trigger", "when", "effect", "amount", "multiplier", "threshold", "apCost"])
    assert.equal(validateBSkillSelection({ ...valid, [key]: 1 }).valid, false);
  for (const key of ["triggerId", "conditionId", "effectId"])
    assert.equal(validateBSkillSelection({ ...valid, [key]: "unknown" }).valid, false);
  for (const options of [{ statusId: "unknown" }, { statusId: "focus" }, { statusId: "crack", amount: 3 }, { statusId: 1 }])
    assert.equal(validateBSkillSelection({ ...valid, options }).valid, false);
  for (const selection of [trait("unknown"), { ...trait("ap-at"), effect: {} },
    event("phase-start", "always", "both-buff", "focus"),
    event("before-attack", "self-has-buff", "attack-at-up"),
    event("after-take-hit", "always", "heal-by-ap"),
    event("after-take-hit", "damage-medium", "damage-by-enemy-ap"),
    event("phase-end", "always", "enemy-buff-remove")])
    assert.equal(validateBSkillSelection(selection).valid, false, JSON.stringify(selection));
});

test("trusted tuningの不正数値は拒否、capなしは明示falseのみ", () => {
  for (const value of [-1, NaN, "2", .5]) {
    const custom = createBDevCatalog(), d = custom.events.find(d => d.effectId === "ap-cost-heal"); d.tuning.apCost = value;
    assert.throws(() => compileBSkill(chosen(d), { catalog: custom }), TypeError);
  }
  const custom = createBDevCatalog(), d = custom.events.find(d => d.effectId === "heal-by-ap"); d.tuning.healCap = false;
  assert.equal(Object.hasOwn(compileBSkill(chosen(d), { catalog: custom }).bSkills[0].effect, "max"), false);
});

test("phaseStartのrandom packageと所有者のfirst action条件", () => {
  const h = harness(); h.run(event("phase-start", "always", "both-buff"));
  assert.equal(h.actor.status.tailwind, 2); assert.equal(h.enemy.status.tailwind, 2);
  const rule = compile(event("phase-start", "first-action", "self-buff"))[0];
  h.ctx.phase = 5; assert.equal(evaluateCondition(rule.when, h.ctx), true);
  h.actor.actionsThisTurn = 2; assert.equal(evaluateCondition(rule.when, h.ctx), false);
});

test("beforeAttackのdebuff条件と総stack AT（capなし・normal限定）", () => {
  for (const target of ["self", "enemy"]) {
    const h = harness(), selection = event("before-attack", `${target}-has-debuff`, "attack-at-up");
    h.run(selection); assert.equal(h.actor.nextAttackATPlus, 0);
    (target === "self" ? h.actor : h.enemy).status.crack = 1;
    h.run(selection); assert.equal(h.actor.nextAttackATPlus, 5);
    h.ctx.attack.isCounter = true; h.run(selection); assert.equal(h.actor.nextAttackATPlus, 5);
  }
  const h = harness(); for (const key of STATUS_GROUPS.debuff) h.actor.status[key] = 3;
  h.run(event("before-attack", "self-debuff-total", "attack-at-by-debuff"));
  assert.equal(h.actor.nextAttackATPlus, 12);
});

test("afterDamageの確定damage閾値・counter条件・付与中buff解除", () => {
  const h = harness(); h.enemy.status.focus = 2;
  const selection = event("after-hit", "damage-medium", "enemy-buff-remove");
  h.ctx.attack.damage = 9; h.run(selection); assert.equal(h.enemy.status.focus, 2);
  h.ctx.attack.damage = 10; h.run(selection); assert.equal(h.enemy.status.focus, 1);
  const counter = compile(event("after-hit", "counter", "enemy-debuff", "steam"))[0];
  assert.equal(counter.trigger, "afterDamage"); assert.equal(evaluateCondition(counter.when, h.ctx), false);
  h.ctx.attack.isCounter = true; assert.equal(evaluateCondition(counter.when, h.ctx), true);
});

test("AP参照回復、AP不足不発、AP消費後回復", () => {
  const h = harness(); h.run(event("after-take-hit", "damage-high", "heal-by-ap")); assert.equal(h.actor.hp, 45);
  h.actor.ap = 2; h.run(event("after-take-hit", "damage-high", "ap-cost-heal"));
  assert.equal(h.actor.ap, 2); assert.equal(h.actor.hp, 45);
  h.actor.ap = 3; h.run(event("after-take-hit", "damage-high", "ap-cost-heal"));
  assert.equal(h.actor.ap, 0); assert.equal(h.actor.hp, 65); assert.equal(h.logs.at(-1).ap, 0);
});

test("healTargetへbuff/AP/nextAT/解除、actual=0は不発、緊急複合", () => {
  for (const target of ["actor", "enemy"]) {
    const h = harness(), f = h[target]; f.status.crack = 3;
    h.ctx.heal = { target: f, actual: 0, hpPctAfter: .2 };
    h.run(event("after-heal", "always", "target-buff", "focus")); assert.equal(f.status.focus, 0);
    h.ctx.heal.actual = 1;
    h.run(event("after-heal", "always", "target-buff", "focus")); assert.equal(f.status.focus, 2);
    h.run(event("after-heal", "hp-medium", "target-ap-up")); assert.equal(f.ap, 10);
    h.run(event("after-heal", "always", "target-next-at-up")); assert.equal(f.nextAttackATPlus, 5);
    h.run(event("after-heal", "hp-low", "emergency", "counter")); assert.equal(f.status.crack, 0); assert.equal(f.status.counter, 3);
    const untouched = target === "actor" ? h.enemy : h.actor;
    assert.equal(untouched.ap, 5); assert.equal(untouched.nextAttackATPlus, 0);
  }
});

test("phaseEnd buff総量回復、maxHPコスト後効果", () => {
  const h = harness(); h.actor.status.focus = 2; h.actor.status.clean = 1;
  h.run(event("phase-end", "always", "heal-by-buff")); assert.equal(h.actor.hp, 46);
  h.run(event("phase-end", "always", "ap-up-cost-5"));
  assert.equal(h.actor.hp, 36); assert.equal(h.actor.ap, 10); // dev専用10%/AP+5
});

test("HP/AP canonical passive、攻撃回数、倍率の複数rule展開", () => {
  const h = harness();
  assert.equal(evaluateBModifier(compile(trait("hp-low-at-df"))[0].modifier, h.ctx).AT, 3);
  assert.equal(evaluateBModifier(compile(trait("ap-df"))[0].modifier, h.ctx).DF, 5);
  const extra = compile(trait("hp-low-extra-attack"))[0]; assert.equal(extra.trigger, "beforeRoll");
  h.run(trait("hp-low-extra-attack")); assert.equal(h.actor.temp.attackTimesAdd, 1);
  const rules = compile(trait("damage-both-up"));
  assert.deepEqual(rules.map(r => r.trigger), ["beforeAttack", "beforeTakeDamage"]);
  for (const rule of rules) { assert.equal(evaluateCondition(rule.when, h.ctx), true); applyEffect(rule.effect, h.ctx); }
  assert.equal(h.ctx.attack.damageMul, 2.25);
  h.ctx.attack.isCounter = true; assert.ok(rules.every(r => !evaluateCondition(r.when, h.ctx)));
  for (const id of ["outgoing-random", "incoming-random"]) {
    const rule = compile(trait(id))[0]; h.ctx.attack = { damageMul: 1 }; applyEffect(rule.effect, h.ctx);
    assert.equal(h.ctx.attack.damageMul, 0);
  }
});
