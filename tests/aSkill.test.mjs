import test from "node:test";
import assert from "node:assert/strict";
import { createASkillCatalog, getATriggerOptions, getAEffectOptions, getAEffectAvailability } from "../js/aSkillCatalog.js";
import { calculateASkillResources } from "../js/aSkillResources.js";
import { calculateBuildResources } from "../js/buildResources.js";
import { createBuildRules } from "../js/buildRules.js";

const build = (diceFrame = "light", dice = [0, 0, 0, 1, 1, 1]) => ({
  schemaVersion: 1, diceFrame, stats: { AT: 1, DF: 1 }, dice, skills: [],
});
// 以下の数量・価格は動作検査用fixtureのみ。ゲームのバランス仕様ではない。
function fixture() {
  const catalog = createASkillCatalog();
  for (const effect of catalog.effects) {
    effect.amountOptions = [{ id: "test-amount", label: "検査専用", value: 7, pointCost: 3 }];
    effect.pointCost = 0;
  }
  return catalog;
}
const chosen = effectId => ({ effectId, amountOptionId: "test-amount" });

for (const [frame, faces, lte, gte] of [
  ["light", [1, 2, 3, 4], [1, 2, 3], [2, 3, 4]],
  ["basic", [2, 3, 4, 5], [2, 3, 4], [3, 4, 5]],
  ["heavy", [3, 4, 5, 6], [3, 4, 5], [4, 5, 6]],
]) {
  test(`${frame}: 固定/以下/以上/全出目の候補と価格`, () => {
    const options = getATriggerOptions(frame);
    assert.deepEqual(options.filter(x => x.kind === "exact").map(x => x.value), [0, ...faces]);
    assert.deepEqual(options.filter(x => x.kind === "lte").map(x => x.value), lte);
    assert.deepEqual(options.filter(x => x.kind === "gte").map(x => x.value), gte);
    for (const option of options) {
      if (option.kind === "exact") assert.equal(option.pointCost, 0);
      else if (option.kind === "all") { assert.equal(option.pointCost, 2); assert.ok(option.baseFaces.includes(0)); }
      else {
        assert.ok(!option.baseFaces.includes(0));
        assert.equal(option.pointCost, option.baseFaces.length - 1);
      }
    }
    assert.deepEqual(options.filter(x => x.kind === "lte").map(x => x.pointCost), [0, 1, 2]);
    assert.deepEqual(options.filter(x => x.kind === "gte").map(x => x.pointCost), [2, 1, 0]);
  });
}
test("発動価格は装着ダイスやD追加想定の5/6に依存しない", () => {
  const selection = { triggerId: "gte:3", effects: [] };
  for (const dice of [[0, 0, 0, 0, 0, 0], [1, 2, 3, 4, 5, 6]]) {
    assert.equal(calculateASkillResources(build("light", dice), selection).triggerCost, 1);
  }
  assert.deepEqual(getATriggerOptions("light").find(x => x.id === "gte:3").baseFaces, [3, 4]);
});
test("全専用効果を常に表示、exact一致のみ選択可能", () => {
  const catalog = createASkillCatalog();
  const special = catalog.effects.filter(x => x.exactFace != null);
  assert.equal(special.length, 7);
  for (let face = 1; face <= 6; face++) {
    const frame = face <= 4 ? "light" : "heavy";
    for (const effect of special) {
      const availability = getAEffectAvailability(effect.id, frame, `exact:${face}`, catalog);
      assert.equal(availability.selectable, effect.exactFace === face);
      if (!availability.selectable) assert.equal(availability.reason.code, "EXACT_FACE_REQUIRED");
    }
  }
  for (const trigger of ["exact:0", "lte:3", "gte:3", "all"]) {
    const options = getAEffectOptions("light", trigger, catalog).flatMap(x => x.effects);
    assert.equal(options.length, catalog.effects.length);
    for (const effect of options.filter(x => x.exactFace != null)) {
      assert.equal(effect.selectable, false); assert.ok(effect.reason.message);
    }
  }
  assert.equal(getAEffectAvailability(special[0].id, "heavy", "exact:1").reason.code, "INVALID_TRIGGER");
});
test("対象/方向でデメリットを定義し、状態分類とAT補正の公開範囲を保持", () => {
  const catalog = createASkillCatalog();
  const find = id => catalog.effects.find(x => x.id === id);
  for (const [id, refund] of [
    ["damage-enemy", 0], ["damage-self", 1], ["heal-self", 0], ["heal-enemy", 1],
    ["ap-self-increase", 0], ["ap-enemy-decrease", 0], ["ap-enemy-increase", 1], ["ap-self-decrease", 1],
    ["cancel-self-attack", 1], ["reduce-dice6-recoil", 0], ["increase-dice6-recoil", 1],
  ]) assert.equal(find(id).drawbackPoints, refund);
  for (const status of catalog.statuses) {
    assert.equal(find(`grant-${status.id}-self`).drawbackPoints, status.categoryId === "ailment" ? 1 : 0);
    assert.equal(find(`grant-${status.id}-enemy`).drawbackPoints, status.categoryId === "ailment" ? 0 : 1);
  }
  assert.deepEqual(catalog.statuses.filter(x => x.categoryId === "ailment").map(x => x.id), ["crack", "Headwind", "roughWave", "steam"]);
  assert.deepEqual(catalog.statuses.filter(x => x.categoryId === "enhancement").map(x => x.id), ["tailwind", "focus", "counter", "clean"]);
  assert.deepEqual(catalog.effects.filter(x => x.categoryId === "nextAttack").map(x => x.id), ["next-at-self-increase", "next-at-enemy-decrease"]);
  assert.equal(catalog.effects.length, 34);
  assert.ok(catalog.effects.every(x => x.amountOptions.length === 0 && x.pointCost === null));
  const groups = getAEffectOptions("light", "exact:0");
  assert.deepEqual(groups.find(x => x.id === "ailment").targets.map(x => x.id), ["self", "enemy"]);
  assert.equal(groups.find(x => x.id === "enhancement").statuses.length, 4);
});
test("内訳・負の残高・還元設定変更", () => {
  const catalog = fixture();
  const selection = { triggerId: "gte:3", effects: [chosen("damage-enemy"), { effectId: "cancel-self-attack" }] };
  const result = calculateASkillResources(build(), selection, { catalog });
  for (const [key, value] of Object.entries({ availableDicePoints: 2, triggerCost: 1, effectCost: 3,
    drawbackPoints: 1, grossCost: 4, netCost: 3, remaining: -1, complete: true })) assert.equal(result[key], value);
  catalog.effects.find(x => x.id === "cancel-self-attack").drawbackPoints = 2;
  assert.equal(calculateASkillResources(build(), selection, { catalog }).remaining, 0);
  assert.equal(result.availableDicePoints, calculateBuildResources(build()).dice.remaining);
});
test("同一効果も異なる状態も個別計上、デメリットの重複も加算", () => {
  const catalog = fixture();
  const effects = [chosen("grant-Headwind-enemy"), chosen("grant-Headwind-enemy"), chosen("grant-roughWave-enemy"), chosen("grant-steam-enemy")];
  const result = calculateASkillResources(build(), { triggerId: "exact:0", effects }, { catalog });
  assert.equal(result.complete, true); assert.equal(result.effectCost, 12); assert.equal(result.drawbackPoints, 0);
  const refunds = calculateASkillResources(build(), { triggerId: "all", effects: [chosen("damage-self"), chosen("damage-self")] }, { catalog });
  assert.equal(refunds.drawbackPoints, 2); assert.equal(refunds.effectCost, 6);
});
test("未確定数量/価格を0として確定しない、既知の内訳は残す", () => {
  const catalog = fixture();
  catalog.effects.find(x => x.id === "heal-self").amountOptions[0].pointCost = null;
  const result = calculateASkillResources(build(), { triggerId: "all", effects: [chosen("damage-self"), chosen("heal-self")] }, { catalog });
  assert.equal(result.complete, false); assert.equal(result.triggerCost, 2); assert.equal(result.drawbackPoints, 1);
  assert.equal(result.knownEffectCost, 3); assert.equal(result.effectCost, null); assert.equal(result.remaining, null);
  assert.ok(result.unresolved.some(x => x.code === "PRICE_UNRESOLVED"));
  const production = calculateASkillResources(build(), { triggerId: "all", effects: [{ effectId: "damage-self" }, { effectId: "cancel-self-attack" }] });
  assert.equal(production.complete, false); assert.equal(production.drawbackPoints, 2);
  assert.ok(production.unresolved.some(x => x.code === "AMOUNT_UNSELECTED"));
  assert.ok(production.unresolved.some(x => x.code === "PRICE_UNRESOLVED"));
});
test("未知ID・数値/価格申告・生effect・専用条件不一致を拒否", () => {
  const catalog = fixture();
  for (const effect of [
    { type: "revive" }, { effectId: "revive" }, { effectId: "constructor" },
    { ...chosen("damage-self"), pointCost: 0 }, { ...chosen("damage-self"), value: 999 },
    { effectId: "damage-self", amountOptionId: 7 }, { effectId: "damage-self", amountOptionId: "unknown" },
    { effectId: "cancel-dice1-ap" }, null,
  ]) {
    const result = calculateASkillResources(build(), { triggerId: "all", effects: [effect] }, { catalog });
    assert.equal(result.complete, false); assert.ok(result.errors.length); assert.equal(result.remaining, null);
  }
  assert.ok(calculateASkillResources(build(), { triggerId: "exact:6", effects: [] }).errors.length);
  assert.equal(calculateASkillResources(build(), null).complete, false);
});
test("入力・設定が凍結されていても不変、UI helperも変更しない", () => {
  const input = build(); const catalog = fixture(); const rules = createBuildRules();
  const selection = { triggerId: "all", effects: [chosen("damage-self")] };
  const before = structuredClone({ input, catalog, rules, selection });
  const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
  [input, catalog, rules, selection].forEach(freeze);
  assert.equal(calculateASkillResources(input, selection, { catalog, rules }).complete, true);
  getAEffectOptions(input.diceFrame, selection.triggerId, catalog);
  assert.deepEqual({ input, catalog, rules, selection }, before);
});
test("明示的な無料価格・負のnetCost、設定不正", () => {
  const catalog = fixture();
  const selection = { triggerId: "exact:0", effects: [{ effectId: "cancel-self-attack" }] };
  assert.equal(calculateASkillResources(build(), selection, { catalog }).netCost, -1);
  catalog.effects.find(x => x.id === "cancel-self-attack").pointCost = NaN;
  assert.throws(() => calculateASkillResources(build(), selection, { catalog }), TypeError);
});
