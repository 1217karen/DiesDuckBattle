import { migratePlayerBuild } from "../js/playerBuildMigration.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyPlayerBuild, createEmptyDuck } from "../js/playerBuildModel.js";
import { createPlayerBuildStorage } from "../js/playerBuildStorage.js";
import { inspectBuildForSave, saveSectionSummary, saveInspectedBuild } from "../js/buildSaveInspection.js";
import { createASkillCatalog } from "../js/aSkillCatalog.js";
import { createBSkillCatalog } from "../js/bSkillCatalog.js";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { createCSkillRules } from "../js/cSkillRules.js";
import { createBuildRules } from "../js/buildRules.js";

const ac = createASkillCatalog(), bc = createBSkillCatalog(), cc = createCSkillCatalog();
const aLeaf = id => { const e = ac.effects.find(e => e.id === id); return { effectId: id,
  ...(e.requiresAmount ? { amountOptionId: e.amountOptions.at(-1).id } : {}) }; };
const cLeaf = id => { const e = cc.effects.find(e => e.id === id); return { effectId: id,
  options: Object.fromEntries(Object.entries(e.optionAxes).map(([axis, set]) => [axis, cc.optionSets[set][0].id])) }; };
function complete() {
  return { schemaVersion: 1, battler: { bSelection: { type: "trait", traitId: bc.traits[0].id, options: {} }, dSelection: { optionId: "add-self-0" } },
    ducks: [{ ...createEmptyDuck({ idFactory: () => "duck-1" }), stats: { AT: 2, DF: 2, SP: 3 }, diceFrame: "light",
      aSelection: { triggerId: "exact:0", effects: [aLeaf("damage-enemy")] },
      cSelection: { mode: "normal", structure: { kind: "flat", effects: [cLeaf("damage-enemy")] } } }] };
}
function check(build, status) {
  const before = JSON.stringify(build), result = inspectBuildForSave(build);
  assert.equal(JSON.stringify(build), before, "inspection must not mutate input");
  assert.equal(result.canSave, status !== "invalid", JSON.stringify(result));
  assert.equal(result.complete, status === "complete", JSON.stringify(result));
  if (status === "incomplete") { assert.equal(result.invalid.length, 0); assert.ok(result.incomplete.length); }
  if (status === "invalid") assert.ok(result.invalid.length);
  return result;
}
test("complete production build, including empty name and zero dice faces", () => {
  const r = check(complete(), "complete"); assert.deepEqual(r.invalid, []); assert.deepEqual(r.incomplete, []);
  assert.equal(saveSectionSummary(r, "A", "duck-1").label, "完成");
});
test("all skills unset are incomplete, never invalid", () => {
  const b = complete(); b.battler = { bSelection: null, dSelection: null };
  b.ducks[0].aSelection = null; b.ducks[0].cSelection = null;
  const r = check(b, "incomplete"); assert.deepEqual(r.incomplete.map(i => i.section).sort(), ["A", "B", "C", "D"]);
});
const event = bc.events[0];
const partialCases = [
  ["empty B DTO", b => { b.battler.bSelection = {}; }],
  ["B event missing effect", b => { b.battler.bSelection = { type: "event", triggerId: event.triggerId, conditionId: event.conditionId, effectId: "", options: {} }; }],
  ["B type only", b => { b.battler.bSelection = { type: "event" }; }],
  ["B required option blank", b => { const e = bc.events.find(e => Object.keys(e.optionAxes).length); b.battler.bSelection = {
    type: "event", triggerId: e.triggerId, conditionId: e.conditionId, effectId: e.effectId, options: {} }; }],
  ["D empty option", b => { b.battler.dSelection = { optionId: "" }; }],
  ["D null option", b => { b.battler.dSelection = { optionId: null }; }],
  ["D missing option", b => { b.battler.dSelection = {}; }],
  ["AT DF missing", b => { b.ducks[0].stats.AT = null; b.ducks[0].stats.DF = null; }],
  ["SP unset with existing dice", b => { b.ducks[0].stats.SP = null; b.ducks[0].diceFrame = null; b.ducks[0].dice = [1,1,2,2,3,4]; }],
  ["A trigger blank", b => { b.ducks[0].aSelection.triggerId = ""; }],
  ["A trigger only", b => { b.ducks[0].aSelection = { triggerId: "exact:0", effects: [] }; }],
  ["A amount missing", b => { delete b.ducks[0].aSelection.effects[0].amountOptionId; }],
  ["A amount null", b => { b.ducks[0].aSelection.effects[0].amountOptionId = null; }],
  ["A empty effect", b => { b.ducks[0].aSelection.effects = [{ effectId: "" }]; }],
  ["C mode only", b => { b.ducks[0].cSelection = { mode: "normal" }; }],
  ["C no effects", b => { b.ducks[0].cSelection.structure.effects = []; }],
  ["C option blank", b => { b.ducks[0].cSelection.structure.effects[0].options = { amount: "" }; }],
  ["C random empty branch", b => { b.ducks[0].cSelection.structure = { kind: "random", branches: [{ effects: [cLeaf("damage-enemy")] }, { effects: [] }] }; }],
  ["C HP threshold missing", b => { b.ducks[0].cSelection.structure = { kind: "hpCondition", branches: {
    met: { effects: [cLeaf("damage-enemy")] }, unmet: { effects: [cLeaf("heal-self")] } } }; }],
];
for (const [name, change] of partialCases) test(`${name}: incomplete is saveable`, () => { const b = complete(); change(b); check(b, "incomplete"); });

const invalidCases = [
  ["AT above maximum", "stats", b => { b.ducks[0].stats.AT = createBuildRules().stats.AT.max + 1; }],
  ["DF below minimum", "stats", b => { b.ducks[0].stats.DF = createBuildRules().stats.DF.min - 1; }],
  ["stat total", "stats", b => { b.ducks[0].stats.AT = 5; b.ducks[0].stats.DF = 5; }],
  ["SP mismatch", "stats", b => { b.ducks[0].stats.SP = 1; }],
  ["unknown SP", "stats", b => { b.ducks[0].stats.SP = 4; }],
  ["outside frame", "dice", b => { b.ducks[0].dice[0] = 6; }],
  ["too many copies", "dice", b => { b.ducks[0].dice = [1,1,1,1,0,0]; }],
  ["dice resource deficit", "dice", b => { b.ducks[0].dice = [1,1,1,2,2,2]; }],
  ["A overspent", "A", b => { b.ducks[0].dice = [1,1,2,2,3,4]; b.ducks[0].aSelection.effects = Array.from({length:ac.maxEffects},()=>aLeaf("damage-enemy")); }],
  ["A too many effects", "A", b => { b.ducks[0].aSelection.effects = Array.from({length:ac.maxEffects+1},()=>aLeaf("damage-enemy")); }],
  ["A exact-only effect", "A", b => { const e = ac.effects.find(e => e.exactFace != null); b.ducks[0].aSelection.effects = [aLeaf(e.id)]; }],
  ["A forbidden duplicate", "A", b => { const e = ac.effects.find(e => !e.allowDuplicate); b.ducks[0].aSelection.effects = [aLeaf(e.id),aLeaf(e.id)]; }],
  ["A drawback chance", "A", b => { b.ducks[0].aSelection.effects = [{ ...aLeaf("damage-self"), chanceOptionId: "50" }]; }],
  ["A unknown ID while trigger blank", "A", b => { b.ducks[0].aSelection = { triggerId: "", effects: [{effectId:"unknown"}] }; }],
  ["B illegal filled combination", "B", b => { b.battler.bSelection = { type:"event", triggerId:event.triggerId, conditionId:event.conditionId, effectId:"unknown", options:{} }; }],
  ["B unknown ID while effect blank", "B", b => { b.battler.bSelection = { type:"event", triggerId:"unknown", conditionId:"", effectId:"", options:{} }; }],
  ["B field from other type", "B", b => { b.battler.bSelection.triggerId = ""; }],
  ["B unknown option with extra missing axis", "B", b => { const e = bc.events.find(e => Object.keys(e.optionAxes).length); b.battler.bSelection = {
    type:"event",triggerId:e.triggerId,conditionId:e.conditionId,effectId:e.effectId,options:{[Object.keys(e.optionAxes)[0]]:"unknown"} }; }],
  ["C maximum effects", "C", b => { b.ducks[0].cSelection.structure.effects = Array.from({length:createCSkillRules().maxEffects+1},()=>cLeaf("damage-enemy")); }],
  ["special branching", "C", b => { b.ducks[0].cSelection = { mode:"special", structure:{kind:"random",branches:[{effects:[]},{effects:[]}]} }; }],
  ["C mode unavailable", "C", b => { b.ducks[0].cSelection.structure.effects = [cLeaf("revive-self")]; }],
  ["C unknown ID with missing option", "C", b => { b.ducks[0].cSelection.structure.effects = [{effectId:"unknown",options:{}}]; }],
  ["C unknown chance", "C", b => { b.ducks[0].cSelection.structure.effects[0].chanceOptionId = "invalid"; }],
  ["C chance forbidden", "C", b => { b.ducks[0].cSelection.structure.effects = [{...cLeaf("damage-self"),chanceOptionId:"100"}]; }],
  ["C broken branch", "C", b => { b.ducks[0].cSelection.structure = {kind:"random",branches:[null,{effects:[]}]}; }],
  ["C missing branch container", "C", b => { b.ducks[0].cSelection.structure = {kind:"hpCondition"}; }],
  ["D unknown option", "D", b => { b.battler.dSelection = {optionId:"unknown"}; }],
  ["D broken DTO", "D", b => { b.battler.dSelection = {optionId:"",effect:{}}; }],
];
for (const [name, section, change] of invalidCases) test(`${name}: invalid blocks saving`, () => {
  const b = complete(); change(b); const r = check(b, "invalid");
  assert.ok(r.invalid.some(i => i.section === section), JSON.stringify(r));
});
test("overspent A includes numeric deficit and unnamed Duck identity", () => {
  const b = complete(); b.ducks[0].dice = [1,1,2,2,3,4]; b.ducks[0].aSelection.effects = Array.from({length:3},()=>aLeaf("damage-enemy"));
  const i = check(b,"invalid").invalid.find(i=>i.code === "INSUFFICIENT_A_POINTS");
  assert.match(i.message,/Aポイントが\d+pt不足/); assert.equal(i.duckId,"duck-1"); assert.equal(i.ownerName,"アヒル 1");
});
test("all Ducks inspected regardless of selected Duck; name is optional", () => {
  const b = complete(); const second = structuredClone(b.ducks[0]); second.id = "duck-2"; second.name = "速攻型"; second.stats.AT = 99;
  b.ducks.push(second); const r = check(b,"invalid");
  assert.equal(saveSectionSummary(r,"stats","duck-1").label,"完成");
  assert.equal(saveSectionSummary(r,"stats","duck-2").label,"不正");
  assert.ok(r.invalid.some(i=>i.ownerName === "速攻型"));
});
test("zero Ducks is incomplete, not invalid", () => {
  const b = complete(); b.ducks = []; const r = check(b,"incomplete"); assert.equal(r.incomplete[0].code,"NO_DUCK");
});
test("save gate does not write invalid or unapproved drafts and preserves dirty", () => {
  let calls = 0; const repository = { save() { calls++; return {ok:true,status:"saved"}; } };
  const draft = {build:createEmptyPlayerBuild(),dirty:true};
  const pending = saveInspectedBuild(draft,repository); assert.equal(pending.status,"confirmation-required"); assert.equal(pending.state,draft); assert.equal(calls,0);
  const bad = complete(); bad.ducks[0].stats.AT = 99;
  const state = {build:bad,dirty:true}; const denied = saveInspectedBuild(state,repository,{approveIncomplete:true});
  assert.equal(denied.status,"invalid"); assert.equal(denied.state,state); assert.equal(calls,0);
  const saved = saveInspectedBuild(draft,repository,{approveIncomplete:true}); assert.equal(saved.state.dirty,false); assert.equal(calls,1);
  const normal = saveInspectedBuild({build:complete(),dirty:true},repository); assert.equal(normal.status,"saved"); assert.equal(normal.state.dirty,false); assert.equal(calls,2);
});
test("approved incomplete round-trip uses v2, with no inspection data", () => {
  let raw = null; const repository = createPlayerBuildStorage({getItem:()=>raw,setItem:(_,v)=>{raw=v;}});
  const b = complete(); b.ducks[0].aSelection.effects = []; b.battler.dSelection = null;
  assert.equal(saveInspectedBuild({build:b,dirty:true},repository).status,"confirmation-required"); assert.equal(raw,null);
  assert.equal(saveInspectedBuild({build:b,dirty:true},repository,{approveIncomplete:true}).status,"saved");
  assert.deepEqual(repository.load().build,migratePlayerBuild(b).build); assert.deepEqual(Object.keys(JSON.parse(raw)),["schemaVersion","battler","ducks"]);
});
test("storage failure never clears dirty and storage itself still permits game-invalid models", () => {
  const state = {build:complete(),dirty:true};
  const r = saveInspectedBuild(state,{save:()=>({ok:false,status:"storage-error"})}); assert.equal(r.state,state);
  let raw=null; const storage=createPlayerBuildStorage({getItem:()=>raw,setItem:(_,v)=>{raw=v;}});
  state.build.ducks[0].stats.AT=99; assert.equal(storage.save(state.build).ok,true);
});
test("B rejects incompatible combinations of otherwise real IDs", () => {
  const b = complete();
  const other = bc.events.find(e => !bc.events.some(row => row.triggerId === event.triggerId && row.conditionId === event.conditionId && row.effectId === e.effectId));
  assert.ok(other);
  b.battler.bSelection = { type:"event", triggerId:event.triggerId,conditionId:event.conditionId,effectId:other.effectId,options:{} };
  check(b,"invalid");
});
test("unknown B ID remains invalid with missing type", () => {
  const b = complete(); b.battler.bSelection = {traitId:"unknown"}; check(b,"invalid");
});
test("malformed envelopes and selection DTOs return issues without throwing", () => {
  for (const build of [null, {}, {...complete(),battler:null}, {...complete(),battler:[]}]) {
    assert.equal(inspectBuildForSave(build).canSave,false);
  }
  for (const category of ["A","B","C","D"]) {
    const b=complete(), holder=["B","D"].includes(category)?b.battler:b.ducks[0];
    holder[category.toLowerCase()+"Selection"] = {unexpected:()=>{}};
    assert.ok(inspectBuildForSave(b).invalid.some(i=>i.section===category));
  }
});
test("blank effect/type cannot hide unknown option IDs or unnecessary option axes", () => {
  for (const change of [
    b => { b.battler.bSelection = { type:"event",triggerId:"",conditionId:"",effectId:"",options:{unused:""} }; },
    b => { b.battler.bSelection = { options:{statusId:"unknown"} }; },
    b => { b.battler.bSelection = { options:{constructor:"unknown"} }; },
    b => { b.ducks[0].aSelection.effects = [{effectId:"",amountOptionId:"unknown"}]; },
    b => { b.ducks[0].aSelection.effects = [{effectId:"",chanceOptionId:"unknown"}]; },
    b => { b.ducks[0].cSelection.structure.effects = [{effectId:"",options:{amount:"unknown"}}]; },
    b => { b.ducks[0].cSelection.structure.effects = [{effectId:"",options:{constructor:"unknown"}}]; },
    b => { b.ducks[0].cSelection.structure.effects = [{effectId:"",options:{},chanceOptionId:"unknown"}]; },
  ]) { const b = complete(); change(b); check(b,"invalid"); }
});
