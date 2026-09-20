import test from "node:test";
import assert from "node:assert/strict";
import { calculateBuildResources } from "../js/buildResources.js";
import { validateBuild } from "../js/buildValidator.js";
import { createBuildRules } from "../js/buildRules.js";

const build = (dice = [0, 0, 0, 0, 0, 0], diceFrame = "heavy", stats = { AT: 1, DF: 1 }) => ({
  schemaVersion: 1, diceFrame, stats, dice, skills: [],
});
for (const frame of ["light", "basic", "heavy"]) {
  test(`${frame}: AT/DF最低1を許可、0と6は拒否`, () => {
    assert.equal(validateBuild(build(undefined, frame)).valid, true);
    for (const stat of ["AT", "DF"]) {
      for (const value of [0, 6]) {
        assert.equal(validateBuild(build(undefined, frame, { AT: 1, DF: 1, [stat]: value })).valid, false);
      }
    }
  });
}
test("ステータス使用済み・未使用ポイントの例と負の残高", () => {
  assert.deepEqual(calculateBuildResources(build(undefined, "light", { AT: 3, DF: 2 })).stats,
    { sp: 3, used: 8, remaining: 1 });
  assert.deepEqual(calculateBuildResources(build()).stats, { sp: 1, used: 3, remaining: 6 });
  for (const [df, remaining, valid] of [[3, 0, true], [4, -1, false]]) {
    const result = validateBuild(build(undefined, "light", { AT: 3, DF: df }));
    assert.equal(result.resources.stats.remaining, remaining);
    assert.equal(result.valid, valid);
  }
});
for (const [dice, earned, spent, remaining] of [
  [[3, 3, 4, 4, 5, 6], 0, 0, 0],
  [[0, 3, 3, 4, 5, 6], 1, 0, 1],
  [[0, 0, 0, 0, 0, 0], 6, 0, 6],
  [[0, 3, 3, 3, 4, 5], 1, 1, 0],
  [[0, 0, 0, 3, 3, 3], 3, 1, 2],
]) {
  test(`${dice}: 獲得${earned}・使用${spent}・残り${remaining}`, () => {
    const input = build(dice);
    const resources = calculateBuildResources(input);
    assert.deepEqual(resources.dice, { emptyCount: earned, tripleCount: spent, earned, spent, remaining });
    const result = validateBuild(input);
    assert.equal(result.valid, true);
    assert.deepEqual(result.resources, resources);
  });
}
test("3個積みのポイント不足を拒否、負の残高を隠さない", () => {
  const result = validateBuild(build([3, 3, 3, 4, 5, 6]));
  assert.equal(result.resources.dice.remaining, -1);
  assert.ok(result.errors.some(error => error.code === "INSUFFICIENT_DICE_POINTS"));
});
test("枠数拡張時にも種類ごとに課金し不足を拒否", () => {
  const rules = createBuildRules(); rules.dice.slots = 8;
  const result = validateBuild(build([0, 0, 3, 3, 3, 4, 4, 4]), { rules });
  assert.equal(result.valid, true);
  assert.equal(result.resources.dice.spent, 2);
  assert.equal(result.resources.dice.remaining, 0);
  rules.dice.slots = 7;
  const insufficient = validateBuild(build([0, 3, 3, 3, 4, 4, 4]), { rules });
  assert.ok(insufficient.errors.some(error => error.code === "INSUFFICIENT_DICE_POINTS"));
});
test("計算とvalidatorは凍結入力・設定でも動き、0やデータを変更しない", () => {
  const input = build([0, 0, 0, 3, 3, 3]);
  const before = structuredClone(input);
  const rules = createBuildRules();
  const rulesBefore = structuredClone(rules);
  const freeze = value => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  };
  freeze(input); freeze(rules);
  calculateBuildResources(input, rules);
  assert.equal(validateBuild(input, { rules }).valid, true);
  assert.deepEqual(input, before);
  assert.deepEqual(rules, rulesBefore);
});
test("不正入力は計算不能欄をnullにし、補正しない", () => {
  assert.deepEqual(calculateBuildResources(null), { stats: null, dice: null });
  assert.equal(calculateBuildResources(build(new Array(6))).dice, null);
  assert.equal(calculateBuildResources(build(["0", 0, 0, 0, 0, 0])).dice, null);
  assert.equal(calculateBuildResources(build(undefined, "unknown")).stats, null);
  assert.equal(calculateBuildResources(build(undefined, "heavy", { AT: NaN, DF: 1 })).stats, null);
});
test("ポイント単価は信頼済み設定から取得し、不正設定は例外", () => {
  const rules = createBuildRules();
  rules.resources.dicePointsPerEmpty = 2;
  rules.resources.dicePointsPerTriple = 3;
  assert.equal(calculateBuildResources(build([0, 0, 0, 3, 3, 3]), rules).dice.remaining, 3);
  rules.resources.dicePointsPerTriple = -1;
  assert.throws(() => calculateBuildResources(build(), rules), TypeError);
  assert.equal(createBuildRules().resources.aUpgradeDicePointCost, 2);
  rules.resources.cModules.testOnly = { statPointCost: 3 };
  assert.deepEqual(createBuildRules().resources.cModules, {});
});
