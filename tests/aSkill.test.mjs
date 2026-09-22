import test from "node:test";
import assert from "node:assert/strict";
import { createASkillCatalog, getATriggerOptions, getAEffectOptions, getAEffectAvailability, matchesATrigger } from "../js/aSkillCatalog.js";
import { calculateASkillResources } from "../js/aSkillResources.js";
import { calculateBuildResources } from "../js/buildResources.js";
import { createBuildRules } from "../js/buildRules.js";
import { createADevCatalog } from "../js/aSkillDevFixtures.js";
import { compileASkill } from "../js/aSkillCompiler.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";

const build = (dice = [0, 0, 0, 1, 1, 1], diceFrame = "light") => ({ diceFrame, dice });
const catalog = createADevCatalog();
const chosen = (effectId, value, chanceOptionId) => ({ effectId,
  ...(value === undefined ? {} : { amountOptionId: `dev-${value}` }),
  ...(chanceOptionId === undefined ? {} : { chanceOptionId }) });
const selection = (effects = [chosen("damage-enemy", 5)], triggerId = "exact:0") => ({ triggerId, effects });
const calc = (s = selection(), b = build(), c = catalog) => calculateASkillResources(b, s, { catalog: c });
const compile = (s = selection(), b = build(), c = catalog) => compileASkill(b, s, { catalog: c });

for (const [frame, faces] of [["light", [1,2,3,4]], ["basic", [2,3,4,5]], ["heavy", [3,4,5,6]]]) {
  test(`${frame}: trigger候補とtrusted価格`, () => {
    const options = getATriggerOptions(frame);
    assert.deepEqual(options.filter(x => x.kind === "exact").map(x => x.value), [0, ...faces]);
    for (const option of options) {
      if (option.kind === "exact") assert.equal(option.pointCost, 0);
      else if (option.kind === "all") { assert.equal(option.pointCost, 2); assert.ok(option.baseFaces.includes(0)); }
      else { assert.ok(!option.baseFaces.includes(0)); assert.equal(option.pointCost, option.baseFaces.length - 1); }
    }
  });
}
test("基礎3 + 共通dice資源: 通常/0追加/0とtriple/全部0", () => {
  for (const [dice, expected] of [[[1,1,2,2,3,4],3], [[0,1,2,2,3,4],4], [[0,1,1,1,2,3],3], [[0,0,0,0,0,0],9]]) {
    const b = build(dice), r = calc(selection(), b);
    assert.equal(r.basePoints,3); assert.equal(r.availablePoints,expected);
    assert.equal(r.dicePoints,calculateBuildResources(b).dice.remaining);
  }
});
test("1〜4件、0/5件拒否、重複benefitの枠コスト", () => {
  for (let count=0; count<=5; count++) {
    const r=calc(selection(Array.from({length:count},()=>chosen("damage-enemy",5))));
    assert.equal(r.complete,count>=1&&count<=4); assert.equal(r.effectCount,count);
    assert.equal(r.benefitSlotCost,Math.max(0,count-1));
    assert.equal(r.benefitCount,count);
    if(count===0||count===5) assert.ok(r.errors.some(e=>e.code==="EFFECT_COUNT"));
  }
});
test("diceOnly同一effectだけ重複不可", () => {
  for (const effect of catalog.effects.filter(item => item.categoryId === "diceOnly")) {
    assert.equal(effect.allowDuplicate, false, effect.id);
    const frame = effect.exactFace <= 4 ? "light" : "heavy";
    const item = chosen(effect.id, effect.requiresAmount ? 1 : undefined);
    const result = calc(selection([item, item], `exact:${effect.exactFace}`), build(undefined, frame));
    assert.equal(result.complete, false, effect.id);
    assert.equal(result.ready, false, effect.id);
    assert.deepEqual(result.errors.filter(error => error.code === "DUPLICATE_EFFECT").map(error => error.path),
      ["effects.1.effectId"], effect.id);
    assert.equal(compile(selection([item, item], `exact:${effect.exactFace}`), build(undefined, frame)).ok, false, effect.id);
  }
});
test("異なるdiceOnly effectはtrusted条件が両方成立すれば併用可能", () => {
  const trustedCatalog = createADevCatalog();
  trustedCatalog.effects.find(item => item.id === "cancel-dice3-heal").exactFace = 1;
  const result = compileASkill(build(), selection([
    chosen("cancel-dice1-ap"), chosen("cancel-dice3-heal"),
  ], "exact:1"), { catalog: trustedCatalog });
  assert.equal(result.ok, true);
  assert.equal(result.resources.errors.some(error => error.code === "DUPLICATE_EFFECT"), false);
  assert.deepEqual(result.skill.effect.map(effect => effect.key), ["skipDice1", "skipDice3"]);
});
test("diceOnly以外は同一effectを引き続き重複可能", () => {
  const repeatable = [
    ["damage-enemy", 5], ["heal-self", 5], ["ap-self-increase", 1],
    ["grant-focus-self", 1], ["remove-crack-self", undefined],
    ["next-at-self-increase", 1], ["phase-at-self-increase", 1],
    ["increase-attacks", 1], ["additional-recoil", 2],
  ];
  for (const [effectId, amount] of repeatable) {
    const item = chosen(effectId, amount);
    const result = calc(selection([item, item]));
    assert.equal(result.errors.some(error => error.code === "DUPLICATE_EFFECT"), false, effectId);
    assert.equal(result.complete, true, effectId);
  }
});
test("benefit +2/+1 drawback -1ではslot=1、数量別還元と重複drawback", () => {
  const r=calc(selection([chosen("damage-enemy",10),chosen("heal-self",5),chosen("damage-self",5)]));
  assert.equal(r.benefitCount,2); assert.equal(r.drawbackCount,1); assert.equal(r.benefitSlotCost,1);
  assert.equal(r.effectCost,3); assert.equal(r.drawbackPoints,1); assert.equal(r.netCost,3);
  const d=calc(selection([chosen("additional-recoil",5),chosen("additional-recoil",5)]));
  assert.equal(d.benefitSlotCost,0); assert.equal(d.drawbackPoints,8); assert.equal(d.netCost,-8);
});
test("chance割引は個別に下限0、無料benefitにも追加枠コスト", () => {
  const r=calc(selection([chosen("damage-enemy",5,"10"),chosen("damage-enemy",10,"25")]));
  assert.equal(r.baseEffectCost,3); assert.equal(r.chanceDiscount,3); assert.equal(r.effectCost,0);
  assert.equal(r.benefitSlotCost,1); assert.equal(r.netCost,1);
  assert.deepEqual(r.effectBreakdown.map(x=>x.chanceDiscount),[3,2]);
});
test("drawback chanceは100以外拒否、unknown chance拒否、100 canonical省略", () => {
  for(const chance of ["50","25","10","bogus",1,null]) assert.equal(compile(selection([chosen("damage-self",5,chance)])).ok,false);
  for(const chance of [undefined,"100"]) assert.ok(compile(selection([chosen("damage-self",5,chance)])).ok);
  assert.equal(compile(selection([chosen("damage-enemy",5,"100")])).skill.effect[0].chance,undefined);
  assert.equal(compile(selection([chosen("damage-enemy",5,"50")])).skill.effect[0].chance,.5);
});
test("初期6枠のfrequency 0〜6、rangeの0除外、allの0含有", () => {
  for(let n=0;n<=6;n++) {
    const dice=Array.from({length:6},(_,i)=>i<n?0:[1,2,3,4,1,2][i]);
    const r=calc(selection(),build(dice));
    assert.equal(r.frequencyCount,n); assert.equal(r.frequencyRank,n===0?null:Math.ceil(n/2));
  }
  const b=build([0,0,1,2,3,4]);
  assert.equal(calc(selection(undefined,"lte:3"),b).frequencyCount,3);
  assert.equal(calc(selection(undefined,"gte:3"),b).frequencyCount,2);
  assert.equal(calc(selection(undefined,"all"),b).frequencyCount,6);
  for(const kind of ["lte","gte"]) assert.equal(matchesATrigger({kind,value:3},0),false);
  assert.ok(matchesATrigger({kind:"all"},0)); assert.ok(matchesATrigger({kind:"gte",value:3},5));
});
test("専用effectはexactのみ、全候補にdisabled理由", () => {
  const special=catalog.effects.filter(e=>e.exactFace!=null); assert.equal(special.length,6);
  for(const e of special) {
    const frame=e.exactFace<=4?"light":"heavy";
    assert.ok(getAEffectAvailability(e.id,frame,`exact:${e.exactFace}`,catalog).selectable);
    for(const trigger of ["all","exact:0","gte:3","lte:3"]) {
      assert.equal(getAEffectAvailability(e.id,frame,trigger,catalog).selectable,false);
      assert.equal(compile(selection([chosen(e.id,e.requiresAmount?1:undefined)],trigger),build(undefined,frame)).ok,false);
    }
  }
  assert.ok(getAEffectOptions("light","all",catalog).flatMap(x=>x.effects).filter(e=>e.exactFace).every(e=>e.reason));
});
test("STATUS_GROUPS全8種類、random付与、1stack解除、phase公開方向", () => {
  assert.deepEqual(new Set(catalog.statuses.map(s=>s.id)),new Set(STATUS_GROUPS.all));
  for(const group of ["buff","debuff"]) for(const target of ["self","enemy"]) {
    const e=catalog.effects.find(e=>e.id===`grant-random-${group}-${target}`);
    assert.equal(e.polarity,((group==="debuff")===(target==="self"))?"drawback":"benefit");
    for(const status of STATUS_GROUPS[group]) {
      const remove=catalog.effects.find(e=>e.id===`remove-${status}-${target}`);
      assert.equal(remove.semantics.value,-1);
      assert.notEqual(remove.polarity,e.polarity);
    }
  }
  assert.deepEqual(catalog.effects.filter(e=>e.semantics.type==="addBuff").map(e=>[e.targetId,e.semantics.stat,e.semantics.sign]),
    [["self","AT",1],["self","AT",-1],["enemy","DF",1],["enemy","DF",-1]]);
  assert.equal(catalog.effects.filter(e=>e.categoryId==="nextAttack").length,4);
});
test("順序と重複をcanonicalへ保持、100%省略", () => {
  const s=selection([chosen("damage-self",5),chosen("heal-self",10),chosen("damage-self",5)]);
  const r=compile(s); assert.ok(r.ok);
  assert.deepEqual(r.skill.trigger,{kind:"exact",value:0});
  assert.deepEqual(r.skill.effect,[{type:"fixedDamage",target:"self",amount:5},{type:"heal",target:"self",amount:10},{type:"fixedDamage",target:"self",amount:5}]);
});
test("予算超過は見積完了でもcompile拒否", () => {
  const s=selection(Array.from({length:4},()=>chosen("damage-enemy",20)));
  assert.equal(calc(s).complete,true); assert.equal(calc(s).ready,false);
  assert.equal(compile(s).ok,false); assert.ok(compile(s).errors.some(e=>e.code==="INSUFFICIENT_A_POINTS"));
});
test("raw effect/value/target/status/cost/chanceなど未知field拒否", () => {
  for(const key of ["effect","target","status","direction","value","amount","pointCost","drawbackPoints","chance","duration","type","key","op","__proto__"]) {
    const e=Object.fromEntries([...Object.entries(chosen("damage-enemy",5)),[key,999]]);
    const r=compile(selection([e])); assert.equal(r.ok,false,key); assert.ok(r.errors.some(x=>x.code==="UNKNOWN_FIELD"),key);
    assert.equal(compile({...selection(),[key]:999}).ok,false,key);
  }
  for(const e of [null,{effectId:"revive"},{effectId:"constructor"},{effectId:"damage-enemy",amountOptionId:5}]) assert.equal(compile(selection([e])).ok,false);
  assert.equal(compile(null).ok,false);
});
test("不正初期diceはcompile不可（Dの追加とは別）", () => {
  for(const dice of [[0], [0,0,0,0,0,0,0], [0,0,1,2,3,5], [0,0,1,1,1,1], [1,1,1,2,3,4], [0,0,0,0,0,NaN]]) assert.equal(compile(selection(),build(dice)).ok,false);
});
test("production未確定はnull、fixtureは本番を汚染しない", () => {
  const prod=createASkillCatalog(), before=structuredClone(prod); createADevCatalog();
  assert.deepEqual(createASkillCatalog(),before);
  assert.ok(prod.effects.every(e=>e.amountOptions.length===0 && e.pointCost===null));
  assert.equal(compile(selection(),build(),prod).ok,false);
  const r=calc(selection([chosen("cancel-self-attack")]),build(),prod);
  assert.equal(r.drawbackPoints,null); assert.ok(r.unresolved.length);
  const c=createADevCatalog(); c.chanceOptions.find(x=>x.id==="50").discount=null;
  const pending=calc(selection([chosen("damage-enemy",5,"50"),chosen("heal-self",5)]),build(),c);
  assert.equal(pending.effectCost,null); assert.equal(pending.knownEffectCost,1); assert.equal(pending.remaining,null);
});
test("入力/catalog/rulesをmutationしない、出力も参照共有しない", () => {
  const b=build(), c=createADevCatalog(), rules=createBuildRules(), s=selection([chosen("phase-at-self-increase",1)]);
  const before=structuredClone({b,c,rules,s});
  const freeze=x=>{ if(x&&typeof x==="object") { Object.values(x).forEach(freeze); Object.freeze(x); } };
  [b,c,rules,s].forEach(freeze);
  const r=compileASkill(b,s,{catalog:c,rules}); assert.ok(r.ok);
  getAEffectOptions(b.diceFrame,s.triggerId,c);
  r.skill.effect[0].duration.kind="turns";
  assert.deepEqual({b,c,rules,s},before);
});
test("ランダム付与は指定付与と同じ仮価格、frequencyを価格に使用しない", () => {
  for(const group of ["buff","debuff"]) {
    const target=group==="buff"?"self":"enemy";
    assert.equal(calc(selection([chosen(`grant-random-${group}-${target}`,2)])).netCost,
      calc(selection([chosen(`grant-${STATUS_GROUPS[group][0]}-${target}`,2)])).netCost);
  }
  assert.equal(calc(selection(),build([0,0,0,0,0,0])).netCost,calc(selection(),build([0,1,2,2,3,4])).netCost);
});
