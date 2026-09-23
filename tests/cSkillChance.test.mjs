import test from "node:test";
import assert from "node:assert/strict";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { createCSkillRules, C_HP_FAILURE_MULTIPLIER } from "../js/cSkillRules.js";
import { createCDevCatalog, createCDevRules } from "../js/cSkillDevFixtures.js";
import { compileCSkill } from "../js/cSkillCompiler.js";
import { applyEffect } from "../js/effects.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";
import { C_TEST_FIELDS, runCSkillTestBattle } from "../js/cSkillTestHarness.js";

const flat = effects => ({ mode: "normal", structure: { kind: "flat", effects } });
const compile = (s, catalog = createCDevCatalog(), rules = createCDevRules()) => compileCSkill(s, { catalog, rules });
function choose(catalog, id, chance = "50", values = {}) {
  const definition = catalog.effects.find(e => e.id === id);
  const options = Object.fromEntries(Object.entries(definition.optionAxes).map(([axis, set]) => {
    // 小量・端数境界も確認するtrustedテストfixture。ユーザーDTOには数値を入れない。
    let option = Object.hasOwn(values, axis) ? catalog.optionSets[set].find(o => o.value === values[axis]) : catalog.optionSets[set][0];
    if (!option) { option = { id: `test-${axis}`, value: values[axis], apDelta: 0 }; catalog.optionSets[set].push(option); }
    return [axis, option.id];
  }));
  return { effectId: id, options, ...(chance === undefined ? {} : { chanceOptionId: chance }) };
}
function context({ roll = .99, hp = 100, turn = 10 } = {}) {
  const fighter = (side, hp) => ({ side, hp, maxHP: 1000, ap: 0, buffs: [], status: Object.fromEntries(STATUS_GROUPS.all.map(k => [k, 2])) });
  const actor = fighter("P1", hp), enemy = fighter("P2", 1000), logs = [];
  let calls = 0;
  const ctx = { actor, enemy, turn, phase: 1, rng: () => { calls++; return roll; },
    push: (type, side, extra) => logs.push({ type, side, ...extra }), helpers: {} };
  ctx.helpers.dealDamage = (target, amount) => { target.hp -= amount; logs.push({ type: "damage", amount }); };
  ctx.helpers.heal = (target, amount) => { target.hp = Math.min(1000, target.hp + amount); logs.push({ type: "healing", amount }); };
  return { actor, enemy, ctx, logs, calls: () => calls };
}
function compileOne(id, values = {}, chance = "50") {
  const catalog = createCDevCatalog(), row = choose(catalog, id, chance, values);
  const s = flat([row]); if (id === "revive-self") s.mode = "special";
  const result = compile(s, catalog); assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

test("production/devのchance候補は100/70/50/25共通、量候補はchanceと独立", () => {
  assert.equal(C_HP_FAILURE_MULTIPLIER, .2);
  const prod = createCSkillCatalog(), dev = createCDevCatalog();
  assert.deepEqual(prod.chanceOptions.map(o => [o.id, o.value, o.apDiscount]), [["100", 1, 0], ["70", .7, null], ["50", .5, null], ["25", .25, null]]);
  assert.deepEqual(dev.chanceOptions.map(o => [o.id, o.value]), prod.chanceOptions.map(o => [o.id, o.value]));
  assert.ok(dev.chanceOptions.every(o => o.apDiscount === 0 && !Object.hasOwn(o, "apDelta")));
  const before = structuredClone(dev.optionSets);
  for (const effect of dev.effects.filter(e => e.polarity === "benefit")) for (const chance of dev.chanceOptions) {
    const row = choose(dev, effect.id, chance.id), s = flat([row]); s.mode = "special";
    const result = compile(s, dev); assert.equal(result.ok, true, effect.id);
    const main = result.skill.effect[0];
    assert.equal(main.chance, chance.value === 1 ? undefined : chance.value);
    assert.equal(Object.hasOwn(main, "onFail"), chance.value !== 1 && ["fixedDamage", "heal"].includes(main.type));
    assert.equal(result.resources.effectCount, 1); assert.equal(result.resources.benefitCount, 1); assert.equal(result.resources.slotCost, 0);
  }
  assert.deepEqual(dev.optionSets, before);
});
test("100%・省略ではchance/onFailなし、chance乱数消費なし", () => {
  const catalog = createCDevCatalog();
  for (const explicit of [false, true]) {
    const row = choose(catalog, "damage-enemy", "100"); if (!explicit) delete row.chanceOptionId;
    const result = compile(flat([row]), catalog), effect = result.skill.effect[0];
    assert.equal(Object.hasOwn(effect, "chance"), false); assert.equal(Object.hasOwn(effect, "onFail"), false);
    const h = context(); h.ctx.rng = () => { throw new Error("100%判定は乱数を消費しない"); };
    applyEffect(effect, h.ctx); assert.equal(h.enemy.hp, 990);
  }
});
test("drawbackは100%固定、低確率は全drawbackで拒否", () => {
  const catalog = createCDevCatalog();
  for (const effect of catalog.effects.filter(e => e.polarity === "drawback")) {
    const row = choose(catalog, effect.id, "100");
    assert.equal(compile(flat([row]), catalog).ok, true); delete row.chanceOptionId;
    assert.equal(compile(flat([row]), catalog).ok, true);
    for (const chance of ["70", "50", "25"]) {
      row.chanceOptionId = chance;
      assert.ok(compile(flat([row]), catalog).errors.some(e => e.code === "DRAWBACK_CHANCE"));
    }
  }
});
for (const [id, type, target] of [["damage-enemy", "fixedDamage", "enemy"], ["heal-self", "heal", "self"]]) {
  test(`${id}: 20%をfloor、最低1なし、成功時は元の量`, () => {
    for (const [amount, failureAmount] of [[50, 10], [70, 14], [7, 1], [4, 0], [1, 0]]) {
      const result = compileOne(id, { amount }); const effect = result.skill.effect[0];
      assert.deepEqual(effect.onFail, { type, target, amount: failureAmount });
      for (const [roll, applied] of [[.1, amount], [.99, failureAmount]]) {
        const h = context({ roll }); applyEffect(effect, h.ctx);
        assert.equal(target === "enemy" ? 1000 - h.enemy.hp : h.actor.hp - 100, applied);
        assert.equal(h.calls(), 1);
        if (applied === 0) assert.deepEqual(h.logs.map(e => e.type), ["chanceRoll"]);
      }
    }
  });
}
test("現在HP割合はpct自体×0.2（HPから二重計算しない）", () => {
  const effect = compileOne("current-hp-damage-enemy", { amountPct: .5 }).skill.effect[0];
  assert.deepEqual(effect.onFail, { type: "fixedDamage", target: "enemy", amountPct: .1 });
  const h = context(); h.enemy.hp = 19; applyEffect(effect, h.ctx); assert.equal(h.enemy.hp, 18);
});
test("debuff倍率はfloor(N×0.2)、1～4では0、buffは数えない", () => {
  for (const [multiplier, n] of [[1, 0], [2, 0], [3, 0], [4, 0], [5, 1], [9, 1]]) {
    const effect = compileOne("debuff-total-damage-enemy", { multiplier }).skill.effect[0];
    assert.equal(effect.onFail.byStatusCount.n, n);
    assert.deepEqual(effect.onFail.byStatusCount.statuses, [...STATUS_GROUPS.debuff]);
    const h = context(); h.enemy.status.focus = 99; applyEffect(effect, h.ctx);
    assert.equal(h.enemy.hp, 1000 - STATUS_GROUPS.debuff.length * 2 * n);
  }
});
test("turnStepはbase/add別々にfloor×0.2、everyは維持", () => {
  for (const [baseAmount, stepAmount, base, add] of [[40, 10, 8, 2], [9, 7, 1, 1], [4, 3, 0, 0]]) {
    const effect = compileOne("turn-step-damage-enemy", { baseAmount, everyTurns: 10, stepAmount }).skill.effect[0];
    assert.deepEqual(effect.onFail, { type: "fixedDamage", target: "enemy", amount: base, turnStep: { every: 10, add } });
    for (const turn of [9, 10, 20]) {
      const h = context({ turn }); applyEffect(effect, h.ctx);
      assert.equal(h.enemy.hp, 1000 - base - Math.floor(turn / 10) * add);
    }
  }
});
for (const [id, values] of [
  ["grant-debuff-enemy", {}], ["grant-buff-self", {}],
  ["grant-debuff-enemy", { status: "@debuff" }], ["grant-buff-self", { status: "@buff" }],
  ["clear-debuff-single-self", {}], ["clear-buff-single-enemy", {}],
  ["clear-debuff-group-self", {}], ["clear-buff-group-enemy", {}],
  ["turn-at-self-up", {}], ["turn-df-self-up", {}], ["turn-at-enemy-down", {}], ["turn-df-enemy-down", {}],
  ["timed-hit-debuff-enemy", {}], ["timed-hit-buff-self", {}], ["revive-self", {}],
]) test(`${id} ${JSON.stringify(values)}: 失敗は何も起こさずonFailなし`, () => {
  const effect = compileOne(id, values).skill.effect[0];
  assert.equal(Object.hasOwn(effect, "onFail"), false);
  const h = context({ hp: -100 }); const before = structuredClone({ actor: h.actor, enemy: h.enemy });
  applyEffect(effect, h.ctx);
  assert.deepEqual({ actor: h.actor, enemy: h.enemy }, before); assert.equal(h.calls(), 1);
  assert.deepEqual(h.logs.map(e => e.type), ["chanceRoll"]);
});
test("自動failureはflat/random/HP共通、全枝合計5選択のcountを増やさない", () => {
  const c = createCDevCatalog(), row = choose(c, "damage-enemy", "50", { amount: 50 });
  const cases = [flat([row]), { mode: "normal", structure: { kind: "random", branches: [{ effects: [row] }, { effects: [row] }] } },
    { mode: "normal", structure: { kind: "hpCondition", thresholdOptionId: "dev-hpThreshold-0.5", branches: { met: { effects: [row] }, unmet: { effects: [row] } } } }];
  for (const s of cases) {
    const result = compile(s, c); assert.equal(result.ok, true); const h = context(); applyEffect(result.skill.effect, h.ctx);
    assert.equal(h.enemy.hp, 990);
    const battle = runCSkillTestBattle(s, { catalog: c, rules: createCDevRules(), rng: () => .99,
      settings: { ...Object.fromEntries(C_TEST_FIELDS.map(f => [f.key, f.value])), p1Dice: 0, p2Dice: 0, maxTurns: 1 } });
    assert.equal(battle.battle.events.find(e => e.type === "fixedDamage").value, 10);
  }
  const r = compile(flat(Array.from({ length: 5 }, () => row)), c);
  assert.equal(r.ok, true); assert.equal(r.resources.effectCount, 5); assert.equal(r.resources.benefitCount, 5); assert.equal(r.resources.slotCost, 4);
});
test("chance割引はleaf価格だけ、基礎/枠/分岐/他effectを割り引かない", () => {
  const c = createCDevCatalog(); c.optionSets.damageAmount[0].apDelta = 4; c.optionSets.healAmount[0].apDelta = 7;
  c.chanceOptions.find(o => o.id === "70").apDiscount = 2;
  c.chanceOptions.find(o => o.id === "50").apDiscount = 100;
  const damage = choose(c, "damage-enemy", "100"), heal = choose(c, "heal-self", "100");
  const base = compile(flat([damage, heal]), c); assert.equal(base.skill.costAP, 17);
  damage.chanceOptionId = "70"; const discounted = compile(flat([damage, heal]), c);
  assert.equal(discounted.skill.costAP, 15); assert.equal(discounted.resources.effectBreakdown[0].appliedDiscount, 2);
  damage.chanceOptionId = "50"; const clamped = compile(flat([damage, heal]), c);
  assert.equal(clamped.skill.costAP, 13); assert.equal(clamped.resources.effectBreakdown[0].effectDelta, 0);
  assert.equal(clamped.resources.effectBreakdown[1].effectDelta, 7);
  const rules = createCDevRules(); rules.branchAPDelta.random = 3;
  const branched = compile({ mode: "normal", structure: { kind: "random", branches: [{ effects: [damage] }, { effects: [heal] }] } }, c, rules);
  assert.equal(branched.skill.costAP, 16);
  c.chanceOptions.find(o => o.id === "50").apDiscount = -1;
  assert.throws(() => compile(flat([damage]), c), /chance discount/);
});
test("production discount nullはcompile不能。100%と確定optionのみなら利用可能", () => {
  const c = createCDevCatalog(); c.chanceOptions = createCSkillCatalog().chanceOptions;
  const row = choose(c, "damage-enemy", "100");
  assert.equal(compile(flat([row]), c, createCSkillRules()).ok, true);
  for (const chance of ["70", "50", "25"]) {
    row.chanceOptionId = chance; const r = compile(flat([row]), c, createCSkillRules());
    assert.equal(r.ok, false); assert.equal(r.resources.requiredAP, null);
    assert.equal(r.resources.effectBreakdown[0].apDiscount, null);
    assert.ok(r.unresolved.some(e => e.code === "CHANCE_DISCOUNT_UNRESOLVED"));
  }
  const realProd = compileCSkill(flat([{ effectId: "clear-debuff-single-self", options: { status: "crack" }, chanceOptionId: "50" }]));
  assert.equal(realProd.resources.complete, false); assert.equal(realProd.resources.requiredAP, null);
});
test("ユーザーchance関連はIDのみ、全onFail形式/失敗割合/割引/旧chance候補を拒否", () => {
  const c = createCDevCatalog(), row = choose(c, "damage-enemy");
  for (const field of ["chance", "onFail", "failureRate", "failureEffect", "failureMultiplier", "apDiscount", "chanceDiscount", "repeat"]) {
    const r = compile(flat([{ ...row, [field]: .2 }]), c); assert.equal(r.ok, false); assert.ok(r.errors.some(e => e.code === "UNKNOWN_FIELD"));
  }
  for (const onFail of [{ ...row }, { type: "fixedDamage", amount: 30 }, [row], null]) {
    assert.equal(compile(flat([{ ...row, onFail }]), c).ok, false);
  }
  for (const chanceOptionId of [.7, "80", "75", "dev-chance-80", "dev-chance-75"]) assert.equal(compile(flat([{ ...row, chanceOptionId }]), c).ok, false);
});
