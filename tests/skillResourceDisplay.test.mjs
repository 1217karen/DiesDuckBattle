import test from "node:test";
import assert from "node:assert/strict";
import { formatCRequiredAP } from "../js/skillResourceDisplay.js";
import { calculateCSkillResources } from "../js/cSkillResources.js";
import { createCSkillRules } from "../js/cSkillRules.js";
const damage=(amount,target="enemy")=>({effectId:"damage",targetId:target,options:{amount:"damageAmount-"+amount}});
const rules=createCSkillRules();
const flat=effects=>({mode:"normal",structure:{kind:"flat",effects}});
for(const [effects,formula] of [
 [[damage(50),damage(60),damage(50)],"必要AP：最低AP5＋0＋2＋1＝8"],
 [[damage(70,"self")],"必要AP：最低AP5－2 → 最低5AP＝5"],
 [[{effectId:"damage",targetId:"enemy",options:{}}],"必要AP：—"],
 [[],"必要AP：—"],
]) test("C formula from production resources: "+formula,()=>{
 const selection=flat(effects),before=structuredClone(selection),r=calculateCSkillResources(selection),snapshot=structuredClone(r);
 assert.equal(formatCRequiredAP(r,rules),formula);assert.deepEqual(r,snapshot);assert.deepEqual(selection,before);
 if(r.complete)assert.ok(formula.endsWith("＝"+r.requiredAP));
});
for(const kind of ["random","hpCondition"]) test(kind+" formula includes only selected maximum branch",()=>{
 const low={effects:[damage(60)]},high={effects:[damage(50),damage(70)]};
 const structure=kind==="random"?{kind,branches:[low,high]}:{kind,thresholdOptionId:"hpThreshold-0.5",branches:{met:low,unmet:high}};
 const r=calculateCSkillResources({mode:"normal",structure});
 assert.equal(r.complete,true,JSON.stringify(r));assert.equal(r.selectedBranchPath,kind==="random"?"structure.branches.1":"structure.branches.unmet");
 assert.equal(formatCRequiredAP(r,rules),"必要AP：最低AP5＋0＋3＝8");
});
test("display takes base and floor from supplied resource/rules, not literal five",()=>{
 const custom={...rules,baseAP:7,minimumAP:6},r=calculateCSkillResources(flat([damage(70,"self")]),{rules:custom});
 assert.equal(formatCRequiredAP(r,custom),"必要AP：最低AP7－2 → 最低6AP＝6");
});
