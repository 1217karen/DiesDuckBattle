import test from "node:test";
import assert from "node:assert/strict";
import { createBSkillCatalog } from "../js/bSkillCatalog.js";
import { compileBSkill } from "../js/bSkillCompiler.js";
import { evaluateCondition } from "../js/conditionEvaluator.js";
import { evaluateBModifier } from "../js/bPassiveModifiers.js";
import { applyEffect } from "../js/effects.js";
import { runBattle } from "../js/battleEngine.js";
import { compileASkill } from "../js/aSkillCompiler.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";

const catalog = createBSkillCatalog();
const event = (triggerId, conditionId, effectId, statusId) => ({ type: "event", triggerId, conditionId, effectId,
  options: statusId ? { statusId } : {} });
const trait = traitId => ({ type: "trait", traitId, options: {} });
const compile = selection => {
  const r = compileBSkill(selection); assert.equal(r.ok, true, JSON.stringify(r)); return r.bSkills;
};
function context() {
  const fighter = side => ({ side, hp: 20, maxHP: 100, ap: 0, actionsThisTurn: 1, nextAttackATPlus: 0,
    temp: { attackTimesAdd: 0 }, status: Object.fromEntries(STATUS_GROUPS.all.map(k => [k, 0])) });
  const actor = fighter("P1"), enemy = fighter("P2"), log = [];
  const ctx = { actor, enemy, rng: () => 0, attack: { kind: "normalAttack", isCounter: false, damage: 8 },
    push: (type, side, data) => log.push({ type, side, ...data }), helpers: {
      heal: (f, n) => { log.push({ type: "healing", amount: n, ap: f.ap }); f.hp += n; },
      dealDamage: (f, n) => { log.push({ type: "damage", amount: n, ap: f.ap }); f.hp -= n; },
    } };
  return { actor, enemy, ctx, log, run(selection) {
    for (const r of compile(selection)) if (evaluateCondition(r.when, ctx)) applyEffect(r.effect, ctx);
  } };
}

test("production event56/trait14、重複なし、全status optionでcompile、未解決tuningなし", () => {
  assert.equal(catalog.events.length, 56); assert.equal(catalog.traits.length, 14);
  const definitions = [...catalog.events, ...catalog.traits];
  assert.equal(new Set(definitions.map(d => d.id)).size, 70);
  for (const d of definitions) {
    assert.ok(Object.values(d.tuning).every(Number.isFinite), d.id);
    const choices = d.optionAxes.statusId ? catalog.optionSets[d.optionAxes.statusId].map(o => o.id) : [undefined];
    for (const status of choices) {
      const s = d.triggerId ? event(d.triggerId, d.conditionId, d.effectId, status) : trait(d.id);
      const r = compileBSkill(s); assert.equal(r.complete, true, d.id); assert.deepEqual(r.unresolved, []);
      assert.ok(r.bSkills.length);
    }
  }
  for (const s of [event("after-take-hit", "damage-medium", "heal-by-ap"),
    ...["ap-up", "self-buff", "self-debuff-remove"].map(id => event("phase-end", "hp-high", id))])
    assert.equal(compileBSkill(s).ok, false);
});

test("phaseStart 全9候補: 通常1、確率50%、first強型2、first-action条件", () => {
  for (const d of catalog.events.filter(d => d.triggerId === "phase-start")) {
    const r = compile(event(d.triggerId, d.conditionId, d.effectId))[0];
    for (const e of [r.effect].flat()) {
      assert.equal(e.value, d.effectId.includes("strong") ? 2 : 1);
      assert.equal(e.chance, d.effectId.startsWith("chance") ? .5 : undefined);
    }
    const h = context(); assert.equal(evaluateCondition(r.when, h.ctx), true);
    h.actor.actionsThisTurn = 2;
    assert.equal(evaluateCondition(r.when, h.ctx), d.conditionId === "always");
  }
});

test("beforeAttack: debuff存在AT+3、総stack4以上で現在総量、counter除外", () => {
  for (const side of ["self", "enemy"]) {
    const h = context(), s = event("before-attack", `${side}-has-debuff`, "attack-at-up");
    h.run(s); assert.equal(h.actor.nextAttackATPlus, 0);
    (side === "self" ? h.actor : h.enemy).status.crack = 1;
    h.run(s); assert.equal(h.actor.nextAttackATPlus, 3);
    h.ctx.attack.isCounter = true; h.run(s); assert.equal(h.actor.nextAttackATPlus, 3);
  }
  for (const total of [3, 4, 7]) {
    const h = context(); h.actor.status.crack = 3; h.actor.status.steam = total - 3;
    h.run(event("before-attack", "self-debuff-total", "attack-at-by-debuff"));
    assert.equal(h.actor.nextAttackATPlus, total >= 4 ? total : 0);
  }
});

for (const [condition, threshold, stacks, repeat, amount] of [
  ["always", 0, 1, 1, 2], ["damage-medium", 5, 1, 2, 4], ["damage-high", 8, 2, 3, 6], ["counter", 0, 1, 2, 3],
]) test(`afterDamage ${condition}: 3系統と境界`, () => {
  for (const [id, key, value, status] of [["enemy-debuff", "value", stacks, "steam"],
    ["enemy-buff-remove", "repeat", repeat], ["enemy-next-at-down", "value", -amount]]) {
    const r = compile(event("after-hit", condition, id, status))[0]; assert.equal(r.effect[key], value);
    const h = context(); h.ctx.attack.damage = threshold; h.ctx.attack.isCounter = condition === "counter";
    assert.equal(evaluateCondition(r.when, h.ctx), true);
    if (threshold) { h.ctx.attack.damage--; assert.equal(evaluateCondition(r.when, h.ctx), false); }
    if (condition === "counter") { h.ctx.attack.isCounter = false; assert.equal(evaluateCondition(r.when, h.ctx), false); }
  }
});

test("afterTakeDamage: status/AT量、damage5/8境界、常時1stack", () => {
  for (const [condition, threshold, stacks, amount] of [["always", 0, 1], ["damage-medium", 5, 2, 4], ["damage-high", 8, 3, 6]]) {
    const rows = [["self-buff", stacks, "focus"], ["enemy-debuff", stacks, "steam"]];
    if (amount) rows.push(["self-next-at-up", amount], ["enemy-next-at-down", -amount]);
    for (const [id, value, status] of rows) {
      const r = compile(event("after-take-hit", condition, id, status))[0]; assert.equal(r.effect.value, value);
      const h = context(); h.ctx.attack.damage = threshold; assert.equal(evaluateCondition(r.when, h.ctx), true);
      if (threshold) { h.ctx.attack.damage--; assert.equal(evaluateCondition(r.when, h.ctx), false); }
    }
  }
});

test("受damage8: AP比例heal cap10、AP1消費→heal15、敵APdamage無上限", () => {
  for (const [ap, expected] of [[3, 3], [8, 8], [15, 10]]) {
    const h = context(); h.actor.ap = ap;
    h.ctx.attack.damage = 5; h.run(event("after-take-hit", "damage-high", "heal-by-ap")); assert.equal(h.actor.hp, 20);
    h.ctx.attack.damage = 8; h.run(event("after-take-hit", "damage-high", "heal-by-ap")); assert.equal(h.actor.hp, 20 + expected);
  }
  const h = context(), s = event("after-take-hit", "damage-high", "ap-cost-heal");
  h.run(s); assert.equal(h.actor.hp, 20);
  h.actor.ap = 1; h.run(s); assert.equal(h.actor.ap, 0); assert.equal(h.actor.hp, 35); assert.equal(h.log.at(-1).ap, 0);
  h.enemy.ap = 123; h.run(event("after-take-hit", "damage-high", "damage-by-enemy-ap")); assert.equal(h.enemy.hp, -103);
});

for (const [condition, hp, stacks, repeat, at, heal, ap] of [
  ["always", 1, 1, 1, 3, 5], ["hp-medium", .5, 2, 2, 5, 8, 1], ["hp-low", .25, 3, 3, 8, 10, 2],
]) test(`afterHeal ${condition}: 全候補の値・actual・HP境界`, () => {
  const rows = [["target-buff", "value", stacks, "focus"], ["target-debuff-remove", "repeat", repeat],
    ["target-next-at-up", "value", at], ["target-heal", "amount", heal]];
  if (ap) rows.push(["target-ap-up", "value", ap]);
  for (const [id, key, value, status] of rows) {
    const r = compile(event("after-heal", condition, id, status))[0]; assert.equal(r.effect[key], value); assert.equal(r.effect.target, "healTarget");
    if (id === "target-heal") assert.equal(r.effect.source, "afterHealBonus");
    const h = context(); h.ctx.heal = { target: h.enemy, actual: 1, hpPctAfter: hp };
    assert.equal(evaluateCondition(r.when, h.ctx), true);
    h.ctx.heal.actual = 0; assert.equal(evaluateCondition(r.when, h.ctx), false);
    h.ctx.heal.actual = 1; h.ctx.heal.hpPctAfter += .00001;
    if (condition !== "always") assert.equal(evaluateCondition(r.when, h.ctx), false);
  }
});

test("HP25%緊急回復は解除2+buff2、AP+1/+2は別候補で重複しない", () => {
  const r = compile(event("after-heal", "hp-low", "emergency", "focus"))[0];
  assert.equal(r.effect[0].repeat, 2); assert.equal(r.effect[1].value, 2);
  for (const [condition, expected] of [["hp-medium", 1], ["hp-low", 2]]) {
    const h = context(); h.ctx.heal = { target: h.enemy, actual: 1, hpPctAfter: .25 };
    const s = event("after-heal", condition, "target-ap-up"); assert.equal(compile(s).length, 1);
    h.run(s); assert.equal(h.enemy.ap, expected); assert.equal(h.actor.ap, 0);
  }
});

test("phaseEnd: buff総stack×3、HP条件なし最大HPコスト→AP、致死・負HPも実行", () => {
  const h = context(); h.actor.status.focus = 2; h.actor.status.clean = 1;
  h.run(event("phase-end", "always", "heal-by-buff")); assert.equal(h.actor.hp, 29);
  for (const [cost, ap] of [[5, 2], [8, 3], [10, 4]]) {
    const s = event("phase-end", "always", `ap-up-cost-${cost}`), r = compile(s)[0]; assert.equal(r.when, null);
    for (const hp of [1, 0, -10]) {
      const h = context(); h.actor.hp = hp; h.run(s);
      assert.equal(h.actor.hp, hp - cost); assert.equal(h.actor.ap, ap); assert.equal(h.log[0].type, "damage");
      assert.equal(h.log[0].ap, 0);
    }
  }
});

test("HP/AP trait全境界と倍率6候補の値、counter除外", () => {
  for (const [level, threshold, attackThreshold] of [["high", .6, .75], ["low", .4, .25]]) {
    for (const [suffix, expected] of [["at", { AT: 4, DF: 0 }], ["df", { AT: 0, DF: 4 }], ["at-df", { AT: 2, DF: 2 }]]) {
      const r = compile(trait(`hp-${level}-${suffix}`))[0], h = context(); h.actor.hp = threshold * 100;
      assert.deepEqual(evaluateBModifier(r.modifier, h.ctx), { active: true, ...expected });
      h.actor.hp += level === "high" ? -1 : 1;
      assert.deepEqual(evaluateBModifier(r.modifier, h.ctx), { active: false, AT: 0, DF: 0 });
    }
    const r = compile(trait(`hp-${level}-extra-attack`))[0], h = context(); h.actor.hp = attackThreshold * 100;
    assert.equal(evaluateCondition(r.when, h.ctx), true); assert.equal(r.effect.value, 1);
    h.actor.hp += level === "high" ? -1 : 1; assert.equal(evaluateCondition(r.when, h.ctx), false);
  }
  for (const stat of ["AT", "DF"]) {
    const m = compile(trait(`ap-${stat.toLowerCase()}`))[0].modifier;
    assert.deepEqual([m.scale, m.min, m.max], [1, 0, 5]);
    for (const ap of [0, 3, 8]) { const h = context(); h.actor.ap = ap; assert.equal(evaluateBModifier(m, h.ctx)[stat], Math.min(ap, 5)); }
  }
  for (const id of ["outgoing-random", "incoming-random", "damage-both-up", "damage-both-down"]) {
    for (const r of compile(trait(id))) {
      if (id.endsWith("random")) assert.deepEqual(r.effect.value.randUniform, [0, 2]);
      else assert.equal(r.effect.value, id.endsWith("up") ? 2 : .5);
      const h = context(); h.ctx.attack.isCounter = true; assert.equal(evaluateCondition(r.when, h.ctx), false);
    }
  }
});

function battle(selection, { hp = 1000, sp = 1, dice = 0, aSkill, helper = [], enemyStatus = [], cSkill } = {}) {
  return runBattle({ p1: { battlerId: "p1", duckId: "d1" }, p2: { battlerId: "p2", duckId: "d2" },
    data: { BATTLERS: [{ id: "p1", bSkills: [...compile(selection), ...helper], dSkill: { effect: [
      { type: "changeValue", key: "hp", op: "set", value: hp }, { type: "changeValue", key: "ap", op: "set", value: 30 }] } },
      { id: "p2", dSkill: { effect: enemyStatus } }], DUCKS: [
      { id: "d1", stats: { AT: 0, DF: 0, SP: sp, maxHP: 1000 }, dice: [dice], aSkill, cSkill },
      { id: "d2", stats: { AT: 0, DF: 0, SP: 1, maxHP: 1000 }, dice: [0] }] },
    field: "no-field", maxTurns: 1, rng: () => .9 });
}
test("production phaseEnd自傷後も残りphaseで行動・AP獲得→ターン末特殊C", () => {
  const r = battle(event("phase-end", "always", "ap-up-cost-5"), { hp: 1, sp: 3,
    cSkill: { mode: "special", costAP: 5, effect: { type: "revive", maxHpPct: .1 } } });
  const costs = r.events.filter(e => e.type === "fixedDamage" && e.target === "P1");
  assert.deepEqual(costs.map(e => e.hpAfter), [-49, -99, -149]);
  assert.equal(r.events.filter(e => e.type === "roll" && e.actor === "P1").length, 3);
  assert.equal(r.events.filter(e => e.type === "valueChanged" && e.key === "ap" && e.delta === 2).length, 3);
  assert.ok(r.events.findIndex(e => e.type === "revived") > r.events.indexOf(costs.at(-1)));
});
test("production afterHeal追加回復は再帰しない", () => {
  const r = battle(event("after-heal", "always", "target-heal"), { hp: 100, helper: [{ id: "heal", trigger: "phaseStart",
    effect: { type: "heal", amount: 1 } }] });
  assert.equal(r.events.filter(e => e.type === "heal" && e.source === "afterHealBonus").length, 1);
});
test("production命中Bは0damage/counterでも発火し、MISS・回避では発火しない", () => {
  const always = event("after-hit", "always", "enemy-next-at-down");
  const hit = battle(always);
  assert.ok(hit.events.some(e => e.type === "normalDamage" && e.actor === "P1" && e.value === 0));
  assert.ok(hit.events.some(e => e.key === "nextAttackATPlus" && e.delta === -2));
  const taken = battle(event("after-take-hit", "always", "self-buff", "focus"));
  assert.ok(taken.events.some(e => e.type === "normalDamage" && e.actor === "P2" && e.value === 0));
  assert.ok(taken.events.some(e => e.type === "statusChange" && e.target === "P1" && e.status === "focus"));
  const counter = battle(event("after-hit", "counter", "enemy-next-at-down"), { sp: 2, helper: [{ id: "counter", trigger: "phaseStart",
    effect: { type: "changeStatus", target: "self", status: "counter", op: "set", value: 3 } }] });
  assert.ok(counter.events.some(e => e.type === "counterDamage" && e.value === 0));
  assert.ok(counter.events.some(e => e.key === "nextAttackATPlus" && e.delta === -3));
  for (const settings of [{ helper: [{ id: "miss", trigger: "beforeAttack", effect: { type: "changeAttack", op: "miss" } }] },
    { enemyStatus: [{ type: "changeStatus", target: "self", status: "tailwind", op: "set", value: 3 }] }]) {
    const r = battle(always, settings);
    assert.equal(r.events.some(e => e.key === "nextAttackATPlus"), false);
  }
});
test("production HP追加攻撃はAの通常攻撃0回を復活させない", () => {
  const a = compileASkill({ diceFrame: "light", dice: [0, 0, 0, 0, 0, 0] },
    { triggerId: "all", effects: [{ effectId: "cancel-self-attack" }] });
  assert.equal(a.ok, true);
  for (const [id, hp] of [["hp-high-extra-attack", 1000], ["hp-low-extra-attack", 200]]) {
    const r = battle(trait(id), { hp, aSkill: { id: "A", ...a.skill } });
    assert.ok(r.events.some(e => e.key === "attackTimesAdd" && e.after === 1));
    assert.equal(r.events.some(e => e.type === "normalDamage" && e.actor === "P1"), false);
  }
});
