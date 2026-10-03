import test from "node:test";
import assert from "node:assert/strict";
import { createASkillCatalog, getATriggerOptions } from "../js/aSkillCatalog.js";
import { migrateSelection } from "../js/selectionNormalization.js";
import { compileASkill } from "../js/aSkillCompiler.js";
import { calculateASkillResources } from "../js/aSkillResources.js";
import { aTriggerText, aTriggerEditor, aEffectParts, presentASkill } from "../js/aSkillPresentation.js";

const catalog = createASkillCatalog(), build = { diceFrame: "preset-standard", dice: [1,2,3,4,5,6] };
const legacy = (effectId, amount) => ({ effectId, ...(amount == null ? {} : { amountOptionId: `amount-${amount}` }) });
const selection = (effectId, amount, triggerId = "exact:1") => migrateSelection("A", { triggerId, effects: [legacy(effectId, amount)] }, catalog);
const text = (effectId, amount, triggerId) => presentASkill(build, selection(effectId, amount, triggerId)).text;

for (const [id, expected] of [["exact:2", "出目【2】が出た時、"], ["gte:3", "出目【3以上】が出た時、"],
  ["lte:4", "出目【4以下】が出た時、"], ["all", "全ての出目で、"]]) {
  test(`formal trigger ${id}`, () => {
    assert.equal(aTriggerText(id), expected);
    assert.equal(text("heal-self", 5, id), `${expected}自分のHPを5回復する`);
  });
}

for (const [id, amount, expected] of [
  ["heal-self",5,"自分のHPを5回復する"], ["heal-enemy",10,"相手のHPを10回復する（デメリット）"],
  ["ap-self-increase",1,"自分のAPを1増加する"], ["ap-enemy-decrease",2,"相手のAPを2減少する"],
  ["next-at-self-increase",3,"自分が次に与える通常攻撃のATを3増加する"],
  ["next-at-enemy-decrease",5,"相手が次に与える通常攻撃のATを5減少する"],
  ["damage-enemy",3,"相手に固定3ダメージを与える"],
  ["grant-crack-enemy",2,"相手に亀裂を2付与する"],
  ["grant-random-debuff-enemy",2,"相手にランダムな状態異常を2付与する"],
  ["grant-random-buff-self",3,"自分にランダムな状態強化を3付与する"],
  ["grant-random-buff-enemy",1,"相手にランダムな状態強化を1付与する（デメリット）"],
  ["remove-random-buff-enemy",2,"相手のランダムな状態強化を2解除する"],
  ["remove-random-debuff-self",3,"自分のランダムな状態異常を3解除する"],
  ["remove-random-debuff-enemy",1,"相手のランダムな状態異常を1解除する（デメリット）"],
  ["phase-at-self-increase",2,"自分のATを現在フェイズ中だけ2増加する"],
  ["phase-df-enemy-decrease",3,"相手のDFを現在フェイズ中だけ3減少する"],
  ["increase-attacks",1,"自分の通常攻撃回数を現在フェイズ中だけ1増加する"],
  ["additional-recoil",4,"自分の通常攻撃に現在フェイズ中だけ反動を4付与する（デメリット）"],
]) test(`formal effect ${id}`, () => assert.equal(text(id,amount), `出目【1】が出た時、${expected}`));

for (const [face,id,amount,body] of [
  [1,"cancel-dice1-ap",null,"AP増加"], [2,"reduce-dice2-attacks",null,"通常攻撃回数増加"],
  [3,"cancel-dice3-heal",null,"HP回復"], [4,"cancel-dice4-counter",null,"反撃付与"],
  [5,"cancel-dice5-ap",null,"AP減少"], [6,"reduce-dice6-recoil",3,"反動"],
]) test(`dice ${face} wording does not repeat face; polarity is catalog-owned`, () => {
  const result=presentASkill(build,selection(id,amount,`exact:${face}`));
  assert.equal(result.effects[0].text,`ダイス効果の${body}をキャンセルする${face===6?"":"（デメリット）"}`);
  assert.equal((result.text.match(/出目/g)??[]).length,1);
});

test("full skill uses plus separators, cancel first, normal effects in saved order", () => {
  const s=migrateSelection("A",{triggerId:"exact:5",effects:[legacy("grant-random-debuff-enemy",2),
    legacy("cancel-self-attack"),legacy("grant-random-buff-self",2)]},catalog);
  const before=structuredClone(s);
  assert.equal(presentASkill(build,s).text,"出目【5】が出た時、通常攻撃をキャンセルする（デメリット）＋相手にランダムな状態異常を2付与する＋自分にランダムな状態強化を2付与する");
  assert.deepEqual(s,before);
  const other=migrateSelection("A",{triggerId:"exact:1",effects:[legacy("heal-self",5),legacy("cancel-dice1-ap")]},catalog);
  assert.equal(presentASkill(build,other).text,"出目【1】が出た時、自分のHPを5回復する＋ダイス効果のAP増加をキャンセルする（デメリット）");
});

test("all trusted variants and amounts preserve compiled meaning, resources, catalog and legacy input", () => {
  const beforeCatalog=structuredClone(catalog);
  for(const d of catalog.effects) for(const amount of d.requiresAmount?d.amountOptions:[null]) {
    const old={triggerId:`exact:${d.exactFace??1}`,effects:[legacy(d.id,amount?.value)]};
    if(d.cancelsNormalAttack) old.effects.push(legacy("heal-enemy",5));
    const normalized=migrateSelection("A",old,catalog);
    for(const s of [old,normalized]) {
      const original=structuredClone(s), compiled=compileASkill(build,s), resources=calculateASkillResources(build,s);
      const result=presentASkill(build,s,{catalog});
      assert.equal(result.complete,true,d.id);
      assert.equal(result.effects[0].text.endsWith("（デメリット）"),d.polarity==="drawback",d.id);
      assert.doesNotMatch(result.text,/phase|stack|undefined|＆/);
      assert.deepEqual(s,original);
      assert.deepEqual(compileASkill(build,s),compiled);
      assert.deepEqual(calculateASkillResources(build,s),resources);
      assert.equal(presentASkill(build,JSON.parse(JSON.stringify(s))).text,result.text);
    }
    assert.equal(presentASkill(build,old).text,presentASkill(build,normalized).text);
  }
  assert.deepEqual(catalog,beforeCatalog);
});

test("invalid, stale and incomplete selections never fabricate a complete description or repair values", () => {
  const leaves=[{effectId:"",targetId:"",options:{}},
    {effectId:"heal",targetId:"self",options:{}},
    {effectId:"damage",targetId:"",options:{amount:"amount-3"}},
    {effectId:"heal",targetId:"self",options:{amount:"amount-999"}},
    {effectId:"grant-status",targetId:"enemy",statusId:"obsolete",options:{amount:"amount-2"}},
    {effectId:"obsolete",targetId:"self",options:{}}, legacy("obsolete",1),
    {effectId:"cancel-dice-effect",targetId:"self",options:{diceAction:"3"}},
    {effectId:"change-ap",targetId:"self",options:{amount:"amount-1"}},
    {...legacy("heal-self",5),chanceOptionId:"50"}];
  const bad=[...leaves.map(leaf=>({triggerId:"exact:1",effects:[leaf]})),
    selection("heal-self",5,"exact:999"),{triggerId:"all",effects:[]},null,
    {triggerId:"all",effects:[legacy("cancel-dice1-ap")]},
    {triggerId:"exact:1",effects:[legacy("cancel-self-attack"),legacy("increase-attacks",1)]}];
  for(const s of bad) {
    const before=structuredClone(s),result=presentASkill(build,s);
    assert.equal(result.complete,false,JSON.stringify(s));assert.equal(result.text,null);
    assert.deepEqual(s,before);
  }
  const s=selection("heal-self",5,"exact:6");
  assert.equal(presentASkill({diceFrame:"custom-speed",dice:[1,2,3,4,0,0]},s).text,null);
});

test("trigger controls only project existing legal options, including sparse and zero dice", () => {
  for(const duck of [build,{diceFrame:"custom-speed",dice:[0,0,1,1,3,4]},{diceFrame:"preset-void",dice:[0,0,0,0,0,0]}]) {
    const legal=getATriggerOptions(duck);
    for(const current of ["","exact:99",...legal.map(option=>option.id)]) {
      const model=aTriggerEditor(legal,current);
      for(const field of model.fields) for(const option of field.options) assert.ok(option.disabled || legal.some(row=>row.id===option.id));
      if(current==="all") assert.equal(model.fields.length,1);
    }
  }
});

test("sentence tokens leave unresolved values unresolved and do not guess drawback", () => {
  const rows=catalog.selectionEffects.find(d=>d.id==="heal").variants;
  assert.deepEqual(aEffectParts("heal",rows),[{key:"targetId"},"のHPを",{key:"options.amount"},"回復する"]);
  assert.deepEqual(aEffectParts("obsolete",[]),[]);
});
