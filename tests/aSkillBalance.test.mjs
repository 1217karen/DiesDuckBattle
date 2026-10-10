import test from "node:test";
import assert from "node:assert/strict";
import { createASkillCatalog, getATriggerOptions } from "../js/aSkillCatalog.js";
import { calculateASkillResources } from "../js/aSkillResources.js";
import { compileASkill } from "../js/aSkillCompiler.js";
import { runASkillTestBattle } from "../js/aSkillTestHarness.js";

const catalog = createASkillCatalog();
const build = (diceFrame = "preset-void") => ({ diceFrame, dice: [0, 0, 0, 0, 0, 0] });
const chosen = (effectId, amount, chanceOptionId = "100") => ({ effectId, chanceOptionId,
  ...(amount === undefined ? {} : { amountOptionId: `amount-${amount}` }) });
const selection = (effects, triggerId = "exact:0") => ({ triggerId, effects });
const calc = effects => calculateASkillResources(build(), selection(effects));

test("A第1段階: 全効果の数量・価格・還元は指定表だけ（指定/random statusも共通）", () => {
  for (const effect of catalog.effects) {
    let amounts, fixed;
    if (effect.id.startsWith("damage-")) amounts = [[3, 2], [5, 3]];
    else if (effect.id.startsWith("heal-")) amounts = [[5, 2], [10, 4]];
    else if (effect.id.startsWith("ap-")) amounts = [[1, 3], [2, 5]];
    else if (effect.id.startsWith("grant-")) amounts = [[1, 1], [2, 2], [3, 3]];
    else if (effect.id.startsWith("remove-")) amounts = [[1, 1], [2, 2], [3, 3]];
    else if (effect.id.startsWith("next-at-") || effect.id.startsWith("phase-")) amounts = [[2, 1], [3, 2], [5, 3]];
    else if (effect.id === "increase-attacks") amounts = [[1, 4]];
    else if (effect.id === "additional-recoil") amounts = [[2, 1], [4, 2]];
    else if (effect.id === "cancel-self-attack") fixed = null;
    else if (effect.id === "reduce-dice6-recoil") amounts = [[3, 2]];
    else if (["cancel-dice1-ap", "reduce-dice2-attacks", "cancel-dice3-heal", "cancel-dice4-counter", "cancel-dice5-ap"].includes(effect.id)) fixed = 2;
    else assert.fail(`未検証effect: ${effect.id}`);
    const drawback = effect.polarity === "drawback";
    assert.equal(effect.requiresAmount, !!amounts, effect.id);
    assert.deepEqual(effect.amountOptions.map(o => [o.value, o.pointCost, o.drawbackPoints]),
      (amounts ?? []).map(([value, pt]) => [value, drawback ? 0 : pt, drawback ? pt : 0]), effect.id);
    assert.equal(effect.pointCost, drawback ? 0 : (fixed ?? 0), effect.id);
    assert.equal(effect.drawbackPoints, effect.id === "cancel-self-attack" ? null : drawback ? (fixed ?? 0) : 0, effect.id);
    assert.deepEqual(effect.amountOptions.map(o => o.id), (amounts ?? []).map(([value]) => `amount-${value}`));
  }
});

test("productionだけで全効果・全数量がcomplete/compile成功し既存battleへ接続", () => {
  for (const effect of catalog.effects) {
    const b = { ...build(effect.exactFace > 4 ? "custom-heavy" : "custom-speed"), dice: effect.exactFace ? [effect.exactFace,0,0,0,3,4] : [1,2,3,4,0,0] };
    const trigger = effect.exactFace ? `exact:${effect.exactFace}` : "exact:0";
    for (const option of effect.requiresAmount ? effect.amountOptions : [null]) {
      const s = selection([chosen(effect.id, option?.value), ...(effect.id === "cancel-self-attack" ? [chosen("heal-enemy", 5)] : [])], trigger);
      const budgetRefund = option?.pointCost === 5 ? 2 : 0;
      if (budgetRefund) s.effects.push(chosen("heal-enemy",5));
      const r = compileASkill(b, s);
      assert.equal(r.resources.complete, true, effect.id);
      assert.equal(r.ok, true, effect.id);
      assert.deepEqual(r.unresolved, []);
      const price = option ?? effect;
      assert.equal(r.resources.effectCost, price.pointCost);
      assert.equal(r.resources.drawbackPoints, effect.id === "cancel-self-attack" ? 3 : price.drawbackPoints + budgetRefund);
      const actual = r.skill.effect[0];
      assert.equal(actual.type, effect.semantics.type);
      assert.equal(actual.target, effect.semantics.target);
      assert.equal(actual.amount ?? actual.value ?? actual.repeat, option ? option.value * (effect.semantics.sign ?? 1) : effect.semantics.value);
      // 専用triggerも実際にrollする初期diceにする。予算と頻度は維持。
      const run = runASkillTestBattle({ ...b, dice: effect.exactFace ? [effect.exactFace,0,0,0,3,4] : [0,0,1,2,3,4] }, s, { rng: () => 0 });
      assert.equal(run.compilation.ok, true, effect.id);
      assert.ok(run.battle.events.some(e => e.type === "skillTriggered" && e.skill?.category === "A"), effect.id);
      assert.equal(run.battle.events.some(e => String(e.code).includes("UNSUPPORTED")), false, effect.id);
    }
  }
});

test("Aは確定のみ、メリット追加枠コストを維持", () => {
  assert.deepEqual(catalog.chanceOptions.map(o => o.id), ["100"]);
  for (const chance of ["50", "25", "10"]) assert.equal(calc([chosen("damage-enemy", 3, chance)]).complete, false);
  for (let n = 1; n <= 4; n++) {
    const r = calc(Array.from({length:n}, () => chosen("next-at-self-increase", 2)));
    assert.equal(r.effectCost, n); assert.equal(r.benefitSlotCost, n-1); assert.equal(r.netCost, 2*n+1);
  }
});

test("drawbackは100%固定、還元合計にcapなし", () => {
  for (const effect of catalog.effects.filter(e => e.polarity === "drawback")) {
    const b = { ...build(effect.exactFace > 4 ? "custom-heavy" : "custom-speed"), dice: effect.exactFace ? [effect.exactFace,0,0,0,3,4] : [1,2,3,4,0,0] };
    const row = chosen(effect.id, effect.amountOptions[0]?.value);
    const s = selection([row, ...(effect.id === "cancel-self-attack" ? [chosen("heal-enemy", 5)] : [])], effect.exactFace ? `exact:${effect.exactFace}` : "exact:0");
    assert.equal(compileASkill(b, s).skill.effect[0].chance, undefined);
    delete row.chanceOptionId;
    assert.equal(compileASkill(b, s).ok, true);
    for (const chance of ["50", "25", "10"]) {
      row.chanceOptionId = chance;
      const result = compileASkill(b, s);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some(e => e.code === "UNKNOWN_CHANCE_OPTION"));
    }
  }
  assert.equal(catalog.maxDrawbackPoints, null);
  const s = selection(Array.from({ length: 4 }, () => chosen("heal-enemy", 10)));
  const r = calculateASkillResources(build(), s);
  assert.equal(r.drawbackPoints, 16); assert.equal(r.netCost, -14); assert.equal(r.remaining, 20);
  // 既存の未使用fieldを設定しても新しいcap制御は存在しない。
  const custom = createASkillCatalog(); custom.maxDrawbackPoints = 1;
  assert.deepEqual(calculateASkillResources(build(), s, { catalog: custom }), r);
});

test("raw amount/cost等と未登録数量を拒否、ID参照だけを維持", () => {
  for (const key of ["amount", "value", "cost", "pointCost", "drawbackPoints", "chance", "effect", "target", "unknown"]) {
    const row = { ...chosen("damage-enemy", 3), [key]: 999 };
    const r = compileASkill(build(), selection([row]));
    assert.equal(r.ok, false); assert.ok(r.errors.some(e => e.code === "UNKNOWN_FIELD"));
  }
  for (const [effectId, amountOptionId] of [["damage-enemy", 3], ["damage-enemy", "dev-3"], ["damage-enemy", "amount-999"],
    ["increase-attacks", "amount-2"], ["additional-recoil", "amount-3"], ["reduce-dice6-recoil", "amount-2"]]) {
    assert.equal(compileASkill(build("custom-heavy"), selection([{ effectId, amountOptionId }], "exact:6")).ok, false);
  }
});

test("基礎pt・effect上限・trigger cost・専用条件/重複制限は維持", () => {
  assert.equal(catalog.basePoints, 2); assert.equal(catalog.maxEffects, 4);
  assert.deepEqual(catalog.triggerCosts, { byFrequency: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 2, 6: 2 } });
  for (const effect of catalog.effects.filter(e => e.exactFace || e.id === "cancel-self-attack")) {
    assert.equal(effect.allowDuplicate, false);
    const b = { ...build(effect.exactFace > 4 ? "custom-heavy" : "custom-speed"), dice: [effect.exactFace ?? 0, 0, 0, 0, 0, 0] };
    const row = chosen(effect.id, effect.amountOptions[0]?.value);
    const trigger = effect.exactFace ? `exact:${effect.exactFace}` : "exact:0";
    assert.ok(compileASkill(b, selection([row, row], trigger)).errors.some(e => e.code === "DUPLICATE_EFFECT"));
    if (effect.exactFace) assert.ok(compileASkill(b, selection([row], "all")).errors.some(e => e.code === "EXACT_FACE_REQUIRED"));
  }
});

test("Aの候補・頻度・pt・合法性は初期diceだけで決まりDを読まない", () => {
  const b = { diceFrame: "custom-speed", dice: [0, 0, 1, 2, 3, 4] };
  const s = selection([chosen("damage-enemy", 3)], "gte:3");
  const expected = compileASkill(b, s);
  assert.equal(expected.resources.frequencyCount, 2);
  const withD = { ...b };
  for (const key of ["dSkill", "dSkillSelection", "dicePool", "battler"])
    Object.defineProperty(withD, key, { get() { throw new Error(`Aは${key}を参照しない`); } });
  assert.deepEqual(compileASkill(withD, s), expected);
  assert.deepEqual(calculateASkillResources(withD, s), expected.resources);
  assert.equal(getATriggerOptions(withD).some(t => t.id === "exact:5"), false);
  assert.equal(compileASkill(withD, selection(s.effects, "exact:5")).ok, false);
});
