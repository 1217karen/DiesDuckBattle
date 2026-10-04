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
 const s=flat([damage(70),damage(60),damage(60,"self")]);
 const r=calculate(s);assert.equal(r.optionDelta,2);assert.equal(r.slotCost,1);assert.equal(r.rawAP,8);
 assert.equal(r.requiredAP,8);assert.deepEqual(r.effectBreakdown.map(e=>e.slotCost),[0,1,0]);
 assert.equal(calculate(flat([{...damage(100),chanceOptionId:"50"}])).requiredAP,8);
 assert.equal(calculate(flat([damage(100,"self")])).requiredAP,5);
});
test("random2/random3 select one whole largest branch, not separate maxima or sum", () => {
 for(const branches of [[[damage(60),damage(50)],[damage(80)]],[[damage(60),damage(50)],[damage(80)],[damage(60,"self")]]]) {
  const s=random(branches),before=structuredClone(s),r=calculate(s);
  assert.equal(r.complete,true);assert.equal(r.effectAP,3);assert.equal(r.requiredAP,8);
  assert.equal(r.knownStructureDelta,0);assert.equal(r.slotCost,0);assert.equal(r.optionDelta,3);
  assert.equal(r.selectedBranchPath,"structure.branches.1");assert.deepEqual(r.branchBreakdown.map(b=>b.totalAP),branches.length===2?[2,3]:[2,3,-1]);
  assert.deepEqual(s,before);
 }
 const r=calculate(random([[damage(70),damage(60)],[damage(80)]]));
 assert.equal(r.effectAP,4);assert.equal(r.slotCost,1);assert.equal(r.requiredAP,9);
 assert.deepEqual(r.effectBreakdown.map(e=>e.slotCost),[0,1,0]);
});
test("benefit slot counters reset in every branch and exclude drawback", () => {
 const s=random([[damage(50),damage(60,"self"),damage(50)],[damage(50),damage(50)]]);
 const r=calculate(s);assert.deepEqual(r.branchBreakdown.map(b=>b.slotCost),[1,1]);
 assert.deepEqual(r.effectBreakdown.map(e=>e.slotCost),[0,0,1,0,1]);
 const custom=calculate(s,{rules:{...createCSkillRules(),additionalBenefitSlotAP:3}});
 assert.deepEqual(custom.branchBreakdown.map(b=>b.slotCost),[3,3]);
 for(const n of [2,3]) {const free=calculate(random(Array.from({length:n},()=>[damage(60)])));assert.equal(free.requiredAP,6);assert.equal(free.slotCost,0);}
});
test("HP thresholds and obsolete structure prices do not affect maximum branch AP", () => {
 for(const threshold of [.25,.5,.75]) {
  const s=hp([[damage(70),damage(60)],[damage(80)]],threshold);
  const altered=createCSkillCatalog();altered.optionSets.hpThreshold.forEach(o=>o.apDelta=null);
  for(const c of [catalog,altered]) {
   const r=calculate(s,{catalog:c,rules:{...createCSkillRules(),branchAPDelta:{hpCondition:-100}}});
   assert.equal(r.requiredAP,9);assert.equal(r.knownStructureDelta,0);
  }
 }
 assert.equal(Object.hasOwn(createCSkillRules(),"branchAPDelta"),false);
});
test("drawback cap applies to each effect, not sum; negative branch maxima are not zero-clamped", () => {
 const changed=createCSkillCatalog();changed.optionSets.damageAmount.find(o=>o.value===100).apDelta=8;
 const capped=calculate(flat([damage(100,"self"),damage(90,"self")]),{catalog:changed});
 assert.deepEqual(capped.effectBreakdown.map(e=>e.effectDelta),[-5,-4]);assert.equal(capped.optionDelta,-9);assert.equal(capped.rawAP,-4);assert.equal(capped.requiredAP,5);
 const r=calculate(random([[damage(80,"self")],[damage(90,"self")]]));
 assert.equal(r.effectAP,-3);assert.equal(r.rawAP,2);assert.equal(r.requiredAP,5);
 // Exhaustively cover every public drawback's axis combinations via their maximum additive price.
 for(const d of catalog.effects.filter(e=>e.polarity==="drawback")) {
  const options=Object.fromEntries(Object.entries(d.optionAxes).map(([axis,set])=>[axis,catalog.optionSets[set].reduce((a,b)=>a.apDelta>=b.apDelta?a:b).id]));
  const row=calculate(flat([{effectId:d.id,options}])).effectBreakdown[0];
  assert.ok(row.optionPrice<=5,d.id);assert.equal(row.effectDelta,-row.optionPrice,d.id);
 }
});
test("unknown branch prices and invalid/normalized incomplete selections never yield a winner", () => {
 const c=createCSkillCatalog();c.optionSets.damageAmount.find(o=>o.value===70).apDelta=null;
 const cases=[random([[damage(100)],[damage(70)]]),random([[damage(100)],[{effectId:"damage-enemy",options:{}}]]),
 random([[damage(100)],[]]),random([[damage(100)],[{effectId:"damage",targetId:"enemy",options:{amount:""}}]])];
 for(const s of cases) {
  const r=calculate(s,{catalog:c});assert.equal(r.complete,false);assert.equal(r.requiredAP,null);assert.equal(r.effectAP,null);assert.equal(r.selectedBranchPath,null);
  assert.ok(r.errors.length+r.unresolved.length>0);
 }
});
