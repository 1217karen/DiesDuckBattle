import { calculateASkillResources } from "../js/aSkillResources.js";
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

test("both preset lists expose the same four systems; support is now heal",()=>{
  const expected=[["attack","アタック"],["defense","ディフェンス"],["heal","ヒール"],["technical","テクニカル"]];
  for(const presets of [BATTLER_PRESETS,DUCK_PRESETS]) assert.deepEqual(presets.map(p=>[p.id,p.label]),expected);
  assert.equal(BATTLER_PRESETS.length*DUCK_PRESETS.length,16);
  assert.throws(()=>battlerPresetPatch("support"),RangeError);
});
const requestedDuckInputs={
  attack:{stats:{AT:5,DF:3,SP:1},diceFrame:"custom-heavy",dice:[3,4,4,5,6,6],trigger:{kind:"gte",value:5},effect:{type:"changeValue",target:"self",key:"nextAttackATPlus",op:"add",value:2}},
  defense:{stats:{AT:2,DF:5,SP:2},diceFrame:"custom-normal",dice:[0,3,3,4,4,5],trigger:{kind:"lte",value:4},effect:{type:"changeStatus",target:"self",status:"tailwind",op:"add",value:2}},
  heal:{stats:{AT:2,DF:4,SP:3},diceFrame:"custom-speed",dice:[2,3,3,3,0,0],trigger:{kind:"exact",value:3},effect:{type:"changeStatus",target:"self",status:"clean",op:"add",value:2}},
  technical:{stats:{AT:2,DF:5,SP:2},diceFrame:"custom-normal",dice:[2,2,2,5,0,0],trigger:{kind:"exact",value:2},effect:{type:"changeStatus",target:"enemy",status:"@debuff",op:"add",value:2}},
};
for(const p of DUCK_PRESETS) test(`${p.id} exact dice/stats/A and individual A resource budget`,()=>{
  const expected=requestedDuckInputs[p.id];
  assert.deepEqual(p.stats,expected.stats);assert.equal(p.diceFrame,expected.diceFrame);assert.deepEqual(p.dice,expected.dice);
  const a=compileASkill(p,p.aSelection);assert.equal(a.ok,true);assert.deepEqual(a.skill,{trigger:expected.trigger,effect:[expected.effect]});
  const resources=calculateASkillResources(p,p.aSelection);
  assert.equal(resources.basePoints,2);assert.equal(resources.dicePoints,p.id === "attack" ? 0 : 1);assert.equal(resources.remaining,0);assert.equal(resources.ready,true);assert.deepEqual(resources.errors,[]);assert.ok(resources.netCost<=resources.availablePoints);
});
const focusAura={type:"addTimedHitRule",target:"self",duration:{kind:"turns",count:3},effect:{type:"changeStatus",target:"self",status:"focus",op:"add",value:1}};
const expectedCEffects={
  attack:[{type:"fixedDamage",target:"enemy",amount:50},{type:"addBuff",target:"self",stat:"AT",amount:3,duration:{kind:"turns",count:2}}],
  defense:[{type:"revive",target:"self",maxHpPct:.1},{type:"fixedDamage",target:"enemy",amount:30,turnStep:{every:5,add:10}}],
  heal:[{type:"heal",target:"self",amount:30},focusAura],
  technical:[{type:"randomPick",picks:[
    [{type:"changeStatus",target:"enemy",status:"@debuff",op:"add",value:3},{type:"fixedDamage",target:"enemy",byStatusCount:{n:15,statuses:["crack","Headwind","roughWave","steam"]}}],
    [{type:"fixedDamage",target:"enemy",amountPct:0.25},{type:"addBuff",target:"enemy",stat:"DF",amount:-3,duration:{kind:"turns",count:3}}],
  ]}],
};
for(const p of DUCK_PRESETS) test(`${p.id} C compiles requested effects in order`,()=>{
  const c=compileCSkill(p.cSelection);assert.equal(c.ok,true);assert.equal(c.skill.mode,p.id === "defense" ? "special" : "normal");
  assert.deepEqual(c.skill.effect,expectedCEffects[p.id]);
  if(p.id === "technical") {assert.equal(p.cSelection.structure.kind,"random");assert.equal(p.cSelection.structure.branches.length,2);assert.equal(c.skill.effect[0].picks.length,2);}
});
test("battler B/D match attack, defense, heal and technical requests",()=>{
  const compiled=Object.fromEntries(BATTLER_PRESETS.map(p=>[p.id,compileBSkill(p.bSelection).bSkills[0]]));
  assert.deepEqual(compiled.attack.modifier,{kind:"conditional",when:{left:"self.hpPct",op:">=",right:.5},bonus:{AT:4}});
  assert.equal(compiled.defense.trigger,"afterTakeDamage");assert.deepEqual(compiled.defense.effect,{type:"changeStatus",target:"self",status:"counter",op:"add",value:1});
  assert.equal(compiled.heal.trigger,"afterHeal");assert.deepEqual(compiled.heal.effect,{type:"heal",target:"healTarget",amount:5,source:"afterHealBonus"});
  assert.equal(compiled.technical.trigger,"phaseStart");assert.equal(compiled.technical.when,null);
  assert.deepEqual(compiled.technical.effect,{type:"changeStatus",target:"self",status:"@buff",op:"add",value:1,chance:.5});
  assert.deepEqual(BATTLER_PRESETS.map(p=>p.dSelection.optionId),["add-self-6","add-self-4","add-self-3","add-self-2"]);
});

test("duck preset descriptions use the requested UI copy",()=>{
  assert.deepEqual(DUCK_PRESETS.map(p=>p.description),[
    "出目5以上で次の通常攻撃ATを+2。Ｃスキルで固定ダメージとターン制のATバフを得るヘビー型です。",
    "出目4以下で追風を2付与。特殊発動のＣスキルで復活し、経過ターンに応じた固定ダメージを返します。",
    "出目3で清潔を2付与。Ｃスキルで自身のHPを回復し、命中時の集中オーラで攻撃も補います。",
    "出目2でランダムな状態異常を2付与。Ｃスキルは状態異常と状態数ダメージ、または相手HPの割合攻撃とDF低下の2分岐です。",
  ]);
});
