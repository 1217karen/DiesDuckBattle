import test from "node:test";
import assert from "node:assert/strict";
import { compileASkill } from "../js/aSkillCompiler.js";
import { createADevCatalog } from "../js/aSkillDevFixtures.js";
import { applyEffect } from "../js/effects.js";
import { runBattle } from "../js/battleEngine.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";
import { runASkillTestBattle } from "../js/aSkillTestHarness.js";

const catalog=createADevCatalog();
const choose=(effectId,value,chanceOptionId)=>({effectId,...(value==null?{}:{amountOptionId:`dev-${value}`}),...(chanceOptionId?{chanceOptionId}:{})});
function compiled(effects,triggerId="all",diceFrame="light") {
  const r=compileASkill({diceFrame,dice:[0,0,0,0,0,0]},{triggerId,effects},{catalog});
  assert.ok(r.ok,JSON.stringify(r)); return {id:"A_TEST",...r.skill};
}
const change=(key,value,op="set")=>({type:"changeValue",target:"self",key,op,value});
const status=(status,value=1)=>({type:"changeStatus",target:"self",status,op:"set",value});
const emptyStatus=()=>Object.fromEntries(STATUS_GROUPS.all.map(key=>[key,0]));
function battle({aSkill,dice=1,setup=[],enemySetup=[],bSkills=[],sp=1,rng=()=>.9,maxTurns=1}={}) {
  return runBattle({p1:{battlerId:"b1",duckId:"d1"},p2:{battlerId:"b2",duckId:"d2"},
    data:{BATTLERS:[{id:"b1",bSkills,dSkill:{id:"D1",effect:setup}},{id:"b2",dSkill:{id:"D2",effect:enemySetup}}],
      DUCKS:[{id:"d1",aSkill,stats:{AT:5,DF:3,SP:sp,maxHP:1000},dice:Array.isArray(dice)?dice:[dice]},
        {id:"d2",stats:{AT:3,DF:3,SP:1,maxHP:1000},dice:[0]}]},field:"test-no-field",maxTurns,rng});
}
const phase=r=>{ const n=r.events.find(e=>e.type==="roll"&&e.actor==="P1").phase; return r.events.filter(e=>e.phase===n); };
const normals=events=>events.filter(e=>e.type==="normalDamage"&&e.actor==="P1");
const aEvents=r=>r.events.filter(e=>e.type==="skillTriggered"&&e.skill?.skillId==="A_TEST");

for(const [trigger,face,expected] of [["lte:3",0,false],["gte:3",0,false],["all",0,true],["exact:0",0,true],["lte:3",2,true],["gte:3",5,true]]) {
  test(`canonical ${trigger} / ${face} 発動=${expected}`,()=>{
    const r=battle({aSkill:compiled([choose("damage-enemy",5)],trigger),dice:face});
    assert.equal(aEvents(r).length>0,expected);
  });
}
test("Dでlightへ5を追加してもgte:3は成立、legacy lteは0に従来どおり一致",()=>{
  const r=battle({aSkill:compiled([choose("damage-enemy",5)],"gte:3"),dice:[0,0,0,0,0,0],setup:[{type:"addDice",target:"self",values:[5]}],rng:()=>.99});
  assert.equal(r.events.find(e=>e.type==="roll"&&e.actor==="P1").diceValue,5);
  assert.ok(aEvents(r).length);
  assert.ok(aEvents(battle({dice:0,aSkill:{id:"A_TEST",trigger:"onDice<=3",effect:change("ap",1,"add")}})).length);
});
test("compiler出力はbeforeDiceResolve、Headwindキャンセルを維持",()=>{
  const aSkill=compiled([choose("damage-enemy",5)]);
  assert.equal(aEvents(battle({aSkill}))[0].trigger,"beforeDiceResolve");
  const canceled=battle({aSkill,setup:[status("Headwind",3)],rng:()=>0});
  assert.equal(aEvents(canceled).length,0);
});
test("全公開effectがcompilerからtrusted engineへ到達（unsupportedなし）",()=>{
  for(const definition of catalog.effects) {
    const face=definition.exactFace??1, frame=face>4?"heavy":"light";
    const amount=definition.requiresAmount?definition.amountOptions[0].value:undefined;
    const aSkill=compiled([choose(definition.id,amount)],definition.exactFace?`exact:${face}`:"all",frame);
    const r=battle({aSkill,dice:face,setup:[change("hp",900),change("ap",5)],enemySetup:[change("hp",900),change("ap",5)]});
    assert.ok(aEvents(r).length,definition.id);
    assert.equal(r.events.some(e=>String(e.code).includes("UNSUPPORTED")),false,definition.id);
  }
});
test("順序は実動作でも保持、重複effectは独立chance抽選",()=>{
  const heal=choose("heal-self",10),hurt=choose("damage-self",5);
  const first=phase(battle({aSkill:compiled([heal,hurt])})).filter(e=>e.originSkill?.skillId==="A_TEST");
  const second=phase(battle({aSkill:compiled([hurt,heal])})).filter(e=>e.originSkill?.skillId==="A_TEST");
  assert.notDeepEqual(first.map(e=>e.hpAfter),second.map(e=>e.hpAfter));
  const skill=compiled([choose("grant-random-debuff-enemy",2,"50"),choose("grant-random-debuff-enemy",2,"50")]);
  const values=[.9,.1,.75]; let calls=0;
  const ctx={actor:{side:"P1",status:emptyStatus()},enemy:{side:"P2",status:emptyStatus()},rng:()=>{calls++;return values.shift();},push:()=>{},helpers:{}};
  applyEffect(skill.effect,ctx);
  assert.equal(calls,3); // 失敗chance、成功chance、成功時だけstatus乱数
  assert.equal(Object.values(ctx.enemy.status).reduce((a,b)=>a+b,0),2);
});
test("random buff/debuffは各group内、status解除は1stackかつ0 clamp",()=>{
  for(const group of ["buff","debuff"]) {
    const target=group==="buff"?"self":"enemy";
    const skill=compiled([choose(`grant-random-${group}-${target}`,2)]);
    const actor={side:"P1",status:emptyStatus()},enemy={side:"P2",status:emptyStatus()};
    applyEffect(skill.effect,{actor,enemy,rng:()=>.9,push:()=>{},helpers:{}});
    const statuses=target==="self"?actor.status:enemy.status;
    const changed=Object.keys(statuses).filter(key=>statuses[key]!==0);
    assert.equal(changed.length,1); assert.ok(STATUS_GROUPS[group].includes(changed[0]));
  }
  for(const target of ["self","enemy"]) for(const key of STATUS_GROUPS.all) for(const start of [0,2]) {
    const actor={side:"P1",status:{[key]:start}},enemy={side:"P2",status:{[key]:start}};
    applyEffect(compiled([choose(`remove-${key}-${target}`)]).effect,{actor,enemy,rng:()=>.9,push:()=>{},helpers:{}});
    assert.equal((target==="self"?actor:enemy).status[key],Math.max(0,start-1));
  }
});
for(const [id,delta] of [["phase-at-self-increase",1],["phase-at-self-decrease",-1],["phase-df-enemy-increase",-1],["phase-df-enemy-decrease",1]]) {
  test(`${id}は現在phaseだけ通常ダメージへ反映`,()=>{
    const base=normals(phase(battle()))[0].value;
    const r=battle({aSkill:compiled([choose(id,1)],"exact:1")});
    assert.equal(normals(phase(r))[0].value,base+delta);
    assert.ok(r.events.some(e=>e.type==="buffExpired"));
  });
}
test("通常攻撃 +N は汎用、dice2減少、dice6反動軽減",()=>{
  for(const dice of [0,1,2,3,4,5,6]) {
    const r=battle({aSkill:compiled([choose("increase-attacks",2)]),dice});
    assert.equal(normals(phase(r)).length,(dice===2?2:1)+2);
  }
  assert.equal(normals(phase(battle({dice:2,aSkill:compiled([choose("reduce-dice2-attacks")],"exact:2")}))).length,1);
  const r=battle({dice:6,aSkill:compiled([choose("reduce-dice6-recoil",2)],"exact:6","heavy")});
  assert.equal(phase(r).find(e=>e.source==="dice6").value,1);
});
test("追加反動はphaseにつき一度、dice6と独立、通常攻撃終了後",()=>{
  const r=battle({dice:2,aSkill:compiled([choose("additional-recoil",3),choose("increase-attacks",2)])});
  const events=phase(r),recoil=events.filter(e=>e.source==="aAdditionalRecoil");
  assert.equal(normals(events).length,4); assert.equal(recoil.length,1); assert.equal(recoil[0].value,3);
  assert.ok(events.indexOf(recoil[0])>events.indexOf(normals(events).at(-1)));
  const six=phase(battle({dice:6,aSkill:compiled([choose("additional-recoil",2),choose("reduce-dice6-recoil",3)],"exact:6","heavy")}));
  assert.equal(six.find(e=>e.source==="dice6").value,0); assert.equal(six.find(e=>e.source==="aAdditionalRecoil").value,2);
});
test("キャンセル/効果MISS/湯気MISSでは追加反動なし、回避は旧反動同様に成立",()=>{
  const additional=choose("additional-recoil",2);
  for(const mode of ["cancel","miss","steam","avoid"]) {
    const r=battle({aSkill:compiled([additional,...(mode==="cancel"?[choose("cancel-self-attack")]:[])]),
      bSkills:mode==="miss"?[{id:"miss",trigger:"beforeAttack",effect:{type:"changeAttack",op:"miss"}}]:[],
      setup:mode==="steam"?[status("steam",3)]:[],enemySetup:mode==="avoid"?[status("tailwind",1)]:[],rng:()=>0});
    assert.equal(phase(r).some(e=>e.source==="aAdditionalRecoil"),mode==="avoid",mode);
  }
});
test("連続行動命中率MISSでは新追加反動なし、旧dice6反動は維持",()=>{
  const r=battle({dice:6,sp:2,rng:()=>0,aSkill:compiled([choose("additional-recoil",2)])});
  const misses=r.events.filter(e=>e.code==="ATTACK_MISSED_BY_MULTI_ACTION_ACCURACY"); assert.ok(misses.length);
  for(const miss of misses) {
    const events=r.events.filter(e=>e.phase===miss.phase);
    assert.equal(events.some(e=>e.source==="aAdditionalRecoil"),false);
    assert.equal(events.some(e=>e.source==="dice6"),true);
  }
});
for(const [face,id] of [[1,"cancel-dice1-ap"],[3,"cancel-dice3-heal"],[4,"cancel-dice4-counter"],[5,"cancel-dice5-ap"]]) {
  test(`dice${face}固有効果skip、通常攻撃は維持、逆効果で相殺しない`,()=>{
    const setup=[change("hp",900),change("ap",5)],enemySetup=[change("ap",5)];
    assert.ok(phase(battle({dice:face,setup,enemySetup})).some(e=>e.source===`dice${face}`));
    const r=battle({dice:face,setup,enemySetup,aSkill:compiled([choose(id)],`exact:${face}`,face>4?"heavy":"light")});
    assert.equal(phase(r).some(e=>e.source===`dice${face}`),false);
    assert.equal(normals(phase(r)).length,1);
    assert.equal(phase(r).filter(e=>e.originSkill?.skillId==="A_TEST"&&e.type==="valueChanged").some(e=>["ap","hp"].includes(e.key)),false);
  });
}
test("skip/追加反動は次phaseへ漏れない",()=>{
  const aSkill=compiled([choose("cancel-dice1-ap"),choose("additional-recoil",2)],"exact:1");
  const r=battle({aSkill,dice:1,maxTurns:2,rng:()=>0,bSkills:[{id:"cancel-second-a",trigger:"turnStart",when:{left:"turn",op:"==",right:2},effect:status("Headwind",3)}]});
  assert.equal(r.events.filter(e=>e.source==="aAdditionalRecoil").length,1);
  assert.deepEqual(r.events.filter(e=>e.source==="dice1"&&e.actor==="P1").map(e=>e.turn),[2]);
  assert.equal(aEvents(r).length,1);
});
test("開発harness: DTO→resources→compiler→P1 duck A→battle logs",()=>{
  const result=runASkillTestBattle({diceFrame:"light",dice:[0,0,0,0,0,0]},
    {triggerId:"exact:0",effects:[choose("damage-enemy",5)]},{catalog,rng:()=>.9});
  assert.ok(result.compilation.ok); assert.ok(result.battle.events.some(e=>e.originSkill?.skillId==="A_DEV"));
});
