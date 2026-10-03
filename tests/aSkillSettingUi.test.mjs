import test from "node:test";
import { loadSettingPage } from "./settingPageHarness.mjs";
import { migratePlayerBuild } from "../js/playerBuildMigration.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PLAYER_BUILD_STORAGE_KEY } from "../js/playerBuildStorage.js";
import { createEmptyDuck, createEmptyPlayerBuild } from "../js/playerBuildModel.js";
import { compileASkill } from "../js/aSkillCompiler.js";
import { calculateASkillResources } from "../js/aSkillResources.js";

// Exercise the real settingPage handlers with an in-memory DOM/online adapter, no browser dependency.
async function page(build = createEmptyPlayerBuild()) {
  class Element {
    constructor(tag) { this.tagName=tag; this.children=[]; this.handlers={}; this.attributes={}; this.value=""; this.classList={toggle(){}}; }
    append(...children) { for (const child of children) { child.parent=this; this.children.push(child); } }
    replaceChildren(...children) { this.children=[]; this.append(...children); }
    setAttribute(key,value) { this.attributes[key]=value; }
    addEventListener(type,handler) { this.handlers[type]=handler; }
    focus() {} showModal() { this.open=true; } close() { this.open=false; this.handlers.close?.(); }
    remove() { this.parent.children=this.parent.children.filter(e=>e!==this); }
    set textContent(value) { this.text=String(value); this.children=[]; }
    get textContent() { return (this.text??"")+this.children.map(e=>e.textContent).join(""); }
  }
  const body=new Element("body"), all=()=>{const walk=e=>[e,...e.children.flatMap(walk)];return walk(body);};
  const html=await readFile(new URL("../setting.html",import.meta.url),"utf8");
  for(const match of html.matchAll(/\bid="([^"]+)"/g)) {const e=new Element("div");e.id=match[1];body.append(e);}
  const document={body,createElement:tag=>new Element(tag),getElementById:id=>all().find(e=>e.id===id)};
  const values=new Map([[PLAYER_BUILD_STORAGE_KEY,JSON.stringify(build)]]);
  globalThis.document=document; globalThis.window={addEventListener(){}};
  globalThis.localStorage={getItem(){throw Error("local read forbidden");},setItem(){throw Error("local write forbidden");}};
  await loadSettingPage(build, saved => values.set(PLAYER_BUILD_STORAGE_KEY, JSON.stringify(saved)));
  return { get:id=>document.getElementById(id), all,
    choose(id,value) {const e=this.get(id);assert.ok(e,`missing ${id}`);assert.ok(e.children.flatMap(o=>o.tagName==="optgroup"?o.children:[o]).some(o=>o.value===value&&!o.disabled),`illegal ${id}/${value}`);e.value=value;e.handlers.change();},
    save() { this.get("save").handlers.click();const confirm=all().find(e=>e.tagName==="button"&&e.textContent==="このまま保存");confirm?.handlers.click();
      assert.equal(this.get("save-message").textContent,"変更はありません");return JSON.parse(values.get(PLAYER_BUILD_STORAGE_KEY)); },
  };
}


function initial(aSelection=null) {
  const b=createEmptyPlayerBuild();b.ducks.push({...createEmptyDuck({idFactory:()=>"a-ui"}),stats:{AT:3,DF:3,SP:2},diceFrame:"preset-standard",dice:[1,2,3,4,5,6],aSelection});return b;
}
const heal={effectId:"heal",targetId:"enemy",options:{amount:"amount-5"}};
const sentenceText = element => element.tagName === "select"
  ? element.children.find(option => option.value === element.value)?.textContent ?? ""
  : (element.text ?? "") + element.children.map(sentenceText).join("");
test("A setting UI: enable, current trigger prices, independent cancel plus four slots, v2 save/reload",async()=>{
  let p=await page(initial());assert.ok(p.get("a-trigger"));assert.ok(p.get("a-effect-0"));
  assert.equal(p.get("a-enabled"),undefined);
  p.choose("a-trigger","exact:1");p.choose("a-cancel","on");
  for(let i=0;i<4;i++) {
    if(i) p.get("a-add-effect").handlers.click();p.choose(`a-effect-${i}`,"heal");p.choose(`a-effect-${i}-targetId`,"enemy");p.choose(`a-effect-${i}-options.amount`,"amount-5");
  }
  assert.equal(p.get("a-add-effect").disabled,true);
  assert.equal(sentenceText(p.get("a-sentence-0")),"相手のHPを5回復する（デメリット）");
  assert.equal(p.all().some(e=>e.tagName==="select" && /成功率|50%|25%|10%/.test(e.textContent)),false);
  const saved=p.save(),selection=saved.ducks[0].aSelection;
  assert.equal(selection.effects.length,5);assert.equal(compileASkill(saved.ducks[0],selection).ok,true);
  assert.ok(selection.effects.every(e=>Object.hasOwn(e,"targetId")));
  p=await page(saved);assert.equal(p.get("a-cancel").value,"on");assert.equal(p.get("a-effect-3-options.amount").value,"amount-5");
  p.choose("a-cancel","off");assert.deepEqual(p.save().ducks[0].aSelection.effects,[heal,heal,heal,heal]);
});

test("A setting UI: dice invalidates trigger in place, preserves effect, disabled trigger and refreshed candidates",async()=>{
  const b=initial({triggerId:"exact:6",effects:[heal]});const p=await page(b);
  p.choose("dice-type","custom-speed");assert.equal(p.get("a-trigger").value,"exact:6");
  assert.equal(p.get("a-trigger").children.find(e=>e.value==="exact:6").disabled,true);
  assert.match(p.get("a-trigger").textContent,/現在は使用不可：出目【6】が出た時、/);
  assert.equal(p.get("a-effect-0").value,"heal");
  p.choose("dice-0","2");assert.equal(p.get("a-trigger").children.find(e=>e.value==="exact:1").disabled,true);
  p.choose("a-trigger","exact:2");assert.equal(p.get("a-effect-0-options.amount").value,"amount-5");
});

test("A setting UI: status/random choices, downstream reset, and exact skip retains identity across trigger changes",async()=>{
  const p=await page(initial({triggerId:"exact:1",effects:[heal]}));
  p.choose("a-effect-0","grant-status");assert.equal(p.get("a-effect-0-options.amount").value,"");
  for(const value of ["crack","@buff","@debuff"]) assert.ok(p.get("a-effect-0-statusId").children.some(e=>e.value===value));
  p.choose("a-effect-0-statusId","@debuff");p.choose("a-effect-0-options.amount","amount-2");
  p.choose("a-effect-0","remove-random-status");assert.equal(p.get("a-effect-0-options.amount").value,"");
  assert.equal(p.get("a-effect-0-statusId").children.some(e=>e.value==="crack"),false);
  p.choose("a-effect-0-targetId","self");p.choose("a-effect-0","cancel-dice-effect");
  p.choose("a-trigger","exact:3");
  assert.match(p.get("a-effect-0").textContent,/現在は使用不可：ダイス効果のAP増加/);
  assert.equal(p.get("a-effect-0").value,"cancel-dice-effect");
  assert.match(p.get("a-issues").textContent,/一致しません/);
  p.choose("a-trigger","exact:1");assert.equal(sentenceText(p.get("a-sentence-0")),"ダイス効果のAP増加をキャンセルする（デメリット）");
});

test("A setting UI: both conflict directions, invalid saved leaves and cancellation OFF preserve normal effects",async()=>{
  const conflict={effectId:"change-attacks",targetId:"self",options:{amount:"amount-1"}};
  let p=await page(initial({triggerId:"exact:1",effects:[conflict]}));
  assert.equal(p.get("a-cancel").children.find(o=>o.value==="on").disabled,true);
  p=await page(initial({triggerId:"exact:1",effects:[{effectId:"cancel-attack",targetId:"self",options:{}},conflict]}));
  assert.equal(p.get("a-effect-0").value,"change-attacks");assert.equal(p.get("a-effect-0").children.find(o=>o.value==="change-attacks").disabled,true);
  assert.match(p.get("a-issues").textContent,/併用できません/);
  p.choose("a-cancel","off");assert.equal(p.get("a-effect-0-options.amount").tagName,"span");
  assert.equal(p.get("a-effect-0-options.amount").textContent,"1");
  const bad={effectId:"grant-status",targetId:"self",statusId:"obsolete",options:{amount:"amount-999"},chanceOptionId:"50"};
  p=await page(initial({triggerId:"exact:1",effects:[bad]}));
  assert.equal(p.get("a-effect-0-statusId").value,"obsolete");assert.equal(p.get("a-effect-0-options.amount").value,"amount-999");
  assert.match(p.get("a-issues").textContent,/成功率/);
});

test("A setting UI: explicitly converted legacy fixture keeps compiled meaning (online page does not migrate local data)",async()=>{
  const b=initial({triggerId:"exact:1",effects:[{effectId:"heal-enemy",amountOptionId:"amount-5"}]});b.schemaVersion=1;
  const original=compileASkill(b.ducks[0],b.ducks[0].aSelection);
  const p=await page(migratePlayerBuild(b).build);assert.equal(p.get("a-effect-0").value,"heal");assert.equal(p.get("a-effect-0-options.amount").value,"amount-5");
  const saved=p.save();assert.equal(saved.schemaVersion,2);
  assert.deepEqual(compileASkill(saved.ducks[0],saved.ducks[0].aSelection),original);
});

test("A setting UI: unavailable v2 effect remains a disabled saved value",async()=>{
  const p=await page(initial({triggerId:"exact:1",effects:[{effectId:"obsolete-effect",targetId:"self",options:{amount:"amount-1"}}]}));
  assert.equal(p.get("a-effect-0").value,"obsolete-effect");
  assert.equal(p.get("a-effect-0").children.find(o=>o.value==="obsolete-effect").disabled,true);
  p.choose("a-effect-0","heal");assert.equal(p.get("a-effect-0-options.amount").value,"");
});

const damage = {effectId:"damage",targetId:"enemy",options:{amount:"amount-3"}};
const cancel = {effectId:"cancel-attack",targetId:"self",options:{}};
const point = (p,id) => p.get(`a-point-${id}`)?.textContent;

test("A compact cost summary uses computed totals, preserves saved values, and emphasizes overspending",async()=>{
 for(const selection of [null,{triggerId:"lte:3",effects:[damage,cancel,heal,damage]},{triggerId:"all",effects:[damage,damage]},
   {triggerId:"exact:0",effects:[damage]}, {triggerId:"exact:1",effects:[{effectId:"heal",targetId:"self",options:{}}]}]) {
  const b=initial(selection),before=structuredClone(b),p=await page(b);
  const r=calculateASkillResources(b.ducks[0],selection);
  assert.equal(p.get("a-metrics").attributes["aria-label"],"Aスキルのコスト");
  assert.ok(!p.get("a-metrics").textContent.includes("内訳"));
  if(selection) {
   assert.equal(point(p,"available"),String(r.availablePoints??"—"));assert.equal(point(p,"net"),String(r.netCost??"—"));
   assert.equal(point(p,"remaining"),r.remaining==null?"—":String(Math.abs(r.remaining)));
   if(r.remaining<0) {assert.match(p.get("a-point-shortage").textContent,/コストオーバー/);assert.match(p.get("a-issues").textContent,/コストオーバー/);}
  }
  assert.deepEqual(b,before);
 }
});
test("A incomplete controls use color hints without persistent warnings; supplementary control is subdued",async()=>{
 const p=await page(initial());
 assert.match(p.get("a-effect-0").className,/select-empty/);assert.equal(p.get("a-issues").textContent,"");
 assert.equal(p.get("a-cancel").parent.className,"auxiliary-control");
 assert.match(p.get("stat-AT").className,/select-compact/);
 assert.ok(!p.get("a-effect-0").className.includes("select-compact"));
 p.choose("a-trigger","exact:1");assert.ok(!p.get("a-trigger").className.includes("select-empty"));
 assert.match(p.get("a-trigger-comparison").className,/select-compact/);
 for(const key of ["a","b","c","d"]) assert.ok(p.all().some(e=>e.className===`card skill-card skill-${key}`));
 p.get("save").handlers.click();assert.ok(p.all().some(e=>e.textContent==="未完成の設定があります"));
});

test("A sentence: effect first, only variable clauses are selects, no duplicate preview",async()=>{
  const p=await page(initial({triggerId:"exact:1",effects:[]}));p.get("a-add-effect").handlers.click();
  assert.equal(p.get("a-effect-0-targetId"),undefined);
  assert.equal(p.get("a-effect-0").children[0].textContent,"スキル効果");
  assert.ok(!p.get("a-effect-0").children.some(o=>o.value==="cancel-attack"));
  const previews=()=>p.all().filter(e=>e.className==="a-completed-sentence").map(e=>e.textContent);
  p.choose("a-effect-0","damage");
  assert.equal(p.get("a-effect-0-targetId").tagName,"span");
  assert.equal(p.get("a-effect-0-targetId").textContent,"相手");
  assert.equal(p.get("a-effect-0-statusId"),undefined);assert.deepEqual(previews(),[]);
  assert.equal(p.get("a-effect-0-options.amount").children[0].textContent,"効果量");
  p.choose("a-effect-0-options.amount","amount-3");assert.equal(sentenceText(p.get("a-sentence-0")),"相手に固定3ダメージを与える");
  p.choose("a-effect-0","heal");assert.equal(p.get("a-effect-0-targetId").value,"");assert.equal(p.get("a-effect-0-options.amount").value,"");assert.deepEqual(previews(),[]);
  p.choose("a-effect-0-targetId","self");p.choose("a-effect-0-options.amount","amount-10");assert.equal(sentenceText(p.get("a-sentence-0")),"自分のHPを10回復する");
  p.choose("a-effect-0","grant-status");assert.equal(p.get("a-effect-0-targetId").value,"");assert.equal(p.get("a-effect-0-statusId").children[0].textContent,"状態種別");
  p.choose("a-effect-0-targetId","enemy");p.choose("a-effect-0-statusId","crack");p.choose("a-effect-0-options.amount","amount-2");
  assert.equal(sentenceText(p.get("a-sentence-0")),"相手に亀裂を2付与する");
  const fields=p.get("a-sentence-0").children.filter(e=>e.id).map(e=>e.id);
  assert.deepEqual(fields,["a-effect-0-targetId","a-effect-0-statusId","a-effect-0-options.amount"]);
  p.choose("a-effect-0","cancel-dice-effect");assert.equal(p.get("a-effect-0-statusId"),undefined);assert.equal(p.get("a-effect-0-options.amount"),undefined);
  assert.equal(sentenceText(p.get("a-sentence-0")),"ダイス効果のAP増加をキャンセルする（デメリット）");
  assert.deepEqual(previews(),[]);
});

test("A sentence: direction and single amount use fixed prose; ambiguous direction stays neutral fixed prose",async()=>{
  const p=await page(initial({triggerId:"exact:1",effects:[heal]}));
  p.choose("a-effect-0","change-ap");
  assert.equal(p.get("a-effect-0-options.direction").tagName,"span");
  assert.equal(p.get("a-effect-0-options.direction").textContent,"増加/減少する");
  p.choose("a-effect-0-targetId","enemy");
  assert.equal(p.get("a-effect-0-options.direction").tagName,"span");
  assert.equal(p.get("a-effect-0-options.direction").textContent,"減少する");
  for(const [effect,target,direction] of [["change-at","自分","増加する"],["change-df","相手","減少する"]]) {
    p.choose("a-effect-0",effect);
    assert.equal(p.get("a-effect-0-targetId").tagName,"span");
    assert.equal(p.get("a-effect-0-targetId").textContent,target);
    assert.equal(p.get("a-effect-0-options.direction").tagName,"span");
    assert.equal(p.get("a-effect-0-options.direction").textContent,direction);
    assert.equal(p.get("a-effect-0-options.amount").tagName,"select");
  }
  p.choose("a-effect-0","change-attacks");
  assert.equal(p.get("a-sentence-0").children.some(e=>e.tagName==="select"),false);
  assert.equal(sentenceText(p.get("a-sentence-0")),"自分の通常攻撃回数を現在フェイズ中だけ1増加する");
});

test("A trigger sentence: only existing legal rows, all hides comparison, stale selection stays disabled",async()=>{
  const p=await page(initial({triggerId:"exact:1",effects:[heal]}));
  assert.equal(p.get("a-trigger-comparison").children.find(o=>o.value==="gte:1").disabled,true);
  p.choose("a-trigger","exact:3");p.choose("a-trigger-comparison","gte:3");
  assert.equal(p.save().ducks[0].aSelection.triggerId,"gte:3");
  p.choose("a-trigger","all");assert.equal(p.get("a-trigger-comparison"),undefined);
  assert.match(sentenceText(p.get("a-trigger")),/^全ての出目$/);
});

test("A sentence reads never repair missing singleton, invalid singleton or obsolete fields",async()=>{
  const leaves=[{effectId:"damage",targetId:"",options:{amount:"amount-3"}},
    {effectId:"change-attacks",targetId:"self",options:{amount:"amount-999"}},
    {effectId:"obsolete-effect",targetId:"self",statusId:"obsolete",options:{amount:"bad"}}];
  for(const leaf of leaves) {
    const b=initial({triggerId:"exact:1",effects:[leaf]}),original=structuredClone(b.ducks[0].aSelection);
    const p=await page(b);
    if(leaf.targetId==="") assert.equal(p.get("a-effect-0-targetId").tagName,"select");
    if(leaf.options?.amount==="amount-999") {
      assert.equal(p.get("a-effect-0-options.amount").tagName,"select");
      assert.equal(p.get("a-effect-0-options.amount").children.find(o=>o.value==="amount-999").disabled,true);
    }
    assert.deepEqual(p.save().ducks[0].aSelection,original);
  }
});

test("mandatory A starts with effect1; reading/saving null never creates selection",async()=>{
 const b=initial(),before=structuredClone(b),p=await page(b);
 assert.equal(p.get("a-enabled"),undefined);assert.ok(p.get("a-effect-0"));assert.ok(p.get("a-trigger"));
 assert.equal(p.get("a-trigger-comparison"),undefined);assert.equal(sentenceText(p.get("a-trigger").parent),"出目が選択してくださいの時");
 assert.ok(!p.all().some(e=>e.tagName==="button"&&/Aスキル.*作成|Aスキル.*削除/.test(e.textContent)));
 assert.deepEqual(p.save(),before);p.choose("a-effect-0","heal");const saved=p.save();
 assert.equal(saved.ducks[0].aSelection.triggerId,"");assert.equal(saved.ducks[0].aSelection.effects[0].effectId,"heal");assert.deepEqual(b,before);
});
test("A face 0..6/all and comparison controls; natural formal all and cost wording",async()=>{
 const b=initial({triggerId:"exact:1",effects:[heal]}),p=await page(b);
 assert.deepEqual(p.get("a-trigger").children.slice(1).map(o=>o.value),["exact:0","exact:1","exact:2","exact:3","exact:4","exact:5","exact:6","all"]);
 assert.deepEqual(p.get("a-trigger-comparison").children.slice(1).map(o=>o.textContent),["丁度","以上","以下"]);
 assert.ok(p.get("a-trigger").children.find(o=>o.value==="exact:0").disabled);
 p.choose("dice-type","custom-speed");p.choose("a-trigger","exact:0");assert.equal(p.get("a-trigger-comparison"),undefined);
 assert.equal(sentenceText(p.get("a-trigger").parent),"出目が0の時");
 p.choose("a-trigger","all");assert.equal(sentenceText(p.get("a-trigger").parent),"出目が全ての出目の時");assert.equal(p.get("a-trigger-comparison"),undefined);
 const saved=p.save();const {presentASkill}=await import("../js/aSkillPresentation.js");
 assert.match(presentASkill(saved.ducks[0],saved.ducks[0].aSelection).text,/^全ての出目で、/);
 assert.ok(!/pt|ポイント/.test(p.get("a-metrics").textContent));assert.match(p.get("a-metrics").textContent,/使用可能.*必要/);
});

test("A UI keeps heal/status amounts on parent changes and never offers a direction select",async()=>{
 const b=initial({triggerId:"exact:1",effects:[{effectId:"heal",targetId:"self",options:{amount:"amount-10"}}]}),before=structuredClone(b),p=await page(b);
 assert.deepEqual(p.save(),before);p.choose("a-effect-0-targetId","enemy");
 assert.equal(sentenceText(p.get("a-sentence-0")),"相手のHPを10回復する（デメリット）");
 p.choose("a-effect-0","grant-status");p.choose("a-effect-0-targetId","self");p.choose("a-effect-0-statusId","crack");p.choose("a-effect-0-options.amount","amount-2");
 p.choose("a-effect-0-targetId","enemy");assert.equal(sentenceText(p.get("a-sentence-0")),"相手に亀裂を2付与する");
 for(const effect of ["change-ap","change-next-at"]) {
  p.choose("a-effect-0",effect);assert.equal(p.get("a-effect-0-options.direction").textContent,"増加/減少する");
  for(const [target,text] of [["self","増加する"],["enemy","減少する"]]) {p.choose("a-effect-0-targetId",target);assert.equal(p.get("a-effect-0-options.direction").tagName,"span");assert.equal(p.get("a-effect-0-options.direction").textContent,text);}
 }
 assert.deepEqual(b,before);
});
