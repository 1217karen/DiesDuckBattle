import test from "node:test";
import assert from "node:assert/strict";
import { validateBuild } from "../js/buildValidator.js";
import { createBuildRules } from "../js/buildRules.js";
import { getDiceFrame } from "../js/diceFrames.js";

const build = (diceFrame, dice, stats = { AT: 3, DF: 3 }) => ({
  schemaVersion: 1, diceFrame, stats, dice, skills: [],
});
// 未確定のスキル制限はpendingのまま。確定済みルールのvalidを検査。
for (const [frame, dice] of [
  ["light", [1, 2, 3, 4, 1, 2]],
  ["basic", [2, 3, 4, 5, 2, 3]],
  ["heavy", [3, 4, 5, 6, 3, 4]],
]) {
  test(`${frame}の全使用可能出目を許可`, () => {
    assert.equal(validateBuild(build(frame, dice)).valid, true);
  });
  test(`${frame}は空き枠6個を許可`, () => {
    assert.equal(validateBuild(build(frame, [0, 0, 0, 0, 0, 0])).valid, true);
  });
}
for (const [name, frame, dice, code] of [
  ["ライトの5", "light", [1, 2, 3, 4, 5, 0], "FACE_NOT_ALLOWED"],
  ["ベーシックの1", "basic", [1, 2, 3, 4, 5, 0], "FACE_NOT_ALLOWED"],
  ["ヘビーの2", "heavy", [2, 3, 4, 5, 6, 0], "FACE_NOT_ALLOWED"],
  ["0なしの同一3個", "light", [1, 1, 1, 2, 3, 4], "LIMIT_EXCEEDED"],
  ["0ありの同一4個", "heavy", [3, 3, 3, 3, 0, 0], "LIMIT_EXCEEDED"],
  ["5枠", "light", [0, 0, 0, 0, 0], "DICE_SLOTS"],
  ["7枠", "light", [0, 0, 0, 0, 0, 0, 0], "DICE_SLOTS"],
]) {
  test(`${name}を拒否`, () => {
    const result = validateBuild(build(frame, dice));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.code === code));
  });
}
test("0ありの同一3個を許可", () => {
  assert.equal(validateBuild(build("light", [1, 1, 1, 2, 3, 0])).valid, true);
});
test("整数以外・疎配列・範囲外を拒否", () => {
  for (const face of [1.5, "0", null, undefined, NaN, Infinity, -1, 7]) {
    assert.equal(validateBuild(build("light", [face, 0, 0, 0, 0, 0])).valid, false);
  }
  assert.equal(validateBuild(build("light", new Array(6))).valid, false);
});
test("全素体で導出SPを含む合計9を許可、10を拒否", () => {
  for (const [frame, sp] of [["light", 3], ["basic", 2], ["heavy", 1]]) {
    assert.equal(getDiceFrame(frame).SP, sp);
    assert.equal(validateBuild(build(frame, [0, 0, 0, 0, 0, 0], { AT: 4, DF: 5 - sp })).valid, true);
    const result = validateBuild(build(frame, [0, 0, 0, 0, 0, 0], { AT: 4, DF: 6 - sp }));
    assert.ok(result.errors.some(error => error.path === "stats.totalMax"));
  }
});
test("AT/DFは1～5、上限は設定だけで変更可能", () => {
  const rules = createBuildRules();
  assert.deepEqual(rules.stats.AT, { min: 1, max: 5 });
  assert.deepEqual(rules.stats.DF, { min: 1, max: 5 });
  assert.equal(validateBuild(build("heavy", [0, 0, 0, 0, 0, 0], { AT: -1, DF: 3 })).valid, false);
  for (const stat of ["AT", "DF"]) {
    const input = build("heavy", [0, 0, 0, 0, 0, 0], { AT: 3, DF: 3, [stat]: 5 });
    rules.stats[stat].max = 4;
    assert.equal(validateBuild(input, { rules }).valid, false);
    rules.stats[stat].max = 5;
    assert.equal(validateBuild(input, { rules }).valid, true);
  }
});
