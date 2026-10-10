import test from "node:test";
import assert from "node:assert/strict";
import { runBattle } from "../js/battleEngine.js";

const set = (key, value) => ({type:"changeValue",target:"self",key,op:"set",value});
const turn1 = {left:"turn",op:"==",right:1};
const buff = (stat="AT", target="self") => ({type:"addBuff",stat,target,amount:2,duration:{kind:"turns",count:2}});
const aura = () => ({type:"addTimedHitRule",duration:{kind:"turns",count:2},effect:{type:"changeStatus",target:"self",status:"clean",op:"add",value:1}});
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function battle(mode, effects, { maxTurns=3, legacy=false, enemySkills=[] }={}) {
  const cs = freeze({id:"C_DURATION", ...(legacy ? {trigger:mode === "special" ? "beforeTurnEnd" : "beforeRoll"} : {mode}), costAP:10,
    effect:[{type:"revive",target:"self",maxHpPct:1}, ...effects]});
  const saved = JSON.stringify(cs);
  const result = runBattle({p1:{battlerId:"b1",duckId:"d1"},p2:{battlerId:"b2",duckId:"d2"},
    data:{BATTLERS:[{id:"b1",bSkills:[
      {id:"fund",trigger:"turnStart",when:turn1,effect:set("ap",10)},
      ...(mode === "special" ? [{id:"die",trigger:"phaseEnd",when:turn1,effect:set("hp",0)}] : []),
    ]},{id:"b2",bSkills:enemySkills}],DUCKS:[
      {id:"d1",cSkill:cs,stats:{AT:0,DF:0,SP:1,maxHP:1000},dice:[0]},
      {id:"d2",stats:{AT:0,DF:0,SP:1,maxHP:1000},dice:[0]},
    ]},maxTurns,field:"test-no-field",rng:()=>0});
  assert.equal(JSON.stringify(cs),saved);
  assert.equal(result.events.filter(e=>e.type === "cSkillActivated").length,1);
  return result.events;
}
for (const mode of ["normal","special"]) {
  for (const stat of ["AT","DF"]) for (const target of ["self","enemy"]) test(`${mode} ${stat}/${target}: configured 2T lasts two usable turns`,()=>{
    const events=battle(mode,[buff(stat,target)]);
    const applied=events.find(e=>e.type === "buffApplied");
    assert.equal(applied.duration.remainingTurns,mode === "special" ? 3 : 2);
    assert.equal(applied.turns,mode === "special" ? 3 : 2);
    const ticks=events.filter(e=>e.type === "buffTick");
    assert.deepEqual(ticks.map(e=>[e.turn,e.before,e.after]),mode === "special" ? [[1,3,2],[2,2,1],[3,1,0]] : [[1,2,1],[2,1,0]]);
    const firstUsableTurn=mode === "special" ? 2 : 1;
    const precedingTicks=ticks.filter(e=>e.turn < firstUsableTurn);
    assert.equal(precedingTicks.at(-1)?.after ?? applied.duration.remainingTurns,2);
    assert.equal(events.find(e=>e.type === "buffExpired").turn,firstUsableTurn+1);
  });
  test(`${mode} timed hit rule: configured 2T covers two attack turns`,()=>{
    const events=battle(mode,[aura()]);
    assert.equal(events.find(e=>e.type === "timedRuleApplied").duration.remainingTurns,mode === "special" ? 3 : 2);
    assert.deepEqual(events.filter(e=>e.type === "timedRuleTriggered").map(e=>e.turn),mode === "special" ? [2,3] : [1,2]);
    assert.deepEqual(events.filter(e=>e.type === "timedRuleTick").map(e=>[e.before,e.after]),mode === "special" ? [[3,2],[2,1],[1,0]] : [[2,1],[1,0]]);
  });
}
for (const wrapper of [
  e=>({type:"conditional",when:turn1,met:[e],unmet:[]}),
  e=>({type:"conditional",when:{left:"turn",op:"==",right:99},met:[],unmet:[e]}),
  e=>({type:"randomPick",picks:[[e]]}),
  e=>({type:"heal",amount:1,chance:0,onFail:[e]}),
  e=>({...e,repeat:2}),
]) test("special nested effects receive exactly one extra turn: "+wrapper.toString(),()=>{
  const events=battle("special",[wrapper(buff()),wrapper(aura())]);
  const applied=events.filter(e=>["buffApplied","timedRuleApplied"].includes(e.type));
  assert.ok(applied.length>=2);
  assert.ok(applied.every(e=>e.duration.remainingTurns === 3));
});
for (const effect of [{type:"addBuff",stat:"AT",amount:2,turns:2}, {type:"addBuff",stat:"DF",amount:2}]) {
  test("special legacy buff duration and default are adjusted without mutation "+effect.stat,()=>{
    const events=battle("special",[effect],{legacy:true});
    assert.equal(events.find(e=>e.type === "buffApplied").duration.remainingTurns,(effect.turns ?? 1)+1);
  });
}
test("special leaves phase and immediate effects unchanged, and does not extend B buffs",()=>{
  const phase={...buff(),duration:{kind:"phase"}};
  const events=battle("special",[phase,{type:"fixedDamage",target:"enemy",amount:7},
    {type:"heal",target:"enemy",amount:3},{type:"changeStatus",target:"self",status:"clean",op:"add",value:2}],
    {enemySkills:[{id:"B_TURN",trigger:"beforeTurnEnd",when:turn1,effect:buff("DF")}]});
  const groupId=events.find(e=>e.type === "cSkillActivated").groupId;
  const effects=events.filter(e=>e.groupId === groupId);
  assert.deepEqual(effects.find(e=>e.type === "buffApplied").duration,{kind:"phase"});
  assert.equal(effects.find(e=>e.type === "fixedDamage").value,7);
  assert.equal(effects.find(e=>e.type === "heal").value,3);
  assert.equal(effects.find(e=>e.type === "statusChange").after,2);
  assert.equal(effects.find(e=>e.type === "revived").hpAfter,1000);
  assert.equal(events.find(e=>e.type === "buffApplied" && e.stat === "DF").duration.remainingTurns,2);
  const activation=events.find(e=>e.type === "cSkillActivated");
  assert.equal(activation.apBefore-activation.apAfter,10);
});
