import test from "node:test";
import assert from "node:assert/strict";
import { BATTLER_PRESETS, DUCK_PRESETS, battlerPresetPatch, duckPresetPatch, hasBattlerPresetSettings, hasDuckPresetSettings } from "../js/battlePresets.js";
import { createEmptyPlayerBuild, createEmptyDuck } from "../js/playerBuildModel.js";
import { createSettingState, changeSetting, selectedDuck } from "../js/settingState.js";
import { compileBSkill } from "../js/bSkillCompiler.js";
import { compileDSkill } from "../js/dSkillCompiler.js";
import { compileASkill } from "../js/aSkillCompiler.js";
import { compileCSkill } from "../js/cSkillCompiler.js";
import { inspectBattleLoadout, compileBattleLoadout } from "../js/battleLoadoutCompiler.js";
import { inspectBuildForSave } from "../js/buildSaveInspection.js";
import { calculateBuildResources } from "../js/buildResources.js";

function initial() {
  const build=createEmptyPlayerBuild();
  Object.assign(build.battler,battlerPresetPatch("attack"));
  build.battler.skillLabels={B:{name:"B名",ruby:"びー"},D:{name:"D名",ruby:"でぃー"}};
  build.ducks=["one","two"].map(id=>({...createEmptyDuck({idFactory:()=>id}),name:id,
    ...duckPresetPatch("attack"),skillLabels:{A:{name:"A名",ruby:"えー"},C:{name:"C名",ruby:"しー"}}}));
  return createSettingState({ok:true,status:"loaded",build},{ok:true,status:"loaded",settings:{schemaVersion:1,publicDuckId:"two"}});
}
for(const preset of BATTLER_PRESETS) test(`battler ${preset.id} changes only B/D atomically`,()=>{
  const before=initial(), snapshot=structuredClone(before);
  const next=changeSetting(before,{type:"battler-preset",presetId:preset.id});
  assert.deepEqual(next,{...before,dirty:true,build:{...before.build,battler:{...before.build.battler,...battlerPresetPatch(preset.id)}}});
  assert.deepEqual(before,snapshot);
  assert.equal(next.selectedDuckId,"one");assert.equal(next.publicSettings.publicDuckId,"two");
});
for(const preset of DUCK_PRESETS) test(`duck ${preset.id} preserves identity, labels, public choice and other duck`,()=>{
  const before=initial(), snapshot=structuredClone(before);
  const next=changeSetting(before,{type:"duck-preset",presetId:preset.id,duckId:"one"});
  assert.deepEqual(next,{...before,dirty:true,build:{...before.build,ducks:[{...before.build.ducks[0],...duckPresetPatch(preset.id)},before.build.ducks[1]]}});
  assert.deepEqual(before,snapshot);
  const edited=changeSetting(next,{type:"duck",patch:{stats:{...selectedDuck(next).stats,AT:1}}});
  assert.equal(selectedDuck(edited).stats.AT,1);
  assert.equal(selectedDuck(next).stats.AT,preset.stats.AT);
});
for(const b of BATTLER_PRESETS) for(const d of DUCK_PRESETS) test(`production-valid complete sample ${b.id}/${d.id}`,()=>{
  let state=initial();state=changeSetting(state,{type:"battler-preset",presetId:b.id});
  state=changeSetting(state,{type:"duck-preset",presetId:d.id,duckId:"one"});
  const duck=selectedDuck(state);
  for(const result of [compileBSkill(state.build.battler.bSelection),compileDSkill(state.build.battler.dSelection),compileASkill(duck,duck.aSelection),compileCSkill(duck.cSelection)]) assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(inspectBattleLoadout(state.build,duck.id).ready,true);
  assert.equal(inspectBuildForSave(state.build).complete,true);
  const resources=calculateBuildResources(duck);assert.ok(resources.stats.remaining>=0);assert.ok(resources.dice.remaining>=0);
  assert.equal(compileBattleLoadout(state.build,{duckId:duck.id,battlerId:"sample",battlerName:"サンプル"}).ok,true);
});
test("deeply frozen presets and detached patches survive editing",()=>{
  const before=JSON.stringify([BATTLER_PRESETS,DUCK_PRESETS]);
  for(const p of DUCK_PRESETS){const patch=duckPresetPatch(p.id);patch.stats.AT=1;patch.dice[0]=6;patch.aSelection.effects[0].options.amount="changed";patch.cSelection.structure.effects=[];}
  for(const p of BATTLER_PRESETS){const patch=battlerPresetPatch(p.id);patch.bSelection.options.changed=true;patch.dSelection.optionId="changed";}
  assert.equal(JSON.stringify([BATTLER_PRESETS,DUCK_PRESETS]),before);
  assert.ok(Object.isFrozen(DUCK_PRESETS[0].aSelection.effects[0].options));
  assert.ok(Object.isFrozen(BATTLER_PRESETS[0].bSelection.options));
});
test("invalid preset and stale/missing duck never produce partial edits",()=>{
  const state=initial(), before=structuredClone(state);
  for(const action of [{type:"battler-preset",presetId:"unknown"},{type:"duck-preset",presetId:"unknown",duckId:"one"},{type:"duck-preset",presetId:"attack",duckId:"two"}]) assert.throws(()=>changeSetting(state,action),RangeError);
  assert.deepEqual(state,before);
  assert.throws(()=>changeSetting({...state,selectedDuckId:null},{type:"duck-preset",presetId:"attack",duckId:null}),RangeError);
});
test("confirmation checks only the replaced scope, including partial settings",()=>{
  const duck=createEmptyDuck({idFactory:()=>"blank"});duck.name="名前あり";duck.skillLabels.A.name="スキル名あり";
  assert.equal(hasDuckPresetSettings(duck),false);
  for(const patch of [{stats:{AT:1,DF:null,SP:null}},{dice:[0,0,0,0,0,1]},{diceFrame:"custom-speed"},{aSelection:{}},{cSelection:{}}]) assert.equal(hasDuckPresetSettings({...duck,...patch}),true);
  assert.equal(hasBattlerPresetSettings(createEmptyPlayerBuild().battler),false);
  assert.equal(hasBattlerPresetSettings({...createEmptyPlayerBuild().battler,bSelection:{}}),true);
  assert.equal(hasBattlerPresetSettings({...createEmptyPlayerBuild().battler,dSelection:{}}),true);
});
