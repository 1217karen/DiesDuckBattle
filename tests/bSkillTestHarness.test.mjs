import test from "node:test";
import assert from "node:assert/strict";
import { createBSkillCatalog, getBTriggerOptions, getBConditionOptions, getBEffectOptions, getBTraitOptions } from "../js/bSkillCatalog.js";
import { createBDevCatalog } from "../js/bSkillDevFixtures.js";
import { createBTestSettings, runBSkillTestBattle } from "../js/bSkillTestHarness.js";
import { compileBSkill } from "../js/bSkillCompiler.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";

const catalog = createBDevCatalog();
const event = (triggerId, conditionId, effectId, statusId) => ({ type: "event", triggerId, conditionId, effectId, options: statusId ? { statusId } : {} });
const trait = traitId => ({ type: "trait", traitId, options: {} });
const run = (selection, overrides = {}) => runBSkillTestBattle(selection, { catalog,
  settings: { ...createBTestSettings(), maxTurns: 1, ...overrides }, rng: () => .9 });

test("表示metadata、queryの合法絞り込み、status group、trait一覧", () => {
  const c = createBSkillCatalog();
  assert.deepEqual(getBTriggerOptions(c), c.triggers); assert.deepEqual(getBTraitOptions(c), c.traits);
  const rows = [];
  for (const trigger of getBTriggerOptions(c)) {
    assert.ok(trigger.label);
    for (const condition of getBConditionOptions(trigger.id, c)) {
      assert.ok(condition.label);
      for (const e of getBEffectOptions(trigger.id, condition.id, c)) {
        assert.ok(e.triggerLabel && e.conditionLabel && e.effectLabel); rows.push(e);
        assert.equal(e.triggerId, trigger.id); assert.equal(e.conditionId, condition.id);
        for (const key of Object.keys(e.tuning)) assert.ok(e.tuningLabels[key]);
        for (const group of Object.values(e.optionAxes)) assert.deepEqual(c.optionSets[group].map(o => o.id), [...STATUS_GROUPS[group]]);
      }
    }
  }
  assert.deepEqual(new Set(rows.map(e => e.id)), new Set(c.events.map(e => e.id)));
  assert.equal(rows.length, c.events.length);
  assert.deepEqual(getBEffectOptions("after-take-hit", "always", c).map(e => e.effectId), ["self-buff", "enemy-debuff"]);
  assert.deepEqual(getBConditionOptions("unknown", c), []);
  assert.deepEqual(getBEffectOptions("phase-start", "damage-high", c), []);
  assert.ok(c.events.filter(e => e.triggerId === "phase-start").every(e => !Object.keys(e.optionAxes).length));
  assert.ok(c.traits.every(t => t.label && Object.keys(t.tuning).every(key => t.tuningLabels[key])));
  assert.ok(Object.values(c.optionSets).flat().every(o => o.label));
});

test("productionで戦闘可・harnessで毎回再compileしraw/不正IDを拒否", () => {
  const selection = event("phase-start", "always", "both-buff");
  const production = runBSkillTestBattle(selection);
  assert.equal(production.compilation.ok, true); assert.deepEqual(production.compilation.unresolved, []); assert.ok(production.battle);
  assert.ok(run(selection).battle);
  assert.equal(run({ ...selection, bSkills: [{ trigger: "phaseStart" }] }).battle, null);
  const c = createBDevCatalog(); assert.equal(compileBSkill(selection, { catalog: c }).ok, true);
  c.events[0].tuning.stacks = null;
  assert.equal(runBSkillTestBattle(selection, { catalog: c }).battle, null);
  assert.equal(run({ ...selection, effectId: "unknown" }).battle, null);
});

test("P1だけにcompiled B装備、HP/AP/status初期値は独立して反映", () => {
  const settings = createBTestSettings(); settings.p1Status.crack = 2; settings.p2Status.focus = 3;
  const result = run(event("phase-start", "always", "both-buff"), { ...settings, p1HP: 421, p2HP: 632, p1AP: 8, p2AP: 12, maxTurns: 1 });
  const events = result.battle.events;
  const initial = events.filter(e => e.originSkill?.category === "D");
  for (const [side, hp, ap, status, stacks] of [["P1", 421, 8, "crack", 2], ["P2", 632, 12, "focus", 3]]) {
    assert.ok(initial.some(e => e.target === side && e.key === "hp" && e.after === hp));
    assert.ok(initial.some(e => e.target === side && e.key === "ap" && e.after === ap));
    assert.ok(initial.some(e => e.target === side && e.status === status && e.after === stacks));
  }
  const ids = result.compilation.bSkills.map(b => b.id);
  const triggered = events.filter(e => e.type === "skillTriggered" && ids.includes(e.skill.skillId));
  assert.ok(triggered.length); assert.ok(triggered.every(e => e.actor === "P1"));
  assert.ok(!events.some(e => e.type === "skillTriggered" && e.actor === "P2" && e.skill.category === "B"));
  assert.ok(result.finalState.hp && result.finalState.ap && result.finalState.status);
});

for (const target of ["self", "enemy"]) test(`開発回復は初期化後1回・afterHealの対象 ${target}`, () => {
  const r = run(event("after-heal", "always", "target-buff", "focus"), {
    p1HP: 100, p2HP: 200, p1SP: 2, p2SP: 3, maxTurns: 2, p1AT: 0, p2AT: 0, p1Dice: 0, p2Dice: 0,
    devHeal: { enabled: true, target, amount: 30 },
  });
  const events = r.battle.events, heals = events.filter(e => e.type === "heal" && e.source === "devHeal");
  assert.equal(heals.length, 1); assert.equal(heals[0].actor, "P1"); assert.equal(heals[0].turn, 1);
  assert.equal(heals[0].target, target === "self" ? "P1" : "P2");
  assert.equal(heals[0].hpBefore, target === "self" ? 100 : 200); assert.equal(heals[0].value, 30);
  const initEnd = events.findLastIndex(e => e.originSkill?.category === "D"); assert.ok(events.indexOf(heals[0]) > initEnd);
  const grants = events.filter(e => e.type === "statusChange" && e.originSkill?.skillId === r.compilation.bSkills[0].id);
  assert.equal(grants.length, 1); assert.equal(grants[0].target, heals[0].target); assert.equal(grants[0].after, 2);
});

for (const selection of [event("phase-start", "always", "both-buff"),
  event("before-attack", "self-has-debuff", "attack-at-up"), event("after-hit", "always", "enemy-debuff", "steam"),
  event("after-take-hit", "always", "self-buff", "focus"), event("phase-end", "always", "heal-by-buff")]) {
  test(`event代表が実戦発動 ${selection.triggerId}`, () => {
    const settings = createBTestSettings(); settings.p1Status.crack = 3; settings.p1Status.clean = 1;
    const r = run(selection, { ...settings, maxTurns: 1 });
    assert.ok(r.battle.events.some(e => e.type === "skillTriggered" && e.skill.skillId === r.compilation.bSkills[0].id));
  });
}
test("traitのpassive・extra attack・倍率が実戦へ反映", () => {
  const passive = run(trait("hp-high-at"));
  assert.ok(passive.battle.events.some(e => e.type === "passiveSkillStateChanged" && e.actor === "P1" && e.active));
  const attacks = r => r.battle.events.filter(e => e.type === "normalDamage" && e.actor === "P1");
  assert.equal(attacks(run(trait("hp-high-extra-attack"))).length, 2);
  const r = run(trait("damage-both-up")); assert.equal(r.compilation.bSkills.length, 2);
  assert.ok(r.battle.events.some(e => e.type === "attackChanged" && e.originSkill?.skillId === r.compilation.bSkills[0].id && e.value === 1.5));
  assert.ok(r.battle.events.some(e => e.type === "attackChanged" && e.originSkill?.skillId === r.compilation.bSkills[1].id && e.value === 1.5));
  assert.equal(attacks(r)[0].value, Math.trunc((20 - 3 + 2) * 1.5));
});
test("不正なbattle settingsはengineへ渡さない", () => {
  const s = trait("ap-at");
  for (const overrides of [{ p1HP: 1001 }, { p2SP: 0 }, { maxTurns: NaN }, { p1Status: { crack: 4 } },
    { devHeal: { enabled: true, target: "unknown", amount: 1 } }]) assert.throws(() => run(s, overrides), TypeError);
});
