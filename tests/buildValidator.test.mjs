import test from "node:test";
import assert from "node:assert/strict";
import { createBuildRules } from "../js/buildRules.js";
import { createSkillCatalog } from "../js/skillCatalog.js";
import { validateBuild } from "../js/buildValidator.js";
import { applyEffect } from "../js/effects.js";

// すべて検査用の仮値。製品の作成仕様ではない。
function fixture() {
  const rules = createBuildRules();
  for (const stat of ["AT", "DF"]) rules.stats[stat] = { min: 0, max: 3 };
  rules.stats.totalMax = 8;
  for (const category of ["A", "B", "C", "D"]) {
    rules.skills[category] = { maxCount: 1, budget: 2, costOf: skill => skill.effectIds.length * 2, validate: () => [] };
  }
  const catalog = createSkillCatalog();
  catalog.effects.smallHeal = { label: "検査用回復", categories: ["C"] };
  catalog.triggers.auto = { label: "検査用発動", categories: ["C"] };
  const build = { schemaVersion: 1, diceFrame: "light", stats: { AT: 2, DF: 3 }, dice: [1, 1, 2, 2, 3, 3],
    skills: [{ category: "C", triggerId: "auto", effectIds: ["smallHeal"] }] };
  return { build, rules, catalog };
}
function check(change, code) {
  const f = fixture();
  change(f);
  const result = validateBuild(f.build, f);
  assert.equal(result.ready, false);
  assert.ok(result.errors.some(error => error.code === code), JSON.stringify(result));
}

test("確定済みルールの境界値を許可し入力を変更しない", () => {
  const f = fixture();
  const before = structuredClone(f.build);
  assert.equal(validateBuild(f.build, f).ready, true);
  assert.deepEqual(f.build, before);
});
test("未確定ルールは違反なしでも登録可能にしない", () => {
  const { build } = fixture(); build.skills = [];
  const result = validateBuild(build);
  assert.equal(result.valid, true); assert.equal(result.complete, false); assert.equal(result.ready, false);
  assert.ok(result.pending.some(item => item.path === "skills.C.budget"));
});
test("上下限・合計・枠数・素体別出目・重複数", () => {
  check(f => { f.build.stats.AT = 4; }, "LIMIT_EXCEEDED");
  check(f => { f.build.stats.AT = -1; }, "LIMIT_EXCEEDED");
  check(f => { f.build.stats.AT = 3; }, "LIMIT_EXCEEDED");
  check(f => f.build.dice.pop(), "DICE_SLOTS");
  check(f => { f.build.dice[0] = 5; }, "FACE_NOT_ALLOWED");
  check(f => { f.build.dice[2] = 1; }, "LIMIT_EXCEEDED");
});
test("未知素体とユーザー指定SPを拒否", () => {
  for (const id of [undefined, null, 1, {}, "unknown", "constructor", "__proto__"]) {
    check(f => { f.build.diceFrame = id; }, "INVALID_DICE_FRAME");
  }
  check(f => { f.build.stats.SP = 1; }, "UNKNOWN_FIELD");
});
test("未公開ID・カテゴリ違い・継承されたIDを拒否", () => {
  for (const id of ["revive", "constructor", "__proto__"]) {
    check(f => { f.build.skills[0].effectIds = [id]; }, "CHOICE_NOT_ALLOWED");
  }
  check(f => { f.build.skills[0].category = "A"; }, "CHOICE_NOT_ALLOWED");
  check(f => { f.build.skills[0].triggerId = "beforeTurnEnd"; }, "CHOICE_NOT_ALLOWED");
});
test("生effect・コスト申告・不正型・疎配列を拒否", () => {
  check(f => { f.build.skills[0].effect = { type: "revive" }; }, "UNKNOWN_FIELD");
  check(f => { f.build.skills[0].costAP = 0; }, "UNKNOWN_FIELD");
  check(f => { f.build.skills[0].effectIds = [{ type: "heal" }]; }, "CHOICE_NOT_ALLOWED");
  check(f => { f.build.stats.AT = "2"; }, "INVALID_STAT");
  check(f => { delete f.build.dice[0]; }, "INVALID_FACE");
  check(f => { f.build.skills = [null]; }, "INVALID_SKILL");
  check(f => { f.build.skills[0].effectIds = new Array(1); }, "CHOICE_NOT_ALLOWED");
  assert.equal(validateBuild(null).valid, false);
});
test("スキル数・合計予算・追加条件を検査", () => {
  check(f => f.build.skills.push(structuredClone(f.build.skills[0])), "LIMIT_EXCEEDED");
  check(f => f.build.skills[0].effectIds.push("smallHeal"), "LIMIT_EXCEEDED");
  check(f => { f.rules.skills.C.validate = () => ["組合せ不可"]; }, "SKILL_RESTRICTION");
  const f = fixture(); f.rules.skills.C.costOf = () => NaN;
  assert.throws(() => validateBuild(f.build, f), TypeError);
});
test("設定オブジェクトを共有しない", () => {
  const rules = createBuildRules(); rules.skills.A.budget = 100;
  assert.equal(createBuildRules().skills.A.budget, null);
  const catalog = createSkillCatalog(); catalog.effects.revive = {};
  assert.deepEqual(createSkillCatalog().effects, {});
});
test("カタログに未登録のreviveも既存エンジンで実行できる", () => {
  assert.equal(createSkillCatalog().effects.revive, undefined);
  const actor = { hp: -1, maxHP: 20, side: "P1" };
  applyEffect({ type: "revive", hp: 10 }, { actor, push() {} });
  assert.equal(actor.hp, 10);
});
