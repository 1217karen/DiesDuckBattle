import test from "node:test";
import assert from "node:assert/strict";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { presentCSkill } from "../js/cSkillPresentation.js";
import { calculateCSkillResources } from "../js/cSkillResources.js";
import { compileCSkill } from "../js/cSkillCompiler.js";
import { migrateSelection } from "../js/selectionNormalization.js";
import { changeCControl, cControlDefinitions, cControlView } from "../js/cSkillControlEditor.js";
import { C_HP_FAILURE_MULTIPLIER } from "../js/cSkillRules.js";
import { runBattle } from "../js/battleEngine.js";
import { normalizedCCatalog } from "../js/effectSelectionCatalog.js";

const catalog = createCSkillCatalog();
const flat = (effects, mode = "normal") => ({ mode, structure: { kind: "flat", effects } });
function leaf(id, values = {}, chance) {
  const d = catalog.effects.find(e => e.id === id);
  return { effectId: id, options: Object.fromEntries(Object.entries(d.optionAxes).map(([axis, set]) =>
    [axis, (Object.hasOwn(values, axis) ? catalog.optionSets[set].find(o => o.value === values[axis]) : catalog.optionSets[set][0]).id])),
    ...(chance ? { chanceOptionId: chance } : {}) };
}
const cases = [
  ["damage-enemy", {}, "相手に固定50ダメージを与える"],
  ["damage-self", {}, "自分に固定50ダメージを与える（デメリット）"],
  ["heal-self", {}, "自分のHPを30回復する"],
  ["heal-enemy", {}, "相手のHPを30回復する（デメリット）"],
  ["current-hp-damage-enemy", {}, "相手に相手の現在HPの25％の固定ダメージを与える"],
  ["debuff-total-damage-enemy", {}, "相手に付与されている状態異常の合計付与数×10の固定ダメージを与える"],
  ["turn-step-damage-enemy", { everyTurns: 10, stepAmount: 5 }, "相手に固定30ダメージを与える（10ターンごとに与えるダメージが5増加する）"],
  ["grant-debuff-enemy", { status: "crack" }, "相手に亀裂を3付与する"],
  ["grant-debuff-enemy", { status: "@debuff" }, "相手にランダムな状態異常を3付与する"],
  ["grant-buff-self", { status: "@buff" }, "自分にランダムな状態強化を3付与する"],
  ["remove-random-debuff-self", {}, "自分のランダムな状態異常を3解除する"],
  ["remove-random-buff-enemy", {}, "相手のランダムな状態強化を3解除する"],
  ["remove-random-buff-self", {}, "自分のランダムな状態強化を3解除する（デメリット）"],
  ["timed-hit-debuff-enemy", { status: "crack" }, "3ターンの間、通常攻撃時に相手に亀裂を1付与するオーラを纏う"],
  ["timed-hit-buff-self", { status: "focus" }, "3ターンの間、通常攻撃時に自分に集中を1付与するオーラを纏う"],
  ["turn-at-self-up", {}, "2ターンの間、自分のATを2増加する"],
  ["turn-at-enemy-down", {}, "2ターンの間、相手のATを2減少する"],
  ["turn-df-self-up", {}, "2ターンの間、自分のDFを2増加する"],
  ["turn-df-enemy-down", {}, "2ターンの間、相手のDFを2減少する"],
  ["revive-self", { maxHpPct: .1 }, "自分の最大HPの10％で復活する（2回目以降は確率発動）"],
];
for (const [id, values, text] of cases) test(`formal C: ${id}/${JSON.stringify(values)}`, () => {
  const s = flat([leaf(id, values)], id === "revive-self" ? "special" : "normal");
  for (const selection of [s, migrateSelection("C", s, catalog)]) {
    const before = structuredClone(selection), compiled = compileCSkill(selection), resources = calculateCSkillResources(selection);
    const p = presentCSkill(selection);
    assert.equal(p.complete, true, JSON.stringify(p));
    assert.equal(p.text, `〈AP${resources.requiredAP}〉${id === "revive-self" ? "敗北時に発動する。" : ""}${text}`);
    assert.deepEqual(selection, before); assert.deepEqual(compileCSkill(selection), compiled);
    assert.deepEqual(calculateCSkillResources(selection), resources);
    assert.deepEqual(presentCSkill(JSON.parse(JSON.stringify(selection))), p);
  }
});
for (const chance of ["100", "70", "50", "25"]) test(`damage chance ${chance} and guarantee`, () => {
  for (const amount of [50, 60, 70, 80, 90, 100]) {
    const s = flat([leaf("damage-enemy", { amount }, chance)]), p = presentCSkill(s);
    const failure = Math.floor(amount * C_HP_FAILURE_MULTIPLIER);
    const text = chance === "100" ? `相手に固定${amount}ダメージを与える`
      : `相手に成功率${chance}％の固定${amount}ダメージを与える（失敗した場合は固定${failure}ダメージを与える）`;
    assert.equal(p.branches[0][0], text);
    assert.equal(compileCSkill(s).skill.effect[0].onFail?.amount, chance === "100" ? undefined : failure);
  }
});
test("failure text floors fractional guarantee using the same trusted constant as compiler", () => {
  const custom = createCSkillCatalog();
  custom.optionSets.damageAmount = [{ id: "test-seven", value: 7, label: "7", apDelta: 0 }];
  custom.selectionEffects = normalizedCCatalog(custom);
  const s=flat([{effectId:"damage-enemy",options:{amount:"test-seven"},chanceOptionId:"50"}]);
  assert.match(presentCSkill(s,{catalog:custom}).text,/失敗した場合は固定1ダメージ/);
  assert.equal(compileCSkill(s,{catalog:custom}).skill.effect[0].onFail.amount,1);
});
test("every public variant has pure presentation and unchanged compile/resources after reload", () => {
  const before = structuredClone(catalog);
  for (const definition of catalog.effects) {
    const s = flat([leaf(definition.id)], "special");
    const normalized = migrateSelection("C",s,catalog), compiled=compileCSkill(normalized), resources=calculateCSkillResources(normalized);
    const result=presentCSkill(normalized);
    assert.equal(result.complete,true,definition.id);
    assert.equal(result.text.includes("（デメリット）"),definition.polarity==="drawback");
    assert.deepEqual(compileCSkill(JSON.parse(JSON.stringify(normalized))),compiled);
    assert.deepEqual(calculateCSkillResources(normalized),resources);
  }
  assert.deepEqual(catalog,before);
});
test("branches and AP use existing calculator, including multiple effects in saved order", () => {
  const a = leaf("damage-enemy"), b = leaf("heal-self");
  const texts = ["相手に固定50ダメージを与える", "自分のHPを30回復する"];
  const choices = [
    [flat([a, b]), texts.join("＋")],
    [flat([b, a], "special"), "敗北時に発動する。" + texts.toReversed().join("＋")],
    [{ mode: "normal", structure: { kind: "hpCondition", thresholdOptionId: "hpThreshold-0.5", branches: { met: { effects: [a, b] }, unmet: { effects: [b] } } } }, `①自分のHPが50％以上の時、${texts.join("＋")}②自分のHPが50％未満の時、${texts[1]}`],
    ...[2, 3].map(n => [{ mode: "normal", structure: { kind: "random", branches: Array.from({ length: n }, () => ({ effects: [a] })) } },
      (n === 2 ? "どちらかの効果が発動する。" : "いずれかの効果が発動する。") + ["①", "②", "③"].slice(0, n).map(mark => mark + texts[0]).join("")]),
  ];
  for (const [s, body] of choices) assert.equal(presentCSkill(s).text, `〈AP${calculateCSkillResources(s).requiredAP}〉${body}`);
});
test("old, unknown, incomplete and invalid values never become complete or get repaired", () => {
  const removed = catalog.retiredEffectIds.map(effectId => ({ effectId, options: {} }));
  const invalid = [...removed, { effectId: "unknown", options: {} }, { effectId: "damage", options: {} },
    { effectId: "damage", targetId: "enemy", options: { amount: "bad" } },
    { effectId: "change-at", targetId: "self", options: { direction: "decrease", amount: "turnATAmount-2", duration: "turnCount-2" } },
    ...["heal-self", "heal-enemy"].flatMap(id => ["100", "70", "50", "25"].map(chance => leaf(id, {}, chance)))];
  for (const item of invalid) {
    const s = flat([item]), before = structuredClone(s);
    assert.equal(presentCSkill(s).text, null, item.effectId); assert.equal(compileCSkill(s).ok, false);
    assert.deepEqual(s, before);
  }
  for (const item of removed) assert.deepEqual(migrateSelection("C", flat([item]), catalog), flat([item]));
  assert.equal(presentCSkill(null).text, null);
});
test("public variants, aura correlation and chance restrictions", () => {
  const context = { mode: "normal" }, defs = cControlDefinitions(catalog, context);
  assert.deepEqual(catalog.effects.filter(d => d.chanceEnabled).map(d => d.id), ["damage-enemy"]);
  assert.ok(!catalog.effects.some(d => d.semantics.type === "clearStatus"));
  assert.ok(!Object.keys(catalog.optionSets).some(key => key.startsWith("clear-")));
  for (const d of catalog.effects.filter(d => d.semantics.type === "addBuff"))
    assert.equal(d.semantics.amountSign, d.semantics.target === "self" ? 1 : -1);
  let aura = changeCControl({}, "effectId", "grant-on-hit", catalog, context);
  for (const [statusId, targetId] of [["focus", "self"], ["crack", "enemy"], ["clean", "self"]]) {
    aura = changeCControl(aura, "statusId", statusId, catalog, context);
    assert.equal(aura.targetId, targetId); assert.equal(aura.options.amount, "timedStacks-1");
    assert.equal(cControlView(defs, aura).fields.find(f => f.key === "statusId").options.length, 8);
  }
});
test("compiled random removal executes three separate draws in battle, distributing across statuses", () => {
  const skill = compileCSkill(flat([leaf("remove-random-debuff-self")])).skill;
  assert.deepEqual(skill.effect, [{ type: "removeRandomStatusStack", target: "self", group: "debuff", repeat: 3 }]);
  const stats = { AT: 3, DF: 3, SP: 1, maxHP: 1000 };
  const data = { BATTLERS: [{ id: "b1", dSkill: { effect: [
    { type: "changeValue", target: "self", key: "ap", op: "set", value: 30 },
    { type: "changeStatus", target: "self", status: "crack", value: 2 },
    { type: "changeStatus", target: "self", status: "steam", value: 1 },
  ] } }, { id: "b2" }], DUCKS: [{ id: "d1", stats, dice: [0], cSkill: skill }, { id: "d2", stats, dice: [0] }] };
  const battle = runBattle({ data, p1: { battlerId: "b1", duckId: "d1" }, p2: { battlerId: "b2", duckId: "d2" }, maxTurns: 1, field: "dev-no-field", rng: () => 0 });
  const events = battle.events.filter(e => e.code === "RANDOM_STATUS_STACK_REMOVED");
  assert.deepEqual(events.map(e => [e.status, e.before, e.after]), [["crack", 2, 1], ["crack", 1, 0], ["steam", 1, 0]]);
});
