import test from "node:test";
import assert from "node:assert/strict";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { createCSkillRules } from "../js/cSkillRules.js";
import { calculateCSkillResources as calculate } from "../js/cSkillResources.js";
const catalog = createCSkillCatalog();
const damage = (amount, target = "enemy") => ({ effectId: `damage-${target}`, options: { amount: `damageAmount-${amount}` } });
const flat = effects => ({ mode: "normal", structure: { kind: "flat", effects } });
const random = branches => ({ mode: "normal", structure: { kind: "random", branches: branches.map(effects => ({ effects })) } });
const hp = (branches, threshold) => ({ mode: "normal", structure: { kind: "hpCondition", thresholdOptionId: `hpThreshold-${threshold}`,
  branches: { met: { effects: branches[0] }, unmet: { effects: branches[1] } } } });

test("flat retains sum of all effects, local slots, chance discounts and minimum AP", () => {
 const s=flat([damage(60),damage(55),damage(55,"self")]);
 const r=calculate(s);assert.equal(r.optionDelta,2);assert.equal(r.slotCost,1);assert.equal(r.rawAP,8);
 assert.equal(r.requiredAP,8);assert.deepEqual(r.effectBreakdown.map(e=>e.slotCost),[0,1,0]);
 assert.equal(calculate(flat([{...damage(75),chanceOptionId:"50"}])).requiredAP,7);
 assert.equal(calculate(flat([damage(75,"self")])).requiredAP,5);
});
test("random2/random3 select one whole largest branch, not separate maxima or sum", () => {
 for(const branches of [[[damage(55),damage(50)],[damage(65)]],[[damage(55),damage(50)],[damage(65)],[damage(55,"self")]]]) {
  const s=random(branches),before=structuredClone(s),r=calculate(s);
  assert.equal(r.complete,true);assert.equal(r.effectAP,3);assert.equal(r.requiredAP,8);
  assert.equal(r.knownStructureDelta,0);assert.equal(r.slotCost,0);assert.equal(r.optionDelta,3);
  assert.equal(r.selectedBranchPath,"structure.branches.1");assert.deepEqual(r.branchBreakdown.map(b=>b.totalAP),branches.length===2?[2,3]:[2,3,-1]);
  assert.deepEqual(s,before);
 }
 const r=calculate(random([[damage(60),damage(55)],[damage(65)]]));
 assert.equal(r.effectAP,4);assert.equal(r.slotCost,1);assert.equal(r.requiredAP,9);
 assert.deepEqual(r.effectBreakdown.map(e=>e.slotCost),[0,1,0]);
});
test("benefit slot counters reset in every branch and exclude drawback", () => {
 const s=random([[damage(50),damage(55,"self"),damage(50)],[damage(50),damage(50)]]);
 const r=calculate(s);assert.deepEqual(r.branchBreakdown.map(b=>b.slotCost),[1,1]);
 assert.deepEqual(r.effectBreakdown.map(e=>e.slotCost),[0,0,1,0,1]);
 const custom=calculate(s,{rules:{...createCSkillRules(),additionalBenefitSlotAP:3}});
 assert.deepEqual(custom.branchBreakdown.map(b=>b.slotCost),[3,3]);
 for(const n of [2,3]) {const free=calculate(random(Array.from({length:n},()=>[damage(55)])));assert.equal(free.requiredAP,6);assert.equal(free.slotCost,0);}
});
test("HP thresholds and obsolete structure prices do not affect maximum branch AP", () => {
 for(const threshold of [.25,.5,.75]) {
  const s=hp([[damage(60),damage(55)],[damage(65)]],threshold);
  const altered=createCSkillCatalog();altered.optionSets.hpThreshold.forEach(o=>o.apDelta=null);
  for(const c of [catalog,altered]) {
   const r=calculate(s,{catalog:c,rules:{...createCSkillRules(),branchAPDelta:{hpCondition:-100}}});
   assert.equal(r.requiredAP,9);assert.equal(r.knownStructureDelta,0);
  }
 }
 assert.equal(Object.hasOwn(createCSkillRules(),"branchAPDelta"),false);
});
test("drawback cap applies to the branch sum; negative branch maxima are not zero-clamped", () => {
 const changed=createCSkillCatalog();changed.optionSets.damageAmount.find(o=>o.value===75).apDelta=8;
 const capped=calculate(flat([damage(75,"self"),damage(70,"self")]),{catalog:changed});
 assert.deepEqual(capped.effectBreakdown.map(e=>e.effectDelta),[-5,-0]);assert.equal(capped.optionDelta,-5);assert.equal(capped.rawAP,0);assert.equal(capped.requiredAP,5);
 const r=calculate(random([[damage(65,"self")],[damage(70,"self")]]));
 assert.equal(r.effectAP,-3);assert.equal(r.rawAP,2);assert.equal(r.requiredAP,5);
 // Exhaustively cover every public drawback's axis combinations via their maximum additive price.
 for(const d of catalog.effects.filter(e=>e.polarity==="drawback")) {
  const options=Object.fromEntries(Object.entries(d.optionAxes).map(([axis,set])=>[axis,catalog.optionSets[set].reduce((a,b)=>a.apDelta>=b.apDelta?a:b).id]));
  const row=calculate(flat([{effectId:d.id,options}])).effectBreakdown[0];
  assert.equal(row.effectDelta,-Math.min(5,row.optionPrice),d.id);
 }
});
test("unknown branch prices and invalid/normalized incomplete selections never yield a winner", () => {
 const c=createCSkillCatalog();c.optionSets.damageAmount.find(o=>o.value===60).apDelta=null;
 const cases=[random([[damage(75)],[damage(60)]]),random([[damage(75)],[{effectId:"damage-enemy",options:{}}]]),
 random([[damage(75)],[]]),random([[damage(75)],[{effectId:"damage",targetId:"enemy",options:{amount:""}}]])];
 for(const s of cases) {
  const r=calculate(s,{catalog:c});assert.equal(r.complete,false);assert.equal(r.requiredAP,null);assert.equal(r.effectAP,null);assert.equal(r.selectedBranchPath,null);
  assert.ok(r.errors.length+r.unresolved.length>0);
  const compiled=compileCSkill(s,{catalog:c});assert.equal(compiled.ok,false);assert.equal(compiled.skill,null);
 }
});

const percent=()=>({effectId:"current-hp-damage-enemy",options:{amountPct:"currentHpPct-1"}});
import { compileCSkill } from "../js/cSkillCompiler.js";
import { formatCRequiredAP } from "../js/skillResourceDisplay.js";
function verify(s,expected,options={}) {
 const before=structuredClone(s),r=calculate(s,options),compiled=compileCSkill(s,options);
 assert.equal(r.complete,true,JSON.stringify(r.errors));assert.equal(r.requiredAP,expected);
 assert.equal(compiled.ok,true);assert.equal(compiled.skill.costAP,expected);
 for(const b of r.branchBreakdown) {
  const rows=r.effectBreakdown.filter(e=>e.branchPath===b.path);
  assert.equal(rows.reduce((sum,e)=>sum+e.effectDelta,0),b.optionDelta);
  assert.equal(b.optionDelta+b.slotCost,b.totalAP);
  assert.equal(b.appliedDrawback,Math.min(b.drawbackPrice,b.maxDrawbackAP));
 }
 assert.equal(r.knownOptionDelta,r.branchBreakdown.reduce((sum,b)=>sum+b.optionDelta,0));
 assert.match(formatCRequiredAP(r,options.rules??createCSkillRules()),new RegExp('＝'+expected+'(?:（|$)'));
 assert.deepEqual(s,before);return r;
}
test("20 AP example, original prices and applied per-row refunds reconcile",()=>{
 const r=verify(flat([percent(),damage(75,"self"),damage(75,"self"),damage(75,"self")]),20);
 assert.deepEqual(r.effectBreakdown.map(e=>e.optionPrice),[20,5,5,5]);
 assert.deepEqual(r.effectBreakdown.map(e=>e.effectDelta),[20,-5,-0,-0]);
 assert.equal(r.branchBreakdown[0].drawbackPrice,15);assert.equal(r.branchBreakdown[0].appliedDrawback,5);
 const custom={...createCSkillRules(),maxDrawbackAP:3};
 verify(flat([percent(),damage(75,"self"),damage(75,"self")]),22,{rules:custom});
});
test("refunds below the cap, discount and extra benefit slot remain independent",()=>{
 verify(flat([percent(),damage(55,"self"),damage(60,"self")]),22);
 verify(flat([{...damage(80),chanceOptionId:"50"},damage(75),damage(75,"self"),damage(75,"self")]),9);
 verify(flat([damage(75,"self"),damage(75,"self")]),5);
});
test("each random and HP branch caps independently before choosing the highest cost",()=>{
 const a=[percent(),damage(75,"self"),damage(75,"self")],b=[damage(80),damage(55,"self")];
 for(const s of [random([a,b]),hp([a,b],.5),hp([b,a],.25)]) {
  const r=verify(s,20);assert.equal(r.branchBreakdown.find(b=>b.path===r.selectedBranchPath).totalAP,15);
  assert.deepEqual(r.branchBreakdown.map(b=>b.appliedDrawback).sort(),[1,5]);
 }
 const r=verify(random([[percent(),damage(80,"self")],[damage(75,"self"),damage(75,"self")],[damage(80)]]),20);
 assert.deepEqual(r.branchBreakdown.map(b=>b.appliedDrawback),[5,5,0]);
 assert.deepEqual(r.branchBreakdown.map(b=>b.totalAP),[15,-5,6]);
 const cappedWinner=verify(random([a,[{effectId:"current-hp-damage-enemy",options:{amountPct:"currentHpPct-0.75"}},damage(65)]]),20);
 assert.equal(cappedWinner.selectedBranchPath,"structure.branches.0");
 assert.deepEqual(cappedWinner.branchBreakdown.map(b=>b.totalAP),[15,14]);
 // A cheaper gross branch wins after the expensive branch's refund is capped.
 const lower={effectId:"current-hp-damage-enemy",options:{amountPct:"currentHpPct-0.75"}};
 const winner=verify(random([[lower,damage(75,"self"),damage(75,"self")],[damage(80)]]),11);
 assert.equal(winner.selectedBranchPath,"structure.branches.1");
});
