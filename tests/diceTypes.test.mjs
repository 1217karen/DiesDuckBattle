import test from "node:test";
import assert from "node:assert/strict";
import { DICE_FRAMES, getDiceFrame } from "../js/diceFrames.js";
import { calculateBuildResources } from "../js/buildResources.js";
import { createBuildRules } from "../js/buildRules.js";
import { createEmptyPlayerBuild, createEmptyDuck } from "../js/playerBuildModel.js";
import { createSettingState, changeSetting, selectedDuck } from "../js/settingState.js";
import { createPlayerBuildStorage, PLAYER_BUILD_STORAGE_KEY } from "../js/playerBuildStorage.js";
import { migratePlayerBuild } from "../js/playerBuildMigration.js";
import { inspectBuildForSave } from "../js/buildSaveInspection.js";
import { compileBattleLoadout } from "../js/battleLoadoutCompiler.js";
import { getATriggerOptions, matchesATrigger } from "../js/aSkillCatalog.js";
import { calculateASkillResources } from "../js/aSkillResources.js";
import { compileASkill } from "../js/aSkillCompiler.js";
import { runBattle } from "../js/battleEngine.js";
const leaf={effectId:"heal",targetId:"enemy",options:{amount:"amount-5"}};
function duck(id="custom-speed",dice) {
  const d=getDiceFrame(id);
  return {...createEmptyDuck({idFactory:()=>"test-duck"}),diceFrame:id,stats:{AT:2,DF:2,SP:d.SP},
    dice:[...(dice??d.initialDice??d.dice)],aSelection:{triggerId:"all",effects:[{...leaf}]},
    cSelection:{mode:"normal",structure:{kind:"flat",effects:[{effectId:"damage",targetId:"enemy",options:{amount:"damageAmount-50"}}]}}};
}
function build(d=duck()) {return {...createEmptyPlayerBuild(),battler:{...createEmptyPlayerBuild().battler,bSelection:{type:"trait",traitId:"ap-at",options:{}},dSelection:{optionId:"add-self-0"}},ducks:[d]};}
const state=b=>createSettingState({ok:true,status:"loaded",build:b});
for(const [id,SP,dice] of [["custom-speed",3,[1,2,3,4,0,0]],["custom-normal",2,[0,2,3,4,5,0]],["custom-heavy",1,[0,0,3,4,5,6]]]) {
  test(`${id}: explicit type switch derives SP and initial dice, preserves AT/DF/A`,()=>{
    const d=duck("custom-heavy",[0,3,3,4,5,6]);d.stats.AT=4;d.stats.DF=4;d.aSelection.triggerId="exact:6";
    const s=changeSetting(state(build(d)),{type:"dice-type",frame:id}),actual=selectedDuck(s);
    assert.equal(actual.stats.SP,SP);assert.deepEqual(actual.dice,dice);
    assert.equal(actual.stats.AT,4);assert.equal(actual.stats.DF,4);assert.deepEqual(actual.aSelection,d.aSelection);
    assert.equal(inspectBuildForSave(s.build).invalid.some(i=>i.code==="STATS_TOTAL"),SP>1);
    assert.equal(calculateBuildResources(actual).stats.remaining,9-SP-8);
    for(const badSP of [0,SP+1,99]) {const bad={...actual,stats:{...actual.stats,SP:badSP}};assert.equal(inspectBuildForSave(build(bad)).canSave,false);assert.equal(compileASkill(bad,bad.aSelection).ok,false);}
  });
  test(`${id}: v2 custom dice load/migration never resets or repairs`,()=>{
    for(const dice of [[0,0,0,...DICE_FRAMES[id].faces.slice(0,3)],[0,0,0,0,0,0]]) {
      const b=build(duck(id,dice)),raw=JSON.stringify(b);let writes=0;
      const storage=createPlayerBuildStorage({getItem:key=>key===PLAYER_BUILD_STORAGE_KEY?raw:null,setItem(){writes++;}});
      const loaded=storage.load();assert.equal(loaded.ok,true);assert.deepEqual(loaded.build,b);
      assert.deepEqual(migratePlayerBuild(b).build,b);assert.deepEqual(createSettingState(loaded).build,b);
      assert.equal(writes,0);assert.equal(inspectBuildForSave(b).canSave,dice.filter(v=>v===0).length<=3);
    }
  });
}
for(const [dice,valid] of [[[1,1,2,2,3,4],true],[[1,1,1,2,3,4],false],[[0,1,1,1,2,3],true],[[0,0,1,1,1,1],false],[[0,0,0,1,2,3],true],[[0,0,0,0,1,2],false],[[0,0,0,0,0,0],false],[[0,0,1,2,3,5],false],[[0,1,2,3,4],false]]) {
  test(`standard validation ${dice}: ${valid}`,()=>{
    const d=duck("custom-speed",dice);assert.equal(inspectBuildForSave(build(d)).canSave,valid);
    assert.equal(compileASkill(d,d.aSelection).ok,valid);
  });
}
test("zero triples and nonzero triples are both charged, actual standard dice determine points",()=>{
  for(const [dice,earned,spent] of [[[0,0,0,1,2,3],3,1],[[0,0,0,2,2,2],3,2],[[0,1,1,1,2,3],1,1],[[1,1,2,2,3,4],0,0]]) {
    const d=duck("custom-speed",dice),r=calculateBuildResources(d).dice;
    assert.deepEqual(r,{emptyCount:earned,tripleCount:spent,earned,spent,remaining:earned-spent});
    assert.equal(calculateASkillResources(d,d.aSelection).dicePoints,earned-spent);
  }
});
for(const [id,dice,points] of [["preset-standard",[1,2,3,4,5,6],0],["preset-void",[0,0,0,0,0,0],4]]) {
  test(`${id}: trusted fixed dice, SP and points; tampering rejected by save and compiler`,()=>{
    const def=getDiceFrame(id),s=changeSetting(state(build()),{type:"dice-type",frame:id}),d=selectedDuck(s);
    assert.equal(def.kind,"preset");assert.equal(def.editable,false);assert.equal(def.SP,id === "preset-void" ? 1 : 2);assert.deepEqual(def.dice,dice);assert.equal(def.dicePoints,points);
    assert.deepEqual(d.dice,dice);assert.equal(d.stats.SP,def.SP);assert.equal(inspectBuildForSave(build(d)).complete,true);
    const rules=createBuildRules();rules.resources.dicePointsPerEmpty=999;rules.resources.dicePointsPerTriple=999;
    assert.equal(calculateBuildResources(d,rules).dice.remaining,points);
    assert.equal(calculateASkillResources(d,d.aSelection).availablePoints,2+points);
    for(let i=0;i<6;i++){const bad=structuredClone(d);bad.dice[i]=dice[i]===0?1:0;
      assert.equal(inspectBuildForSave(build(bad)).canSave,false);assert.equal(compileASkill(bad,bad.aSelection).ok,false);}
    for(const SP of [1,2,3,null].filter(value=>value!==def.SP)) {const bad=structuredClone(d);bad.stats.SP=SP;assert.equal(inspectBuildForSave(build(bad)).complete,false);assert.equal(compileASkill(bad,bad.aSelection).ok,false);}
    const injected={...d,dicePoints:100};assert.equal(inspectBuildForSave(build(injected)).canSave,false);
    assert.equal(calculateBuildResources(injected).dice.remaining,points);
  });
  test(`${id}: preset compiles to existing battle SP/dice DTO and runs`,()=>{
    const b=build(duck(id));const r=compileBattleLoadout(b,{duckId:"test-duck",battlerId:"p1",battlerName:"P1"});assert.equal(r.ok,true,JSON.stringify(r));
    assert.deepEqual(r.duck.dice,dice);assert.equal(r.duck.stats.SP,getDiceFrame(id).SP);assert.equal("diceFrame" in r.duck,false);
    const opponent=compileBattleLoadout(build(duck("preset-standard")),{duckId:"test-duck",battlerId:"p2",battlerName:"P2"});
    const result=runBattle({p1:{battlerId:"p1",duckId:"d1"},p2:{battlerId:"p2",duckId:"d2"},data:{BATTLERS:[r.battler,opponent.battler],DUCKS:[{...r.duck,id:"d1"},{...opponent.duck,id:"d2"}]},maxTurns:1,rng:()=>0,field:"test-no-field"});assert.ok(result.events.length);
  });
}
test("A candidates and prices use current six slots for exact/range/all and ignore D",()=>{
  for(const d of [duck("preset-standard"),duck("preset-void"),duck("custom-speed",[2,2,2,3,4,0])]) {
    const options=getATriggerOptions(d);
    for(const t of options){const count=d.dice.filter(v=>matchesATrigger(t,v)).length;
      assert.equal(t.frequencyCount,count);assert.equal(t.pointCost,Math.ceil(count/2)-1);
      const r=calculateASkillResources(d,{triggerId:t.id,effects:[leaf]});assert.equal(r.complete,true);assert.equal(r.triggerCost,t.pointCost);assert.equal(r.frequencyCount,count);}
    const extra={...d};for(const key of ["dSelection","dSkill","dicePool","battler"])Object.defineProperty(extra,key,{get(){throw Error(key);}});
    assert.deepEqual(getATriggerOptions(extra),options);assert.deepEqual(calculateBuildResources(extra),calculateBuildResources(d));
  }
  const normal=getATriggerOptions(duck("preset-standard"));assert.deepEqual(normal.filter(t=>t.kind==="exact").map(t=>t.value),[1,2,3,4,5,6]);
  assert.equal(normal.find(t=>t.id==="lte:3").pointCost,1);assert.equal(normal.find(t=>t.id==="lte:5").pointCost,2);
  const duplicate=getATriggerOptions(duck("custom-speed",[2,2,2,3,4,0]));assert.equal(duplicate.find(t=>t.id==="exact:2").pointCost,1);
  const zero=getATriggerOptions(duck("custom-speed",[0,0,0,1,2,3]));assert.equal(zero.find(t=>t.id==="exact:0").pointCost,1);
  assert.deepEqual(getATriggerOptions(duck("preset-void")).map(t=>[t.id,t.pointCost]),[["exact:0",2],["all",2]]);
});
test("unsaved dice edits immediately update A frequency/cost/points without replacing trigger",()=>{
  const d=duck("custom-speed",[0,1,2,2,3,4]);d.aSelection.triggerId="exact:2";
  let s=state(build(d));let r=calculateASkillResources(selectedDuck(s),d.aSelection);assert.equal(r.triggerCost,0);assert.equal(r.dicePoints,1);
  s=changeSetting(s,{type:"duck",patch:{dice:[0,2,2,2,3,4]}});r=calculateASkillResources(selectedDuck(s),d.aSelection);assert.equal(r.triggerCost,1);assert.equal(r.frequencyCount,3);assert.equal(r.dicePoints,0);
  s=changeSetting(s,{type:"dice-type",frame:"preset-void"});assert.deepEqual(selectedDuck(s).aSelection,d.aSelection);assert.equal(compileASkill(selectedDuck(s),d.aSelection).ok,false);
});

test("exactly five new dice IDs and names; void SP1",()=>{
 assert.deepEqual(Object.values(DICE_FRAMES).map(f=>[f.id,f.label,f.SP]),[
 ["custom-speed","スピード",3],["custom-normal","ノーマル",2],["custom-heavy","ヘビー",1],["preset-standard","スタンダード",2],["preset-void","ヴォイド",1]]);
});
test("old dice IDs remain invalid and unchanged by loading/migration",()=>{
 for(const id of ["light","basic","heavy","normal","void"]) {
  assert.equal(getDiceFrame(id),undefined);
  const b=build();b.ducks[0].diceFrame=id;const before=structuredClone(b);
  assert.equal(selectedDuck(state(b)).diceFrame,id);assert.equal(inspectBuildForSave(b).canSave,false);
  assert.equal(compileBattleLoadout(b,{duckId:"test-duck"}).ok,false);
  assert.equal(migratePlayerBuild(b).build.ducks[0].diceFrame,id);assert.deepEqual(b,before);
  assert.throws(()=>changeSetting(state(b),{type:"dice-type",frame:id}),/Unknown dice frame/);
 }
});
