import test from "node:test";
import assert from "node:assert/strict";
import { calcMaxHPFromStats, HP_FORMULA } from "../js/statsUtil.js";
import { runBattle } from "../js/battleEngine.js";
import { compileCSkill } from "../js/cSkillCompiler.js";

test("MHP uses base 150 with unchanged coefficients, truncation and bounds",()=>{
 assert.deepEqual(HP_FORMULA,{base:150,AT:25,DF:30,SP:-10,min:1,max:999});
 for(const [stats,expected] of [[{},150],[{AT:3,DF:3,SP:2},295],[{AT:1,DF:0,SP:0},175],[{AT:0,DF:1,SP:0},180],[{AT:0,DF:0,SP:1},140],[{AT:.5},162],[{SP:100},1],[{AT:100},999]]) assert.equal(calcMaxHPFromStats(stats),expected);
});
function battle(cSelection, setup=[], maxHP) {
 const result=compileCSkill(cSelection);assert.equal(result.ok,true);
 return runBattle({p1:{battlerId:"b1",duckId:"d1"},p2:{battlerId:"b2",duckId:"d2"},field:"test-no-field",maxTurns:1,rng:()=>.9,
  data:{BATTLERS:[{id:"b1",bSkills:[],dSkill:{effect:[{type:"changeValue",target:"self",key:"ap",op:"set",value:30},...setup]}},{id:"b2",bSkills:[]}],
   DUCKS:[{id:"d1",stats:{AT:3,DF:3,SP:2,...(maxHP?{maxHP}:{})},dice:[0],cSkill:{id:"C",...result.skill}},{id:"d2",stats:{AT:3,DF:3,SP:2},dice:[0]}]}});
}
test("battle initializes computed HP, healing caps there and explicit HP overrides stay supported",()=>{
 const c={mode:"normal",structure:{kind:"flat",effects:[{effectId:"heal-self",options:{amount:"healAmount-50"}}]}};
 for(const [override,expected] of [[undefined,295],[1000,1000]]) {
  const r=battle(c,[{type:"changeValue",target:"self",key:"hp",op:"add",value:-10}],override);
  assert.equal(r.events.find(e=>e.type==="battleStart").meta.P1.maxHP,expected);
  assert.equal(r.events.find(e=>e.type==="heal").hpAfter,expected);
 }
});
test("compiled special C revives from negative HP using the new computed maximum",()=>{
 const c={mode:"special",structure:{kind:"flat",effects:[{effectId:"revive-self",options:{maxHpPct:"revivePct-0.25"}}]}};
 const r=battle(c,[{type:"changeValue",target:"self",key:"hp",op:"set",value:-100}]);
 assert.equal(r.events.find(e=>e.type==="revived").hpAfter,73);
 assert.equal(r.events.some(e=>e.type==="heal"),false);
});
