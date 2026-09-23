import test from "node:test";
import assert from "node:assert/strict";
import { createCSkillRules } from "../js/cSkillRules.js";
import { createCSkillCatalog, getCEffectOptions } from "../js/cSkillCatalog.js";
import { calculateCSkillResources as structuredcalculateCSkillResources } from "../js/cSkillResources.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";


// 既存flatケースのfixtureを新DTOへ移行（productionに旧DTO互換入口はない）。
const flatFixture = value => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const { effects, ...rest } = value; return { ...rest, structure: { kind: "flat", effects } };
};
const calculateCSkillResources = (value, options) => structuredcalculateCSkillResources(flatFixture(value), options);

// このテストだけの仮数量・価格。productionのゲームバランスではない。
function fixture() {
  const catalog = createCSkillCatalog();
  for (const [id, options] of Object.entries(catalog.optionSets)) {
    if (/^(grant|clear|timed)-/.test(id)) options.forEach(o => { o.apDelta = 1; });
    else catalog.optionSets[id] = [
      { id: "zero", label: "テスト無料", value: 1, apDelta: 0 },
      { id: "one", label: "テスト1", value: 2, apDelta: 1 },
      { id: "two", label: "テスト2", value: 3, apDelta: 2 },
    ];
  }
  return catalog;
}
const chosen = (effectId = "damage-enemy", options = { amount: "zero" }) => ({ effectId, options });
const calc = (effects, mode = "normal", catalog = fixture()) => calculateCSkillResources({ mode, effects }, { catalog });
const rules = createCSkillRules();

test("確定Cルールと1～5メリット枠（累積三角数ではない）", () => {
  assert.deepEqual([rules.baseAP, rules.minimumAP, rules.minEffects, rules.maxEffects, rules.additionalBenefitSlotAP], [5, 5, 1, 5, 1]);
  for (let count = rules.minEffects; count <= rules.maxEffects; count++) {
    const r = calc(Array.from({ length: count }, () => chosen()));
    assert.equal(r.complete, true);
    assert.equal(r.slotCost, count - 1); assert.equal(r.requiredAP, rules.baseAP + count - 1);
    assert.equal(r.benefitCount, count); assert.equal(r.effectCount, count);
  }
});
test("デメリットも総枠へ数え、枠APは増やさない", () => {
  const r = calc([chosen(), chosen(), chosen("damage-self"), chosen("damage-self")]);
  assert.equal(r.effectCount, 4); assert.equal(r.benefitCount, 2); assert.equal(r.drawbackCount, 2);
  assert.equal(r.slotCost, 1); assert.equal(r.requiredAP, rules.baseAP + 1);
  assert.equal(calc(Array.from({ length: rules.maxEffects + 1 }, () => chosen("damage-self"))).complete, false);
});
test("0枠・6枠を拒否、重複5枠は許可", () => {
  for (const count of [0, rules.maxEffects + 1]) assert.ok(calc(Array.from({ length: count }, () => chosen())).errors.some(e => e.code === "EFFECT_COUNT"));
  assert.equal(calc(Array.from({ length: rules.maxEffects }, () => chosen())).complete, true);
});
test("amountとdurationの複数軸を加算しmirrorは全軸の符号反転", () => {
  for (const [amount, duration, delta] of [["zero", "zero", 0], ["one", "zero", 1], ["zero", "one", 1], ["one", "one", 2]]) {
    for (const [id, sign] of [["turn-at-self-up", 1], ["turn-at-self-down", -1]]) {
      const r = calc([chosen(id, { amount, duration })]);
      assert.equal(r.optionDelta, sign * delta || 0);
      assert.equal(r.rawAP, rules.baseAP + sign * delta);
      assert.equal(r.requiredAP, Math.max(rules.minimumAP, r.rawAP));
    }
  }
});
test("drawbackのみでも最低AP、effect種類固定costなし", () => {
  const r = calc([chosen("damage-self", { amount: "two" }), chosen("heal-enemy", { amount: "two" })]);
  assert.equal(r.knownOptionDelta, -4); assert.equal(r.requiredAP, rules.minimumAP); assert.equal(r.slotCost, 0);
  assert.equal(calc([chosen("heal-self")]).requiredAP, rules.baseAP);
});
test("normal reviveは拒否、specialは復活なし/重複復活とも許可", () => {
  const revive = chosen("revive-self", { maxHpPct: "one" });
  assert.ok(calc([revive]).errors.some(e => e.code === "MODE_UNAVAILABLE"));
  assert.equal(calc([chosen()], "special").complete, true);
  assert.equal(calc([revive, revive, revive], "special").complete, true);
  assert.equal(calc([revive, revive, revive], "special").optionDelta, 3);
});
test("全mirrorがoption setを共有し、一方の価格調整が両者へ反映される", () => {
  const catalog = fixture();
  for (const effect of catalog.effects.filter(e => e.mirrorId)) {
    const mirror = catalog.effects.find(e => e.id === effect.mirrorId);
    assert.deepEqual(effect.optionAxes, mirror.optionAxes); assert.equal(mirror.mirrorId, effect.id);
    const options = Object.fromEntries(Object.entries(effect.optionAxes).map(([axis, setId]) => [axis, catalog.optionSets[setId][0].id]));
    const a = calc([chosen(effect.id, options)], "special", catalog), b = calc([chosen(mirror.id, options)], "special", catalog);
    assert.equal(a.optionDelta, -b.optionDelta || 0);
  }
  catalog.optionSets.damageAmount[0].apDelta = 4;
  assert.equal(calc([chosen()], "normal", catalog).optionDelta, 4);
  assert.equal(calc([chosen("damage-self")], "normal", catalog).optionDelta, -4);
});
test("未確定priceと未選択はnull、判明分小計を保持、明示0は無料", () => {
  const catalog = fixture(); catalog.optionSets.turnCount[0].apDelta = null;
  const r = calc([chosen("turn-at-self-up", { amount: "two", duration: "zero" })], "normal", catalog);
  assert.equal(r.complete, false); assert.equal(r.knownOptionDelta, 2);
  assert.equal(r.optionDelta, null); assert.equal(r.rawAP, null); assert.equal(r.requiredAP, null);
  assert.equal(r.unresolved[0].code, "PRICE_UNRESOLVED");
  assert.equal(calc([chosen()]).complete, true);
  const unset = calculateCSkillResources({ mode: "normal", effects: [{ effectId: "damage-enemy" }] });
  assert.equal(unset.unresolved[0].code, "OPTION_UNSELECTED");
});
test("生value/cost/apDelta/effect/options数値などの注入を拒否", () => {
  const good = { mode: "normal", effects: [chosen()] };
  for (const selection of [
    { ...good, costAP: 0 }, { ...good, apDelta: -100 }, { ...good, value: 999 },
    { ...good, effects: [{ ...chosen(), amount: 999 }] }, { ...good, effects: [{ ...chosen(), effect: { type: "revive" } }] },
    { ...good, effects: [chosen("damage-enemy", { amount: 999 })] },
    { ...good, effects: [chosen("damage-enemy", { amount: "zero", apDelta: -100 })] },
    { ...good, effects: [chosen("damage-enemy", { amount: { value: 999, apDelta: -100 } })] },
    { ...good, effects: new Array(1) }, null, { mode: "invalid", effects: [chosen()] },
    Object.create(good), { mode: "normal", effects: [chosen("damage-enemy", Object.create({ amount: "zero" }))] },
  ]) {
    const r = calculateCSkillResources(selection, { catalog: fixture() });
    assert.ok(r.errors.length > 0); assert.equal(r.complete, false); assert.equal(r.requiredAP, null);
  }
});
test("公開候補: AP/割合heal/出目操作/addDice/passiveなし、片方向効果はmirrorなし", () => {
  const catalog = createCSkillCatalog();
  assert.equal(catalog.effects.some(e => ["changeValue", "addDice", "passive"].includes(e.semantics.type)), false);
  assert.ok(catalog.effects.filter(e => e.semantics.type === "heal").every(e => Object.keys(e.optionAxes).join() === "amount"));
  for (const category of ["percentageDamage", "timedHit", "revive"]) assert.ok(catalog.effects.filter(e => e.category === category).every(e => e.polarity === "benefit" && !e.mirrorId));
  for (const group of ["debuff", "buff"]) assert.deepEqual(catalog.optionSets[`grant-${group}`].map(o => o.id), [...STATUS_GROUPS[group], `random-${group}`]);
  assert.equal(getCEffectOptions("normal").find(e => e.id === "revive-self").selectable, false);
});
test("clearはstatus/scope、timedはstatus/amount/durationの独立軸", () => {
  assert.equal(calc([chosen("clear-debuff-single-self", { status: "crack" })]).optionDelta, 1);
  assert.equal(calc([chosen("clear-debuff-group-self", { scope: "all" })]).optionDelta, 1);
  assert.equal(calc([chosen("timed-hit-debuff-enemy", { status: "crack", amount: "one", duration: "two" })]).optionDelta, 4);
});
test("凍結DTO/catalog/rulesを変更せず純粋計算、設定値だけでルール変更", () => {
  const freeze = object => { for (const v of Object.values(object)) if (v && typeof v === "object") freeze(v); return Object.freeze(object); };
  const catalog = freeze(fixture()), settings = freeze({ ...rules, baseAP: 8, minimumAP: 7, additionalBenefitSlotAP: 2 });
  const selection = freeze({ mode: "normal", effects: [chosen(), chosen()] });
  const before = JSON.stringify({ selection, settings, catalog });
  assert.equal(calculateCSkillResources(selection, { rules: settings, catalog }).requiredAP, 10);
  assert.equal(JSON.stringify({ selection, settings, catalog }), before);
});
