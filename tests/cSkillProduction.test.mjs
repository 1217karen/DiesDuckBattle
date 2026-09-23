import test from 'node:test';
import assert from 'node:assert/strict';
import { createCSkillCatalog } from '../js/cSkillCatalog.js';
import { createCSkillRules } from '../js/cSkillRules.js';
import { compileCSkill } from '../js/cSkillCompiler.js';
import { applyEffect } from '../js/effects.js';
import { runCSkillTestBattle, C_TEST_FIELDS } from '../js/cSkillTestHarness.js';
const catalog = createCSkillCatalog();
function row(id, values = {}, chance) {
  const d = catalog.effects.find(e => e.id === id);
  return { effectId: id, options: Object.fromEntries(Object.entries(d.optionAxes).map(([axis, set]) =>
    [axis, (Object.hasOwn(values, axis) ? catalog.optionSets[set].find(o => o.value === values[axis]) : catalog.optionSets[set][0]).id])),
    ...(chance ? { chanceOptionId: chance } : {}) };
}
const flat = (effects, mode = 'normal') => ({ mode, structure: { kind: 'flat', effects } });
const random = n => ({ mode: 'normal', structure: { kind: 'random', branches: Array.from({ length: n }, () => ({ effects: [row('damage-enemy', {amount:100})] })) } });
const hp = value => ({ mode:'normal', structure:{kind:'hpCondition', thresholdOptionId:catalog.optionSets.hpThreshold.find(o=>o.value===value).id,
  branches:{met:{effects:[row('damage-enemy',{amount:100})]},unmet:{effects:[row('heal-self',{amount:50})]}}}});
const tables = {
  damageAmount:[[50,0],[60,1],[70,2],[80,3],[90,4],[100,5]], healAmount:[[30,0],[40,1],[50,2]],
  currentHpPct:[[.25,0],[.5,5],[.75,10],[1,15]], statusStacks:[[3,0]],
  turnATAmount:[[2,0],[3,1],[4,2]],turnDFAmount:[[2,0],[3,1],[4,2]],turnCount:[[2,0],[3,1],[4,2]],
  timedStacks:[[1,0]],timedTurns:[[3,0],[4,1],[5,2]],statusMultiplier:[[10,0],[15,1],[20,2]],
  stepBaseAmount:[[30,0]],stepEveryTurns:[[5,1],[10,0]],stepAmount:[[5,0],[10,2]],
  revivePct:[[.01,0],[.1,2],[.25,4]],hpThreshold:[[.25,-1],[.5,-1],[.75,-1]],
};
for (const [set, expected] of Object.entries(tables)) test('production '+set,()=>{
  assert.deepEqual(catalog.optionSets[set].map(o=>[o.value,o.apDelta]),expected);
  assert.equal(new Set(catalog.optionSets[set].map(o=>o.id)).size,expected.length);
});
test('status種類・randomは0、groupのみ2、全effectがproductionだけでcomplete',()=>{
  for(const [key,options] of Object.entries(catalog.optionSets).filter(([key])=>/^(grant|clear|timed)-/.test(key)))
    for(const o of options) assert.equal(o.apDelta,key.startsWith('clear-all-')?2:0);
  for(const e of catalog.effects) {
    const r=compileCSkill(flat([row(e.id)],e.id==='revive-self'?'special':'normal'));
    assert.equal(r.ok,true,e.id);assert.deepEqual(r.unresolved,[]);
    if(e.mirrorId) {
      const m=compileCSkill(flat([row(e.mirrorId)]));
      assert.equal(r.resources.optionDelta,-m.resources.optionDelta || 0);
    }
  }
});
test('production AP: amount+duration、mirror反転、最低5、turnStep全軸',()=>{
  assert.equal(compileCSkill(flat([row('turn-at-self-up',{amount:3,duration:4})])).skill.costAP,8);
  assert.equal(compileCSkill(flat([row('turn-step-damage-enemy',{everyTurns:5,stepAmount:10})])).skill.costAP,8);
  const r=compileCSkill(flat([row('clear-buff-group-self')]));assert.equal(r.resources.optionDelta,-2);assert.equal(r.skill.costAP,5);
  const mirror=compileCSkill(flat([row('damage-self',{amount:100})]));assert.equal(mirror.resources.optionDelta,-5);assert.equal(mirror.skill.costAP,5);
});
test('production chance割引はleafだけ、失敗20%維持',()=>{
  assert.deepEqual(catalog.chanceOptions.map(o=>[o.id,o.apDiscount]),[['100',0],['70',1],['50',2],['25',3]]);
  for(const [id,amount] of [['damage-enemy',60],['heal-self',40]]) for(const [chance,discount] of [['100',0],['70',1],['50',2],['25',3]]) {
    const r=compileCSkill(flat([row(id,{amount},chance),row('damage-enemy',{amount:100})]));
    assert.equal(r.skill.costAP,11+Math.max(0,1-discount));
    assert.equal(r.skill.effect[0].onFail?.amount,chance==='100'?undefined:Math.floor(amount*.2));
    assert.equal(r.resources.effectCount,2);
  }
});
test('normal分岐全枝合算、2択-1/3択-2/HP一律-1、special flat-only',()=>{
  assert.equal(compileCSkill(flat([row('damage-enemy')])).ok,true);
  assert.equal(compileCSkill(flat([row('revive-self')],'special')).ok,true);
  for(const n of [2,3]) {
    const s=random(n),r=compileCSkill(s);assert.equal(r.ok,true);
    assert.equal(r.resources.optionDelta,n*5);assert.equal(r.resources.slotCost,n-1);
    assert.equal(r.resources.knownStructureDelta,1-n);assert.equal(r.skill.costAP,5+n*5);
    assert.ok(compileCSkill({...s,mode:'special'}).errors.some(e=>e.code==='SPECIAL_FLAT_ONLY'));
    s.structure.branches.forEach(b=>b.effects=[row('damage-self',{amount:100})]);
    assert.equal(compileCSkill(s).skill.costAP,5);
  }
  for(const threshold of [.25,.5,.75]) {
    const s=hp(threshold),r=compileCSkill(s);assert.equal(r.ok,true);assert.equal(r.skill.costAP,12);
    assert.equal(r.resources.knownStructureDelta,-1);assert.equal(r.skill.effect[0].when.right,threshold);
    assert.ok(compileCSkill({...s,mode:'special'}).errors.some(e=>e.code==='SPECIAL_FLAT_ONLY'));
    s.structure.branches.met.effects=[row('damage-self',{amount:100})];assert.equal(compileCSkill(s).skill.costAP,5);
  }
});
test('revive回数別境界、初回乱数なし、各行独立、heal/damageは抽選失敗でも継続',()=>{
  const skill=compileCSkill(flat([row('heal-self'),row('revive-self',{maxHpPct:.1}),row('revive-self',{maxHpPct:.25}),row('damage-enemy')],'special')).skill;
  assert.deepEqual(skill.repeatReviveChance,{2:.5,3:.25,default:.1});
  for(const [count,p] of [[1,1],[2,.5],[3,.25],[4,.1],[5,.1],[10,.1]]) for(const roll of [p-.000001,p]) {
    const actor={side:'P1',hp:0,maxHP:1000},enemy={side:'P2',hp:1000};let calls=0;const logs=[];
    const ctx={actor,enemy,rng:()=>{calls++;return roll;},specialCActivation:{count,repeatReviveChance:skill.repeatReviveChance},
      push:(type,side,extra)=>logs.push({type,...extra}),helpers:{heal:(t,n)=>{t.hp+=n;},dealDamage:(t,n)=>{t.hp-=n;}}};
    applyEffect(skill.effect,ctx);
    assert.equal(calls,count===1?0:2);assert.equal(actor.hp,count===1||roll<p?250:30);assert.equal(enemy.hp,950);
    assert.deepEqual(logs.filter(e=>e.type==='reviveRoll').map(e=>e.probability),count===1?[]:[p,p]);
  }
});
test('production harness: special発動回数から50/25/10/10、固定healは毎回実行',()=>{
  const s=flat([row('heal-self'),row('revive-self'),row('damage-enemy')],'special');
  const r=runCSkillTestBattle(s,{catalog:createCSkillCatalog(),rules:createCSkillRules(),rng:()=>.99,
    settings:{...Object.fromEntries(C_TEST_FIELDS.map(f=>[f.key,f.value])),p1HP:0,p1AP:100,p1Dice:0,p2Dice:0,maxTurns:5,forceDeath:true}});
  assert.equal(r.compilation.ok,true);
  assert.deepEqual(r.battle.events.filter(e=>e.type==='reviveRoll').map(e=>[e.activationCount,e.probability]),[[2,.5],[3,.25],[4,.1],[5,.1]]);
  assert.equal(r.battle.events.filter(e=>e.type==='heal').length,5);
  assert.equal(r.battle.events.filter(e=>e.type==='fixedDamage').length,5);
});
