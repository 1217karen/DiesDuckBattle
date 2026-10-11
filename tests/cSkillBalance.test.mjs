import test from "node:test";
import assert from "node:assert/strict";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { compileCSkill } from "../js/cSkillCompiler.js";
import { migrateSelection } from "../js/selectionNormalization.js";
import { applyEffect } from "../js/effects.js";
const catalog = createCSkillCatalog();
const flat = effects => ({mode:"normal",structure:{kind:"flat",effects}});
const leaf = (effectId, options={}) => ({effectId,options});

test("every revised C quantity compiles with catalog prices, shared drawback prices and the per-effect cap",()=>{
 const changed=new Set(["damageAmount","currentHpPct","statusMultiplier","statusStacks","turnATAmount","turnDFAmount"]);
 for(const effect of catalog.effects) {
  if(!Object.values(effect.optionAxes).some(set=>changed.has(set)) && effect.category!=="statusClear") continue;
  let combinations=[{}];
  for(const [axis,set] of Object.entries(effect.optionAxes)) combinations=combinations.flatMap(options=>catalog.optionSets[set].map(o=>({...options,[axis]:o.id})));
  for(const options of combinations) {
   const price=(effect.apDelta??0)+Object.entries(options).reduce((sum,[axis,id])=>sum+catalog.optionSets[effect.optionAxes[axis]].find(o=>o.id===id).apDelta,0);
   const delta=effect.polarity==="benefit"?price:-Math.min(5,price);
   const saved=flat([leaf(effect.id,options)]),before=structuredClone(saved);
   for(const selection of [saved,migrateSelection("C",saved,catalog)]) {
    const result=compileCSkill(selection);
    assert.equal(result.ok,true,effect.id);assert.equal(result.resources.effectBreakdown[0].optionPrice,price);
    assert.equal(result.resources.optionDelta,delta || 0);assert.equal(result.skill.costAP,Math.max(5,5+delta));
   }
   assert.deepEqual(saved,before);
  }
 }
 assert.equal(compileCSkill(flat([leaf("damage-enemy",{amount:"damageAmount-80"})])).skill.costAP,11);
});

test("status grants and optionless clears each add or subtract 1 AP before the minimum",()=>{
 for(const effect of catalog.effects.filter(e=>["statusGrant","statusClear"].includes(e.category))) {
  const options=Object.fromEntries(Object.entries(effect.optionAxes).map(([axis,set])=>[axis,catalog.optionSets[set][0].id]));
  const r=compileCSkill(flat([leaf("damage-enemy",{amount:"damageAmount-80"}),leaf(effect.id,options)]));
  const benefit=effect.polarity==="benefit";
  assert.equal(r.ok,true);assert.equal(r.resources.effectBreakdown[1].effectDelta,benefit?1:-1);
  assert.equal(r.skill.costAP,benefit?13:10);
  if(effect.category==="statusClear") {assert.deepEqual(effect.optionAxes,{});assert.equal(r.skill.effect[1].repeat,3);}
 }
});

test("removed fixed damage IDs remain invalid in legacy and current saved DTOs without repair",()=>{
 for(const target of ["self","enemy"]) for(const amount of [90,100]) {
  const saved=flat([leaf(`damage-${target}`,{amount:`damageAmount-${amount}`})]);
  for(const selection of [saved,migrateSelection("C",saved,catalog)]) {
   const before=structuredClone(selection),r=compileCSkill(selection);
   assert.equal(r.ok,false);assert.equal(r.resources.requiredAP,null);assert.ok(r.errors.length>0);
   assert.deepEqual(selection,before);
  }
 }
});

test("AT and DF amount 1 compiles and executes for self increase and enemy decrease",()=>{
 for(const stat of ["AT","DF"]) for(const target of ["self","enemy"]) {
  const r=compileCSkill(flat([leaf(`turn-${stat.toLowerCase()}-${target}-${target==="self"?"up":"down"}`,{amount:`turn${stat}Amount-1`,duration:"turnCount-2"})]));
  assert.equal(r.ok,true);assert.equal(r.skill.costAP,5);
  const actor={side:"P1",buffs:[]},enemy={side:"P2",buffs:[]};
  applyEffect(r.skill.effect,{actor,enemy,push(){},helpers:{}});
  const buff=(target==="self"?actor:enemy).buffs[0];
  assert.equal(buff.stat,stat);assert.equal(buff.amount,target==="self"?1:-1);
  assert.deepEqual(buff.duration,{kind:"turns",remainingTurns:2});
 }
});

test("effect-level AP uses trusted validation and cannot be supplied in a saved leaf",()=>{
 const selection=flat([leaf("remove-random-debuff-self")]);
 const custom=createCSkillCatalog(),effect=custom.effects.find(e=>e.id==="remove-random-debuff-self");
 effect.apDelta=null;
 const pending=compileCSkill(selection,{catalog:custom});assert.equal(pending.ok,false);assert.equal(pending.resources.requiredAP,null);
 assert.ok(pending.unresolved.some(e=>e.code==="PRICE_UNRESOLVED"));
 for(const price of [-1,NaN,Infinity]) {effect.apDelta=price;assert.throws(()=>compileCSkill(selection,{catalog:custom}),/Invalid C option price/);}
 selection.structure.effects[0].apDelta=0;assert.equal(compileCSkill(selection).ok,false);
});
