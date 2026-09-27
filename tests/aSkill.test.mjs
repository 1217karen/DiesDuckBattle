import test from "node:test";
import assert from "node:assert/strict";
import { createASkillCatalog, getATriggerOptions, getAEffectOptions, getAEffectAvailability, matchesATrigger } from "../js/aSkillCatalog.js";
import { calculateASkillResources } from "../js/aSkillResources.js";
import { compileASkill } from "../js/aSkillCompiler.js";
import { migrateSelection } from "../js/selectionNormalization.js";
import { createBuildRules } from "../js/buildRules.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";
import { applyEffect } from "../js/effects.js";
const catalog = createASkillCatalog();
const build = (dice = [0,0,0,0,0,0], diceFrame = "light") => ({diceFrame,dice});
const chosen = (effectId, amount) => ({effectId,...(amount === undefined ? {} : {amountOptionId:`amount-${amount}`})});
const benefit = chosen("damage-enemy",3), cancel = chosen("cancel-self-attack");
const selection = (effects=[benefit],triggerId="exact:0") => ({effects,triggerId});
const compile = (s=selection(),b=build(),options) => compileASkill(b,s,options);
const calc = (s=selection(),b=build(),options) => calculateASkillResources(b,s,options);

test("現在6枠のunique exact、非0の有意なthreshold、従来のrange価格",()=>{
  const b=build([0,2,2,3,4,4]);
  const options=getATriggerOptions(b);
  assert.deepEqual(options.map(t=>t.id),["exact:0","exact:2","exact:3","exact:4","lte:2","lte:3","gte:3","gte:4","all"]);
  assert.deepEqual(options.map(t=>t.pointCost),[0,0,0,0,1,2,1,0,2]);
  assert.equal(compile(selection(undefined,"exact:1"),b).ok,false);
  assert.equal(compile(selection(undefined,"exact:0"),build([1,1,2,2,3,4])).ok,false);
  assert.deepEqual(getATriggerOptions(build()).map(t=>t.id),["exact:0","all"]);
  assert.deepEqual(getATriggerOptions(build([0,0,0,2,2,2])).map(t=>t.id),["exact:0","exact:2","all"]);
});

test("rangeは0を除外しallは0を含む。Dの追加出目は作成時に一切参照しない",()=>{
  const b=build([0,0,1,2,3,4]);
  for(const [trigger,count] of [["lte:3",3],["gte:3",2],["all",6]]) {
    const s=selection([cancel,benefit],trigger), expected=compile(s,b);
    assert.equal(expected.resources.frequencyCount,count);
    const withD={...b};
    for(const key of ["dSkill","dSelection","dicePool","battler"]) Object.defineProperty(withD,key,{get(){throw Error(`Unexpected ${key}`);}});
    assert.deepEqual(compile(s,withD),expected);
    assert.deepEqual(getATriggerOptions(withD),getATriggerOptions(b));
  }
  for(const kind of ["lte","gte"]) assert.equal(matchesATrigger({kind,value:3},0),false);
  assert.equal(matchesATrigger({kind:"all"},0),true);
  assert.equal(matchesATrigger({kind:"gte",value:3},5),true);
});

test("dice変更で失効したtriggerは保存値を保持してvalidation error",()=>{
  for(const trigger of ["exact:2","lte:2","gte:3"]) {
    const s=selection(undefined,trigger), before=structuredClone(s);
    assert.equal(compile(s,build([0,0,1,2,3,4])).ok,true);
    const result=compile(s,build());
    assert.equal(result.ok,false);assert.equal(result.skill,null);
    assert.ok(result.errors.some(e=>e.code==="INVALID_TRIGGER"));assert.deepEqual(s,before);
  }
});

test("Aの50/25/10%をv1/v2とも拒否、100指定は互換受理してchanceを出力しない",()=>{
  assert.deepEqual(catalog.chanceOptions.map(o=>o.id),["100"]);
  assert.ok(catalog.selectionEffects.flatMap(d=>d.variants).every(r=>!r.chanceEnabled));
  for(const chance of ["50","25","10",null,1,"bogus"]) {
    const s=selection([{...benefit,chanceOptionId:chance}]);
    assert.equal(compile(s).ok,false);assert.equal(compile(migrateSelection("A",s,catalog)).ok,false);
  }
  for(const leaf of [benefit,{...benefit,chanceOptionId:"100"}]) {
    const result=compile(selection([leaf])); assert.equal(result.ok,true);
    assert.equal(Object.hasOwn(result.skill.effect[0],"chance"),false);
    assert.equal(result.resources.effectCost,2);assert.equal(Object.hasOwn(result.resources,"chanceDiscount"),false);
  }
});

test("AP操作は合法な2方向のみ、1=3pt/2=5pt",()=>{
  for(const id of ["ap-self-increase","ap-enemy-decrease"]) for(const [amount,cost] of [[1,3],[2,5]]) {
    const r=compile(selection([chosen(id,amount)]));assert.equal(r.ok,true);assert.equal(r.resources.effectCost,cost);
    assert.equal(r.skill.effect[0].value,id.includes("self")?amount:-amount);
  }
});

test("指定/ランダムstatus付与は両target・両groupで1/2/3stack",()=>{
  for(const group of ["buff","debuff"]) for(const target of ["self","enemy"]) for(const amount of [1,2,3]) {
    for(const status of [...STATUS_GROUPS[group],`@${group}`]) {
      const id=`grant-${status.startsWith("@")?`random-${group}`:status}-${target}`;
      const r=compile(selection([chosen(id,amount)]));assert.equal(r.ok,true);
      assert.deepEqual(r.skill.effect[0],{type:"changeStatus",target,status,op:"add",value:amount});
      const drawback=(group==="debuff")===(target==="self");
      assert.equal(r.resources.drawbackPoints,drawback?amount:0);assert.equal(r.resources.effectCost,drawback?0:amount);
    }
  }
});

test("ランダム解除4方向のpolarityとtrusted repeat、毎回異なるstatusを解除可能",()=>{
  for(const group of ["buff","debuff"]) for(const target of ["self","enemy"]) for(const amount of [1,2,3]) {
    const s=selection([chosen(`remove-random-${group}-${target}`,amount)]);
    const r=compile(migrateSelection("A",s,catalog));assert.equal(r.ok,true);
    assert.deepEqual(r.skill.effect[0],{type:"removeRandomStatusStack",target,group,repeat:amount});
    const drawback=(group==="buff")===(target==="self");
    assert.equal(r.resources.drawbackPoints,drawback?amount:0);assert.equal(r.resources.effectCost,drawback?0:amount);
    const actor={side:"P1",status:{}},enemy={side:"P2",status:{}},fighter=target==="self"?actor:enemy;
    for(const key of STATUS_GROUPS[group]) fighter.status[key]=1;
    const removed=[];let calls=0;
    applyEffect(r.skill.effect,{actor,enemy,rng:()=>{calls++;return 0;},push:(type,side,event)=>{if(type==="statusChange")removed.push(event.status);},helpers:{}});
    assert.equal(calls,amount);assert.equal(new Set(removed).size,amount);
    assert.equal(Object.values(fighter.status).reduce((a,b)=>a+b,0),STATUS_GROUPS[group].length-amount);
  }
});

test("キャンセル還元は現在6枠の一致数1/2=1、3/4=2、5/6=3",()=>{
  for(let n=1;n<=6;n++) {
    const dice=Array.from({length:6},(_,i)=>i<n?0:[1,2,3,4,1,2][i]);
    const r=calc(selection([cancel,benefit]),build(dice));assert.equal(r.complete,true);
    assert.equal(r.frequencyCount,n);assert.equal(r.cancelDrawbackPoints,Math.ceil(n/2));
    assert.equal(r.effectBreakdown[0].drawbackPoints,Math.ceil(n/2));
    assert.equal(r.remaining,r.basePoints+r.dicePoints-r.triggerCost-r.effectCost-r.benefitSlotCost+r.drawbackPoints);
  }
});

test("通常効果1～4必須、キャンセルは枠外で重複不可、合計5要素compile可",()=>{
  for(let n=0;n<=5;n++) for(const withCancel of [false,true]) {
    const s=selection([...(withCancel?[cancel]:[]),...Array.from({length:n},()=>chosen("heal-enemy",5))]);
    const r=compile(s);assert.equal(r.ok,n>=1&&n<=4);
    assert.equal(r.resources.normalEffectCount,n);assert.equal(r.resources.effectCount,n+Number(withCancel));
    if(r.ok) assert.equal(r.skill.effect.length,n+Number(withCancel));
  }
  assert.ok(compile(selection([cancel,cancel,benefit])).errors.some(e=>e.code==="DUPLICATE_EFFECT"));
  const r=calc(selection([cancel,chosen("next-at-self-increase",2),chosen("next-at-self-increase",2)]));
  assert.equal(r.benefitSlotCost,1);assert.equal(r.effectCost,2);assert.equal(r.cancelDrawbackPoints,3);
});

test("出目専用は対応exactのみ。キャンセル併用は2/6のみ禁止、catalogとcompilerで保証",()=>{
  for(const d of catalog.effects.filter(d=>d.exactFace)) {
    const b=build([d.exactFace,0,0,0,0,0],d.exactFace>4?"heavy":"light"),trigger=`exact:${d.exactFace}`;
    const leaf=chosen(d.id,d.requiresAmount?3:undefined);
    assert.equal(compile(selection([leaf],trigger),b).ok,true);
    for(const other of ["all","exact:0","lte:3","gte:3"]) assert.equal(compile(selection([leaf],other),b).ok,false);
    const s=selection([cancel,leaf],trigger),allowed=![2,6].includes(d.exactFace);
    assert.equal(compile(s,b).ok,allowed);assert.equal(compile(migrateSelection("A",s,catalog),b).ok,allowed);
    assert.equal(getAEffectAvailability(d.id,b,trigger,catalog,s.effects).selectable,allowed);
    assert.equal(getAEffectOptions(b,trigger,catalog,s.effects).flatMap(g=>g.effects).find(e=>e.id===d.id).selectable,allowed);
    assert.equal(compile(selection([leaf,leaf],trigger),b).ok,false);
  }
});

test("v2出目無効はtriggerから決まり別途diceAction指定を要求しない",()=>{
  for(const face of [1,3,4,5]) {
    const s=selection([{effectId:"cancel-dice-effect",targetId:"self",options:{}}],`exact:${face}`);
    const r=compile(s,build([face,0,0,0,0,0],face>4?"heavy":"light"));
    assert.equal(r.ok,true);assert.equal(r.skill.effect[0].key,`skipDice${face}`);
  }
});

test("削除した逆方向・個別status解除はv1/v2とも不正、補正・mutationなし",()=>{
  const removed=["damage-self","ap-self-decrease","ap-enemy-increase","next-at-self-decrease","next-at-enemy-increase","phase-at-self-decrease","phase-df-enemy-increase",...STATUS_GROUPS.all.flatMap(k=>[`remove-${k}-self`,`remove-${k}-enemy`])];
  for(const id of removed) {
    assert.equal(catalog.effects.some(e=>e.id===id),false);
    const s=selection([chosen(id,1)]),before=structuredClone(s);
    assert.equal(compile(s).ok,false);assert.deepEqual(s,before);
  }
  for(const leaf of [{effectId:"damage",targetId:"self",options:{amount:"amount-3"}},{effectId:"change-ap",targetId:"self",options:{direction:"decrease",amount:"amount-1"}},{effectId:"change-ap",targetId:"enemy",options:{direction:"increase",amount:"amount-1"}},{effectId:"remove-status",targetId:"self",statusId:"crack",options:{}}]) assert.equal(compile(selection([leaf])).ok,false);
});

test("trusted catalogのみ、任意effect/数値/価格注入と不正diceを拒否",()=>{
  for(const key of ["effect","target","status","value","amount","pointCost","drawbackPoints","chance","repeat","duration","type","key","op","__proto__"]) {
    const leaf=Object.fromEntries([...Object.entries(benefit),[key,999]]);
    assert.equal(compile(selection([leaf])).ok,false,key);assert.equal(compile({...selection(),[key]:999}).ok,false,key);
  }
  for(const leaf of [null,{effectId:"revive"},{effectId:"constructor"},{...benefit,amountOptionId:3}]) assert.equal(compile(selection([leaf])).ok,false);
  assert.equal(compile(null).ok,false);
  for(const dice of [[0],[0,0,0,0,0,0,0],[0,0,1,2,3,5],[0,0,1,1,1,1],[1,1,1,2,3,4],[0,0,0,0,0,NaN]]) assert.equal(compile(selection(),build(dice)).ok,false);
});

test("予算超過・未確定価格・順序/重複維持・入力不変",()=>{
  const s=selection(Array.from({length:4},()=>chosen("damage-enemy",5)));
  assert.equal(calc(s).complete,true);assert.equal(compile(s).ok,false);
  assert.ok(compile(s).errors.some(e=>e.code==="INSUFFICIENT_A_POINTS"));
  const c=createASkillCatalog();c.effects.find(e=>e.id==="damage-enemy").amountOptions[0].pointCost=null;
  assert.equal(calc(selection(),build(),{catalog:c}).remaining,null);
  const b=build(),rules=createBuildRules(),seq=selection([chosen("heal-enemy",5),benefit,chosen("heal-enemy",5)]);
  const before=structuredClone({b,rules,seq,catalog});
  const freeze=o=>{if(o&&typeof o==="object"){Object.values(o).forEach(freeze);Object.freeze(o);}};
  [b,rules,seq,catalog].forEach(freeze);
  const r=compile(seq,b,{rules,catalog});assert.equal(r.ok,true);
  assert.deepEqual(r.skill.effect.map(e=>e.type),["heal","fixedDamage","heal"]);
  assert.deepEqual({b,rules,seq,catalog},before);
});


test("旧v2 diceActionはexactと一致するときだけ互換受理し、異なる出目へ補正しない",()=>{
  const b=build([1,0,0,0,0,0]);
  for(const diceAction of ["1","3","6",1,""]) {
    const s=selection([{effectId:"cancel-dice-effect",targetId:"self",options:{diceAction}}],"exact:1");
    const before=structuredClone(s),r=compile(s,b);
    assert.equal(r.ok,diceAction==="1");assert.deepEqual(s,before);
  }
});
