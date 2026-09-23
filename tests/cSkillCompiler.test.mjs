import test from "node:test";
import assert from "node:assert/strict";
import { compileCSkill as structuredcompileCSkill } from "../js/cSkillCompiler.js";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { createCSkillRules } from "../js/cSkillRules.js";
import { calculateCSkillResources } from "../js/cSkillResources.js";
import { createCDevCatalog } from "../js/cSkillDevFixtures.js";
import { C_TEST_FIELDS, runCSkillTestBattle } from "../js/cSkillTestHarness.js";


// 既存flatケースのfixtureを新DTOへ移行（productionに旧DTO互換入口はない）。
const flatFixture = value => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const { effects, ...rest } = value; return { ...rest, structure: { kind: "flat", effects } };
};
const compileCSkill = (value, options) => structuredcompileCSkill(flatFixture(value), options);

// 値・価格は開発fixture。productionの価格決定ではない。
function chosen(id, values = {}, catalog = createCDevCatalog()) {
  const d = catalog.effects.find(e => e.id === id);
  return { effectId: id, options: Object.fromEntries(Object.entries(d.optionAxes).map(([axis, set]) => {
    const option = Object.hasOwn(values, axis) ? catalog.optionSets[set].find(o => o.value === values[axis]) : catalog.optionSets[set][0];
    return [axis, option.id];
  })) };
}
const compile = (effects, mode = "normal", options = {}) => compileCSkill({ mode, effects }, { catalog: createCDevCatalog(), ...options });
const mapping = [
  ["damage-enemy", { amount: 30 }, { type: "fixedDamage", target: "enemy", amount: 30 }],
  ["damage-self", { amount: 50 }, { type: "fixedDamage", target: "self", amount: 50 }],
  ["heal-self", { amount: 30 }, { type: "heal", target: "self", amount: 30 }],
  ["heal-enemy", { amount: 30 }, { type: "heal", target: "enemy", amount: 30 }],
  ["current-hp-damage-enemy", { amountPct: .3 }, { type: "fixedDamage", target: "enemy", amountPct: .3 }],
];
for (const [group, status] of [["debuff", "crack"], ["buff", "focus"]]) for (const target of ["self", "enemy"]) {
  mapping.push([`grant-${group}-${target}`, { status, amount: 2 }, { type: "changeStatus", target, status, op: "add", value: 2 }]);
  mapping.push([`clear-${group}-single-${target}`, { status }, { type: "clearStatus", target, status }]);
  mapping.push([`clear-${group}-group-${target}`, {}, { type: "clearStatus", target, group }]);
}
for (const stat of ["AT", "DF"]) for (const target of ["self", "enemy"]) for (const direction of ["up", "down"]) {
  mapping.push([`turn-${stat.toLowerCase()}-${target}-${direction}`, { amount: 2, duration: 3 },
    { type: "addBuff", target, stat, amount: direction === "up" ? 2 : -2, duration: { kind: "turns", count: 3 } }]);
}
for (const [group, target, status] of [["debuff", "enemy", "crack"], ["buff", "self", "focus"]]) {
  mapping.push([`timed-hit-${group}-${target}`, { status, amount: 2, duration: 3 },
    { type: "addTimedHitRule", target: "self", duration: { kind: "turns", count: 3 },
      effect: { type: "changeStatus", target, status, op: "add", value: 2 } }]);
}
for (const [id, values, expected] of mapping) test(`compile ${id}`, () => {
  const r = compile([chosen(id, values)]); assert.equal(r.ok, true); assert.deepEqual(r.skill.effect, [expected]);
});
test("special percentage revive、normalでは拒否", () => {
  const selection = [chosen("revive-self", { maxHpPct: .3 })];
  assert.deepEqual(compile(selection, "special").skill.effect, [{ type: "revive", target: "self", maxHpPct: .3 }]);
  const denied = compile(selection); assert.equal(denied.ok, false); assert.equal(denied.skill, null);
  assert.ok(denied.errors.some(e => e.code === "MODE_UNAVAILABLE"));
});
test("配列順・重複保持、costAPはresources.requiredAPから取得", () => {
  const effects = [chosen("damage-enemy"), chosen("heal-enemy"), chosen("damage-enemy")];
  const r = compile(effects);
  assert.deepEqual(r.skill.effect.map(e => e.type), ["fixedDamage", "heal", "fixedDamage"]);
  assert.equal(r.skill.costAP, calculateCSkillResources(flatFixture({ mode: "normal", effects }), { catalog: createCDevCatalog() }).requiredAP);
  assert.equal(r.skill.costAP, createCSkillRules().baseAP + 1);
  assert.notEqual(r.skill.effect[0], r.skill.effect[2]);
});
test("nonzero fixture価格もcalculatorの結果を利用する", () => {
  const catalog = createCDevCatalog(); catalog.optionSets.damageAmount[0].apDelta = 3;
  const effects = [chosen("damage-enemy"), chosen("damage-self")];
  const r = compile(effects, "normal", { catalog });
  assert.equal(r.skill.costAP, createCSkillRules().minimumAP);
});
test("productionの未選択/価格nullではcompile不可、0へ補完しない", () => {
  for (const selection of [{ mode: "normal", effects: [{ effectId: "damage-enemy", options: {} }] },
    { mode: "normal", effects: [{ effectId: "clear-debuff-single-self", options: {} }] }]) {
    const r = compileCSkill(selection); assert.equal(r.ok, false); assert.equal(r.skill, null); assert.ok(r.unresolved.length);
  }
  assert.equal(compile([chosen("damage-enemy")]).ok, true);
});
test("raw effect/value/costAP/apDelta/target/type/duration/repeat確率をDTOから注入不可", () => {
  const item = chosen("damage-enemy");
  for (const [key, value] of Object.entries({ effect: { type: "revive" }, amount: 999, value: 999, costAP: 0,
    apDelta: -100, target: "self", type: "heal", duration: { kind: "turns", count: 99 }, repeatReviveChance: 1 })) {
    for (const selection of [{ mode: "normal", effects: [item], [key]: value },
      { mode: "normal", effects: [{ ...item, [key]: value }] },
      { mode: "normal", effects: [{ ...item, options: { ...item.options, [key]: value } }] }]) {
      const r = compileCSkill(selection, { catalog: createCDevCatalog() });
      assert.equal(r.ok, false); assert.equal(r.skill, null); assert.ok(r.errors.length);
    }
  }
  assert.equal(compile([{ ...item, options: { amount: 30 } }]).ok, false);
});
test("repeat chanceはtrusted rulesだけ、normalには含めない、nullは省略", () => {
  for (const chance of [0, .5, 1, null]) {
    const rules = { ...createCSkillRules(), repeatReviveChance: chance };
    const special = compile([chosen("revive-self")], "special", { rules });
    assert.equal(Object.hasOwn(special.skill, "repeatReviveChance"), chance != null);
    if (chance != null) assert.equal(special.skill.repeatReviveChance, chance);
    assert.equal(Object.hasOwn(compile([chosen("damage-enemy")], "normal", { rules }).skill, "repeatReviveChance"), false);
  }
});
test("semanticsを参照するのでeffectIDを改名しても同じ変換", () => {
  const catalog = createCDevCatalog(); const d = catalog.effects.find(e => e.id === "damage-enemy"); d.id = "renamed";
  assert.equal(compile([chosen("renamed", { amount: 30 }, catalog)], "normal", { catalog }).skill.effect[0].amount, 30);
});
test("壊れたtrusted数値/semantics/確率はprogrammer error", () => {
  const catalog = createCDevCatalog(); catalog.optionSets.damageAmount[0].value = "raw";
  assert.throws(() => compile([chosen("damage-enemy")], "normal", { catalog }), /Invalid C/);
  const bad = createCDevCatalog(); bad.effects[0].semantics.type = "unknown";
  assert.throws(() => compile([chosen("damage-enemy")], "normal", { catalog: bad }), /Unsupported/);
  assert.throws(() => compile([chosen("revive-self")], "special", { rules: { ...createCSkillRules(), repeatReviveChance: 2 } }), /repeatReviveChance/);
});
test("凍結入力で純粋、出力の変更がcatalogや次回出力へ漏れない", () => {
  const freeze = v => { for (const x of Object.values(v)) if (x && typeof x === "object") freeze(x); return Object.freeze(v); };
  const catalog = freeze(createCDevCatalog()), rules = freeze(createCSkillRules());
  const selection = freeze({ mode: "normal", effects: [chosen("timed-hit-debuff-enemy")] });
  const before = JSON.stringify({ selection, catalog, rules });
  const r = compileCSkill(selection, { catalog, rules }); r.skill.effect[0].effect.value = 999;
  assert.equal(compileCSkill(selection, { catalog, rules }).skill.effect[0].effect.value, 1);
  assert.equal(JSON.stringify({ selection, catalog, rules }), before);
  assert.ok(createCSkillCatalog().optionSets.damageAmount.length === 6);
  assert.deepEqual(createCSkillRules().repeatReviveChance, { 2: .5, 3: .25, default: .1 });
});
function run(effects, mode = "normal", settings = {}, chance = .5, rng = () => .9) {
  return runCSkillTestBattle(flatFixture({ mode, effects }), { catalog: createCDevCatalog(), rules: { ...createCSkillRules(), repeatReviveChance: chance },
    settings: { ...Object.fromEntries(C_TEST_FIELDS.map(f => [f.key, f.value])), ...settings }, rng });
}
test("開発harnessで通常C compile→damage/heal/割合/turn補正/statusが実行できる", () => {
  for (const id of ["damage-enemy", "heal-self", "current-hp-damage-enemy", "turn-at-self-up", "grant-debuff-enemy"]) {
    const r = run([chosen(id)], "normal", { p1HP: 500 });
    assert.ok(r.battle.events.some(e => e.type === "cSkillActivated"));
    assert.ok(r.finalState.hp); assert.ok(r.finalState.ap); assert.ok(r.finalState.status);
  }
});
test("compile済みtimedを同phaseの通常命中後に実行", () => {
  const r = run([chosen("timed-hit-debuff-enemy", { duration: 3 })], "normal", { maxTurns: 1 });
  const applied = r.battle.events.findIndex(e => e.type === "timedRuleApplied");
  const damage = r.battle.events.findIndex((e, i) => i > applied && e.type === "normalDamage" && e.actor === "P1");
  const triggered = r.battle.events.findIndex(e => e.type === "timedRuleTriggered");
  assert.ok(applied < damage && damage < triggered);
  assert.equal(r.battle.events.filter(e => e.type === "timedRuleTriggered").length, 2);
});
test("special複数reviveと0/50/100%再抽選をcompiler→実戦闘で確認", () => {
  for (const chance of [0, .5, 1]) {
    const r = run([chosen("revive-self", { maxHpPct: .3 }), chosen("revive-self", { maxHpPct: .5 })], "special",
      { p1HP: -100, p1AP: 100, p1Dice: 0, p2Dice: 0, forceDeath: true, maxTurns: 2 }, chance);
    const c = r.battle.events.filter(e => e.type === "cSkillActivated");
    assert.deepEqual(c.map(e => e.activationCount), [1, 2]);
    assert.equal(r.battle.events.filter(e => e.turn === 1 && e.type === "revived").at(-1).hpAfter, 500);
    const rolls = r.battle.events.filter(e => e.type === "reviveRoll");
    assert.equal(rolls.length, 2); assert.ok(rolls.every(e => e.probability === chance && e.success === (chance === 1)));
  }
});
test("special固定ダメージのみ/固定healのみも接続、compile失敗時は戦闘なし", () => {
  for (const id of ["damage-enemy", "heal-self"]) {
    const r = run([chosen(id, { amount: 50 })], "special", { p1HP: -30, p1Dice: 0, p2Dice: 0, maxTurns: 1 });
    assert.ok(r.battle.events.some(e => e.type === "cSkillActivated"));
    assert.equal(r.finalState.hp.P1, id === "heal-self" ? 20 : -30);
  }
  assert.equal(runCSkillTestBattle(flatFixture({ mode: "normal", effects: [{ effectId: "damage-enemy" }] }), { settings: {} }).battle, null);
});
