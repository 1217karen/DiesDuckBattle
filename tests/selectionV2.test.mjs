import test from "node:test";
import assert from "node:assert/strict";
import { createASkillCatalog } from "../js/aSkillCatalog.js";
import { createBSkillCatalog } from "../js/bSkillCatalog.js";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { compileASkill } from "../js/aSkillCompiler.js";
import { compileBSkill } from "../js/bSkillCompiler.js";
import { compileCSkill } from "../js/cSkillCompiler.js";
import { calculateASkillResources } from "../js/aSkillResources.js";
import { calculateCSkillResources } from "../js/cSkillResources.js";
import { migrateSelection, resolveSelection } from "../js/selectionNormalization.js";
import { migratePlayerBuild } from "../js/playerBuildMigration.js";
import { createEmptyPlayerBuild } from "../js/playerBuildModel.js";
import { createPlayerBuildStorage, PLAYER_BUILD_STORAGE_KEY, LEGACY_PLAYER_BUILD_STORAGE_KEY } from "../js/playerBuildStorage.js";
import { inspectBuildForSave } from "../js/buildSaveInspection.js";
import { inspectBattleLoadout, compileBattleLoadout } from "../js/battleLoadoutCompiler.js";
import { getOpponent } from "../js/opponentSource.js";
import { STATUS_METADATA, statusLabel } from "../js/statusMetadata.js";
import { effectSelectionFields } from "../js/effectSelectionCatalog.js";
const ac=createASkillCatalog(),bc=createBSkillCatalog(),cc=createCSkillCatalog();
const base={stats:{AT:2,DF:2,SP:3},diceFrame:"light",dice:[0,0,0,0,0,0]};
const a=(leaf)=>({triggerId:"exact:0",effects:[leaf]});
const c=(leaf,mode="normal")=>({mode,structure:{kind:"flat",effects:[leaf]}});
function memory(entries={}) {const values=new Map(Object.entries(entries));return {values,writes:0,getItem:key=>values.get(key)??null,setItem(key,value){this.writes++;values.set(key,value);}};}

test("all production A variants/amounts/chances preserve exact engine semantics and prices",()=>{
  for(const effect of ac.effects) for(const amount of effect.requiresAmount?effect.amountOptions:[null]) for(const chance of effect.polarity==="benefit"?ac.chanceOptions:[ac.chanceOptions[0]]) {
    const frame=effect.exactFace>4?"heavy":"light";
    const build={...base,diceFrame:frame};
    const old={triggerId:`exact:${effect.exactFace??0}`,effects:[{effectId:effect.id,...(amount?{amountOptionId:amount.id}:{}),chanceOptionId:chance.id}]};
    const next=migrateSelection("A",old,ac);
    const before=compileASkill(build,old),after=compileASkill(build,next);
    assert.equal(after.ok,before.ok,effect.id);assert.deepEqual(after.skill,before.skill,effect.id);
    for(const key of ["netCost","remaining","drawbackPoints","benefitCount"]) assert.equal(after.resources[key],before.resources[key],`${effect.id}/${key}`);
    assert.deepEqual(resolveSelection("A",next,ac).errors,[]);
  }
});
test("all production B combinations preserve trusted rule output",()=>{
  for(const d of bc.events) for(const status of d.optionAxes.statusId?bc.optionSets[d.optionAxes.statusId]:[null]) {
    const old={type:"event",triggerId:d.triggerId,conditionId:d.conditionId,effectId:d.effectId,options:status?{statusId:status.id}:{}};
    const next=migrateSelection("B",old,bc), result=compileBSkill(next);
    assert.equal(result.ok,true,JSON.stringify({old,next,result}));assert.deepEqual(result.bSkills,compileBSkill(old).bSkills,d.id);
  }
});
test("all production C options preserve engine semantics and AP",()=>{
  for(const d of cc.effects) {
    // Exercise each option of every axis against the other axes' first options.
    const defaults=Object.fromEntries(Object.entries(d.optionAxes).map(([axis,set])=>[axis,cc.optionSets[set][0].id]));
    for(const [axis,set] of Object.entries(d.optionAxes)) for(const option of cc.optionSets[set]) for(const chance of d.chanceEnabled?cc.chanceOptions:[null]) {
      const old=c({effectId:d.id,options:{...defaults,[axis]:option.id},...(chance?{chanceOptionId:chance.id}:{})},d.modes[0]);
      const next=migrateSelection("C",old,cc), before=compileCSkill(old),after=compileCSkill(next);
      assert.equal(before.ok,true,d.id);assert.equal(after.ok,true,JSON.stringify({old,next,after}));assert.deepEqual(after.skill,before.skill,d.id);
      assert.equal(calculateCSkillResources(next).requiredAP,calculateCSkillResources(old).requiredAP);
    }
  }
});
test("A grant is split into effect/target/status/amount; status and polarity are trusted",()=>{
  const normalized=migrateSelection("A",a({effectId:"grant-crack-enemy",amountOptionId:"amount-1",chanceOptionId:"100"}),ac);
  assert.deepEqual(normalized.effects[0],{effectId:"grant-status",targetId:"enemy",statusId:"crack",options:{amount:"amount-1"},chanceOptionId:"100"});
  normalized.effects[0].statusId="Headwind";
  assert.equal(compileASkill(base,normalized).skill.effect[0].status,"Headwind");
  const leaf={effectId:"damage",targetId:"enemy",options:{amount:"amount-5"}};
  assert.equal(calculateASkillResources(base,a(leaf)).effectCost,3);
  assert.equal(calculateASkillResources(base,a({...leaf,targetId:"self"})).drawbackPoints,3);
  assert.equal(calculateASkillResources(base,a({...leaf,targetId:"self"})).effectCost,0);
  assert.equal(compileASkill(base,a({...leaf,targetId:"self",chanceOptionId:"50"})).ok,false);
});
test("illegal axes, target/status combinations and unknown fields are rejected",()=>{
  for(const leaf of [
    {effectId:"damage",targetId:"both",options:{amount:"amount-5"}},
    {effectId:"damage",targetId:"enemy",statusId:"crack",options:{amount:"amount-5"}},
    {effectId:"grant-status",targetId:"enemy",statusId:"unknown",options:{amount:"amount-1"}},
    {effectId:"change-at",targetId:"enemy",options:{amount:"amount-2",direction:"increase"}},
    {effectId:"damage",targetId:"enemy",options:{amount:"amount-5",price:"0"}},
  ]) assert.equal(compileASkill(base,a(leaf)).ok,false,JSON.stringify(leaf));
  assert.equal(compileCSkill(c({effectId:"revive",targetId:"enemy",options:{maxHpPct:"revivePct-0.01"}},"special")).ok,false);
});
test("shared status labels and normalized labels are catalog-owned for A/B/C",()=>{
  for(const catalog of [ac,bc,cc]) {
    assert.ok(catalog.selectionEffects.some(e=>e.id==="grant-status"));
    const view=effectSelectionFields(catalog.selectionEffects,{effectId:"grant-status",targetId:"enemy"});
    assert.equal(view.fields.find(f=>f.key==="statusId").options.find(o=>o.id==="crack").label,"亀裂");
    for(const e of catalog.selectionEffects) assert.doesNotMatch(e.label,/self|enemy|亀裂|[0-9]|%/);
  }
  for(const {id,label} of STATUS_METADATA) assert.equal(statusLabel(id),label);
});
test("v1 -> v2 preserves complete loadout and round-trips only v2 selections",async()=>{
  const old=(await getOpponent("dev-opponent-1")).build, raw=JSON.stringify(old), converted=migratePlayerBuild(old);
  assert.equal(converted.ok,true);assert.equal(converted.build.schemaVersion,2);assert.equal(JSON.stringify(old),raw);
  const options={duckId:old.ducks[0].id,battlerId:"p1",battlerName:"自分"};
  assert.deepEqual(compileBattleLoadout(converted.build,options),compileBattleLoadout(old,options));
  const storage=memory({[LEGACY_PLAYER_BUILD_STORAGE_KEY]:raw}),repo=createPlayerBuildStorage(storage);
  const loaded=repo.load();assert.equal(loaded.migratedFrom,1);assert.equal(storage.writes,0);
  assert.equal(repo.save(loaded.build).ok,true);assert.equal(storage.values.get(LEGACY_PLAYER_BUILD_STORAGE_KEY),raw);
  const reloaded=repo.load();assert.equal(inspectBattleLoadout(reloaded.build,options.duckId).ready,true);
  assert.equal(JSON.parse(storage.values.get(PLAYER_BUILD_STORAGE_KEY)).schemaVersion,2);
});
test("partial normalized axes are incomplete, violations remain invalid",async()=>{
  const b=migratePlayerBuild((await getOpponent("dev-opponent-1")).build).build;
  for(const leaf of [{effectId:""},{effectId:"damage",options:{}},{effectId:"grant-status",targetId:"enemy",options:{}},{effectId:"grant-status",targetId:"enemy",statusId:"crack",options:{}}]) {
    b.ducks[0].aSelection=a(leaf);const r=inspectBuildForSave(b);
    assert.equal(r.canSave,true,JSON.stringify(r));assert.ok(r.incomplete.length);
  }
  b.ducks[0].aSelection=a({effectId:"grant-status",targetId:"enemy",statusId:"unknown",options:{}});
  assert.equal(inspectBuildForSave(b).canSave,false);
});
test("unmappable/corrupt/future data never gets repaired or overwritten",async()=>{
  const old=(await getOpponent("dev-opponent-1")).build;old.ducks[0].aSelection.effects[0].effectId="missing-old-effect";
  for(const [raw,status] of [[JSON.stringify(old),"migration-required"],["{","corrupt"],['{"schemaVersion":99}',"unsupported-version"]]) {
    const storage=memory({[LEGACY_PLAYER_BUILD_STORAGE_KEY]:raw}),repo=createPlayerBuildStorage(storage);
    assert.equal(repo.load().status,status);assert.equal(repo.save(createEmptyPlayerBuild()).ok,false);
    assert.equal(storage.writes,0);assert.equal(storage.values.get(LEGACY_PLAYER_BUILD_STORAGE_KEY),raw);
  }
});

test("unfinished axes do not produce a guessed polarity/cost violation",async()=>{
  const b=migratePlayerBuild((await getOpponent("dev-opponent-1")).build).build;
  b.ducks[0].aSelection=a({effectId:"grant-status",targetId:"self",options:{amount:"amount-1"},chanceOptionId:"50"});
  let r=inspectBuildForSave(b); assert.equal(r.canSave,true,JSON.stringify(r));assert.equal(r.complete,false);
  assert.equal(calculateASkillResources(b.ducks[0],b.ducks[0].aSelection).remaining,null);
  b.ducks[0].dice=[1,1,2,2,3,4];
  b.ducks[0].aSelection=a({effectId:"heal",options:{amount:"amount-10"}});
  r=inspectBuildForSave(b);assert.equal(r.canSave,true,JSON.stringify(r));
  b.ducks[0].aSelection.effects[0].targetId="self";
  assert.equal(inspectBuildForSave(b).canSave,false);
});
test("legacy extra options conflicting with new axes cannot be silently repaired",async()=>{
  const old=(await getOpponent("dev-opponent-1")).build;
  old.ducks[0].cSelection=c({effectId:"turn-at-self-up",options:{amount:"turnATAmount-2",duration:"turnCount-2",direction:"unknown"}});
  assert.equal(migratePlayerBuild(old).status,"migration-required");
});
test("v2 incomplete B and C remain saveable; invalid status/chance stay invalid",async()=>{
  const b=migratePlayerBuild((await getOpponent("dev-opponent-1")).build).build;
  b.battler.bSelection={type:"event",triggerId:"after-hit",conditionId:"always",effectId:"grant-status",targetId:"enemy",options:{activation:"guaranteed"}};
  b.ducks[0].cSelection=c({effectId:"grant-status",targetId:"enemy",options:{amount:"statusStacks-3"}});
  let r=inspectBuildForSave(b);assert.equal(r.canSave,true,JSON.stringify(r));assert.equal(r.complete,false);
  b.ducks[0].cSelection.structure.effects[0].statusId="unknown";
  assert.equal(inspectBuildForSave(b).canSave,false);
  b.ducks[0].aSelection=a({effectId:"",targetId:"alien"});
  assert.equal(inspectBuildForSave(b).canSave,false);
});
test("v2 C random/HP branch migration preserves ordering and never mutates input",()=>{
  const leaf={effectId:"damage-enemy",options:{amount:"damageAmount-50"}};
  for(const structure of [{kind:"random",branches:[{effects:[leaf]},{effects:[leaf]}]},
    {kind:"hpCondition",thresholdOptionId:"hpThreshold-0.5",branches:{met:{effects:[leaf]},unmet:{effects:[leaf]}}}]) {
    const old={mode:"normal",structure},snapshot=structuredClone(old), next=migrateSelection("C",old,cc);
    assert.deepEqual(old,snapshot); assert.deepEqual(compileCSkill(next).skill,compileCSkill(old).skill);
    resolveSelection("C",next,cc); assert.deepEqual(old,snapshot);
  }
});

test("status grouping and engine iteration order remain unchanged",async()=>{
  const {STATUS_GROUPS}=await import("../js/statusGroups.js");
  assert.deepEqual(STATUS_GROUPS.all,["crack","Headwind","roughWave","tailwind","focus","counter","clean","steam"]);
  assert.deepEqual(STATUS_GROUPS.debuff,["crack","Headwind","roughWave","steam"]);
  assert.deepEqual(STATUS_GROUPS.buff,["tailwind","focus","counter","clean"]);
});
test("v2 invalid data is protected without falling back to readable v1",async()=>{
  const old=(await getOpponent("dev-opponent-1")).build;
  const storage=memory({[PLAYER_BUILD_STORAGE_KEY]:"{",[LEGACY_PLAYER_BUILD_STORAGE_KEY]:JSON.stringify(old)});
  const repo=createPlayerBuildStorage(storage);assert.equal(repo.load().status,"corrupt");assert.equal(repo.save(createEmptyPlayerBuild()).ok,false);assert.equal(storage.writes,0);
});
test("missing legacy C scope remains incomplete after migration",async()=>{
  const old=(await getOpponent("dev-opponent-1")).build;
  old.ducks[0].cSelection=c({effectId:"clear-debuff-group-self",options:{}});
  const migrated=migratePlayerBuild(old);assert.equal(migrated.ok,true);
  const inspection=inspectBuildForSave(migrated.build);
  assert.equal(inspection.canSave,true,JSON.stringify(inspection));assert.equal(inspection.complete,false);
});
