import test from "node:test";
import assert from "node:assert/strict";
import { createASkillCatalog, getATriggerOptions } from "../js/aSkillCatalog.js";
import { compileASkill } from "../js/aSkillCompiler.js";
import { calculateASkillResources } from "../js/aSkillResources.js";
import { migrateSelection, resolveSelection } from "../js/selectionNormalization.js";
import { aEditorLeaf, aNormalSlots, aEditorCatalog, aCancelAvailable, setAAttackCancel, addANormalEffect, removeANormalEffect, changeAClause, changeATrigger } from "../js/aSkillSentenceEditor.js";
import { aDrawbackText } from "../js/aSkillPresentation.js";
const catalog = createASkillCatalog(), duck = { diceFrame: "normal", dice: [1,2,3,4,5,6] };
const start = (triggerId="exact:1") => ({ triggerId, effects: [] });
const rows = s => aEditorCatalog(duck,s,catalog).flatMap(d=>d.variants);
const v2 = (id, amount) => migrateSelection("A", {effects:[{effectId:id,...(amount?{amountOptionId:`amount-${amount}`}:{})}]},catalog).effects[0];
function edit(s, index, key, value, build=duck) { return changeAClause(s,index,key,value,build,catalog); }

test("cancel is independent, idempotent, retains four normal slots and their order",()=>{
  let s=start();
  for(let i=0;i<4;i++) {
    s=addANormalEffect(s,catalog);s=edit(s,i,"effectId","heal");s=edit(s,i,"targetId","enemy");s=edit(s,i,"options.amount","amount-5");
  }
  assert.equal(addANormalEffect(s,catalog),s);
  const original=structuredClone(s);
  s=setAAttackCancel(s,true,duck,catalog);
  assert.equal(s.effects.length,5);assert.equal(aNormalSlots(s,catalog).length,4);
  assert.equal(setAAttackCancel(s,true,duck,catalog),s);
  assert.equal(compileASkill(duck,s).ok,true);
  assert.deepEqual(setAAttackCancel(s,false,duck,catalog),original);
  assert.equal(removeANormalEffect(s,0,catalog).effects.length,4);
  assert.equal(compileASkill(duck,setAAttackCancel(start(),true,duck,catalog)).ok,false);
});

test("all production variants can be built through normalized clauses; no removed variants or probabilities",()=>{
  for(const group of catalog.selectionEffects) for(const r of group.variants) {
    if(r.definition.cancelsNormalAttack) continue;
    let s=addANormalEffect(start(r.definition.exactFace ? `exact:${r.definition.exactFace}` : "exact:1"),catalog);
    s=edit(s,0,"effectId",r.effectId);s=edit(s,0,"targetId",r.targetId);
    if(r.statusId) s=edit(s,0,"statusId",r.statusId);
    for(const amount of r.optionAxes.amount ?? [null]) {
      const next=amount?edit(s,0,"options.amount",amount.id):s;
      const resolved=resolveSelection("A",next,catalog);
      assert.deepEqual(resolved.errors,[],r.legacyId);assert.deepEqual(resolved.incomplete,[],r.legacyId);
      assert.equal(resolved.selection.effects[0].effectId,r.legacyId);
      assert.equal(Object.hasOwn(next.effects[0],"chanceOptionId"),false);
      assert.equal(Object.hasOwn(next.effects[0],"amountOptionId"),false);
      assert.equal(aDrawbackText(r),r.definition.polarity==="drawback"?"（デメリット）":"");
    }
  }
  const s=addANormalEffect(start(),catalog);
  assert.equal(edit(s,0,"targetId","bogus"),s);
  assert.equal(edit(s,0,"effectId","ap-self-decrease"),s);
  assert.ok(rows(start()).filter(r=>r.effectId==="remove-random-status").every(r=>r.statusId.startsWith("@")));
  assert.ok(rows(start()).some(r=>r.statusId==="@buff"));assert.ok(rows(start()).some(r=>r.statusId==="@debuff"));
});

for(const d of catalog.effects.filter(d=>d.conflictsWithAttackCancel)) test(`bidirectional cancel availability and saved preservation: ${d.id}`,()=>{
  const s={triggerId:`exact:${d.exactFace??1}`,effects:[v2(d.id,d.amountOptions[0]?.value)]};
  const before=structuredClone(s);
  assert.equal(aCancelAvailable(duck,s,catalog),false);
  assert.equal(setAAttackCancel(s,true,duck,catalog),s);
  const on=setAAttackCancel(start(s.triggerId),true,duck,catalog);
  assert.ok(!rows(on).some(r=>r.legacyId===d.id));
  const invalid={...s,effects:[...s.effects,...on.effects]},copy=structuredClone(invalid);
  aEditorCatalog(duck,invalid,catalog);invalid.effects.forEach(e=>aEditorLeaf(e,catalog));
  assert.equal(compileASkill(duck,invalid).ok,false);assert.deepEqual(invalid,copy);assert.deepEqual(s,before);
  assert.deepEqual(setAAttackCancel(invalid,false,duck,catalog),s);
});

test("dice-only candidates follow exact and skips 1/3/4/5 survive cancel",()=>{
  for(const t of getATriggerOptions(duck,catalog)) {
    const s=start(t.id), exact=rows(s).filter(r=>r.definition.exactFace!=null);
    assert.ok(exact.every(r=>t.id===`exact:${r.definition.exactFace}`));
    if(t.kind!=="exact") assert.equal(exact.length,0);
  }
  for(const face of [1,3,4,5]) {
    let s=setAAttackCancel(start(`exact:${face}`),true,duck,catalog);
    const r=rows(s).find(r=>r.definition.exactFace===face);
    assert.ok(r);s=addANormalEffect(s,catalog);s=edit(s,1,"effectId",r.effectId);s=edit(s,1,"targetId","self");
    assert.equal(compileASkill(duck,s).ok,true);
  }
});

test("parent edits clear downstream only in that leaf; external dice/trigger changes and invalid legacy reads do not repair",()=>{
  let s={triggerId:"exact:1",effects:[v2("grant-crack-enemy",3),v2("cancel-dice1-ap")]};
  const old=structuredClone(s);
  s=edit(s,0,"targetId","self");assert.equal(s.effects[0].statusId,undefined);assert.equal(s.effects[0].options.amount,undefined);
  assert.deepEqual(s.effects[1],old.effects[1]);
  s=edit(s,0,"effectId","heal");assert.equal(s.effects[0].statusId,undefined);assert.equal(s.effects[0].options.amount,undefined);
  const invalid={...old,triggerId:"all"};const copy=structuredClone(invalid);
  aEditorCatalog(duck,invalid,catalog);assert.deepEqual(invalid,copy);assert.equal(compileASkill(duck,invalid).ok,false);
  for(const leaf of [{effectId:"ap-self-decrease",amountOptionId:"amount-1"}, {...v2("heal-self",5),options:{amount:"invalid"}}, {...v2("heal-self",5),chanceOptionId:"50"}]) {
    const saved=structuredClone(leaf);aEditorLeaf(leaf,catalog);assert.deepEqual(leaf,saved);
    assert.equal(compileASkill(duck,{...start(),effects:[leaf]}).ok,false);
  }
  const custom={diceFrame:"light",dice:[0,0,0,2,2,2]}, snapshot=structuredClone(old);
  aEditorCatalog(custom,old,catalog);assert.deepEqual(old,snapshot);assert.equal(compileASkill(custom,old).ok,false);
});

test("legacy compatibility and cancel rebates use existing resource calculation",()=>{
  const legacy={effectId:"heal-enemy",amountOptionId:"amount-5"};
  assert.deepEqual(aEditorLeaf(legacy,catalog),v2("heal-enemy",5));
  for(const [build,id,refund] of [[duck,"exact:1",1],[duck,"lte:3",2],[duck,"all",3]]) {
    const s=setAAttackCancel({triggerId:id,effects:[aEditorLeaf(legacy,catalog)]},true,build,catalog);
    assert.equal(calculateASkillResources(build,s).cancelDrawbackPoints,refund);
  }
});

test("trigger edits retain exact variant identity without changing compiler or normalized schema",()=>{
  for(const oldFace of [1,3,4,5]) for(const newFace of [1,2,3,4,5,6]) {
    let s=addANormalEffect(start(`exact:${oldFace}`),catalog);
    s=edit(s,0,"effectId","cancel-dice-effect");s=edit(s,0,"targetId","self");
    const before=structuredClone(s), changed=changeATrigger(s,`exact:${newFace}`,duck,catalog);
    assert.deepEqual(s,before);
    assert.equal(changed.effects[0].options.diceAction,String(oldFace));
    assert.equal(compileASkill(duck,changed).ok,oldFace===newFace);
    assert.equal(compileASkill(duck,changeATrigger(changed,`exact:${oldFace}`,duck,catalog)).ok,true);
  }
  const s=start();assert.equal(changeATrigger(s,"exact:0",duck,catalog),s);
});
