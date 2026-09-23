import test from "node:test";
import assert from "node:assert/strict";
import { inspectBattleLoadout, compileBattleLoadout } from "../js/battleLoadoutCompiler.js";
import { createEmptyDuck } from "../js/playerBuildModel.js";
import { createASkillCatalog } from "../js/aSkillCatalog.js";
import { createBSkillCatalog } from "../js/bSkillCatalog.js";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { compileASkill } from "../js/aSkillCompiler.js";
import { compileBSkill } from "../js/bSkillCompiler.js";
import { compileCSkill } from "../js/cSkillCompiler.js";
import { compileDSkill } from "../js/dSkillCompiler.js";
import { runBattle } from "../js/battleEngine.js";
import { calcMaxHPFromStats } from "../js/statsUtil.js";

function complete(id = "duck-1") {
  const a = createASkillCatalog().effects.find(e => e.id === "damage-enemy");
  const cCatalog = createCSkillCatalog();
  const c = cCatalog.effects.find(e => e.id === "damage-enemy");
  return { schemaVersion: 1,
    battler: { bSelection: { type: "trait", traitId: createBSkillCatalog().traits[0].id, options: {} },
      dSelection: { optionId: "add-self-0" } },
    ducks: [{ ...createEmptyDuck({ idFactory: () => id }), name: "基本型", stats: { AT: 2, DF: 2, SP: 3 }, diceFrame: "light",
      aSelection: { triggerId: "exact:0", effects: [{ effectId: a.id, amountOptionId: a.amountOptions.at(-1).id }] },
      cSelection: { mode: "normal", structure: { kind: "flat", effects: [{ effectId: c.id,
        options: Object.fromEntries(Object.entries(c.optionAxes).map(([axis, set]) => [axis, cCatalog.optionSets[set][0].id])) }] } } }] };
}
const options = { duckId: "duck-1", battlerId: "player-1", battlerName: "プレイヤー" };
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test("complete loadout matches all production compilers and has only engine fields", () => {
  const build = complete(), source = build.ducks[0];
  assert.deepEqual(inspectBattleLoadout(build, source.id), { ready: true, invalid: [], incomplete: [] });
  const result = compileBattleLoadout(build, options);
  assert.equal(result.ok, true);
  assert.deepEqual(result.battler, { id: options.battlerId, name: options.battlerName,
    bSkills: compileBSkill(build.battler.bSelection).bSkills, dSkill: compileDSkill(build.battler.dSelection).skill });
  assert.deepEqual(result.duck, { id: source.id, name: source.name, stats: source.stats, dice: source.dice,
    aSkill: { id: "A_PLAYER", name: "Aスキル", ...compileASkill(source, source.aSelection).skill },
    cSkill: { id: "C_PLAYER", name: "Cスキル", ...compileCSkill(source.cSelection).skill } });
  assert.equal("maxHP" in result.duck, false);
  assert.equal("maxHP" in result.duck.stats, false);
  const forbidden = new Set(["aSelection", "bSelection", "cSelection", "dSelection", "diceFrame", "resources", "inspection", "catalog", "cost", "dirty"]);
  function check(value) { if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
    assert.equal(forbidden.has(key), false, key); check(child);
  } }
  check(result);
});

for (const skill of ["bSelection", "dSelection"]) test(`shared ${skill} draft blocks every Duck`, () => {
  const build = complete(); build.ducks.push(complete("duck-2").ducks[0]); build.battler[skill] = null;
  for (const duck of build.ducks) {
    const r = compileBattleLoadout(build, { ...options, duckId: duck.id });
    assert.equal(r.ok, false); assert.ok(r.inspection.incomplete.length); assert.equal("duck" in r, false);
  }
});
for (const [field, selection] of [
  ["bSelection", { type: "trait", traitId: "unknown", options: {} }],
  ["dSelection", { optionId: "unknown" }],
]) test(`invalid shared ${field} rejects engine generation`, () => {
  const build = complete(); build.battler[field] = selection;
  const result = compileBattleLoadout(build, options);
  assert.equal(result.ok, false); assert.ok(result.inspection.invalid.length);
  assert.equal("battler" in result, false); assert.equal("duck" in result, false);
});
for (const [name, change] of [
  ["A", d => { d.aSelection = null; }],
  ["C", d => { d.cSelection = null; }],
  ["stats", d => { d.stats.AT = null; }],
  ["dice frame unset", d => { d.stats.SP = null; d.diceFrame = null; }],
  ["A amount", d => { delete d.aSelection.effects[0].amountOptionId; }],
]) test(`${name} draft blocks only selected Duck`, () => {
  const build = complete(), draft = complete("draft").ducks[0]; change(draft); build.ducks.push(draft);
  assert.equal(compileBattleLoadout(build, options).ok, true);
  const r = compileBattleLoadout(build, { ...options, duckId: draft.id });
  assert.equal(r.ok, false); assert.ok(r.inspection.incomplete.length); assert.deepEqual(r.inspection.invalid, []);
});
for (const [name, change] of [
  ["stats", d => { d.stats.AT = 100; }],
  ["dice", d => { d.dice[0] = 6; }],
  ["A", d => { d.aSelection.triggerId = "unknown"; }],
  ["C", d => { d.cSelection.mode = "unknown"; }],
]) test(`${name} invalid blocks only selected Duck`, () => {
  const build = complete(), bad = complete("bad").ducks[0]; change(bad); build.ducks.push(bad);
  assert.equal(compileBattleLoadout(build, options).ok, true);
  const r = compileBattleLoadout(build, { ...options, duckId: bad.id });
  assert.equal(r.ok, false); assert.ok(r.inspection.invalid.length); assert.equal("battler" in r, false);
});
test("unknown IDs, duplicate IDs, malformed model and metadata return explicit failure", () => {
  assert.equal(inspectBattleLoadout(complete(), "missing").invalid[0].code, "DUCK_NOT_FOUND");
  assert.equal(compileBattleLoadout(complete()).ok, false);
  assert.equal(inspectBattleLoadout(null, "duck-1").invalid[0].code, "INVALID_MODEL");
  const build = complete(); build.ducks.push(complete().ducks[0]);
  assert.equal(inspectBattleLoadout(build, "duck-1").invalid[0].code, "AMBIGUOUS_DUCK_ID");
  assert.equal(compileBattleLoadout(complete(), { ...options, battlerId: "" }).inspection.invalid[0].code, "INVALID_BATTLER_METADATA");
  assert.equal(compileBattleLoadout(complete(), { ...options, battlerName: null }).ok, false);
});
test("fallback labels retain original Duck index", () => {
  const build = complete(), draft = createEmptyDuck({ idFactory: () => "draft" }); build.ducks.push(draft);
  assert.ok(inspectBattleLoadout(build, "draft").incomplete.filter(i => i.duckId === "draft").every(i => i.ownerName === "アヒル 2"));
});
test("frozen input remains unchanged; results and later compilations are independent", () => {
  const build = freeze(complete()), before = JSON.stringify(build);
  const first = compileBattleLoadout(build, options), second = compileBattleLoadout(build, options);
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  assert.notEqual(first.duck.stats, build.ducks[0].stats); assert.notEqual(first.duck.dice, build.ducks[0].dice);
  first.duck.stats.AT = 999; first.duck.dice[0] = 999;
  first.duck.aSkill.effect.push({}); first.duck.cSkill.effect.push({}); first.battler.bSkills.push({});
  first.battler.dSkill.effect.values.push(999);
  assert.deepEqual(second, compileBattleLoadout(build, options)); assert.equal(JSON.stringify(build), before);
});
test("two compiled loadouts start and finish an existing engine battle; engine computes HP", () => {
  const p1 = compileBattleLoadout(complete(), options);
  const p2 = compileBattleLoadout(complete("duck-2"), { duckId: "duck-2", battlerId: "player-2", battlerName: "相手" });
  assert.equal(p1.ok && p2.ok, true);
  const battle = runBattle({ p1: { battlerId: p1.battler.id, duckId: p1.duck.id },
    p2: { battlerId: p2.battler.id, duckId: p2.duck.id },
    data: { BATTLERS: [p1.battler, p2.battler], DUCKS: [p1.duck, p2.duck] }, maxTurns: 2, rng: () => 0.5 });
  const start = battle.events.find(e => e.type === "battleStart");
  assert.equal(start.meta.P1.maxHP, calcMaxHPFromStats(p1.duck.stats));
  assert.equal(start.meta.P2.maxHP, calcMaxHPFromStats(p2.duck.stats));
  assert.ok(battle.events.some(e => e.type === "turnStart"));
  assert.ok(battle.events.some(e => e.type === "battleEnd"));
});
