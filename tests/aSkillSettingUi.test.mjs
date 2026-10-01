import test from "node:test";
import { loadSettingPage } from "./settingPageHarness.mjs";
import { migratePlayerBuild } from "../js/playerBuildMigration.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PLAYER_BUILD_STORAGE_KEY } from "../js/playerBuildStorage.js";
import { createEmptyDuck, createEmptyPlayerBuild } from "../js/playerBuildModel.js";
import { compileASkill } from "../js/aSkillCompiler.js";
import { calculateASkillResources } from "../js/aSkillResources.js";
import { aPointSections } from "../js/aSkillPresentation.js";
import { aNormalSlots } from "../js/aSkillSentenceEditor.js";
import { createASkillCatalog } from "../js/aSkillCatalog.js";

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
    choose(id,value) {const e=this.get(id);assert.ok(e,`missing ${id}`);assert.ok(e.children.some(o=>o.value===value&&!o.disabled),`illegal ${id}/${value}`);e.value=value;e.handlers.change();},
    save() { this.get("save").handlers.click();const confirm=all().find(e=>e.tagName==="button"&&e.textContent==="このまま保存");confirm?.handlers.click();
      assert.equal(this.get("save-message").textContent,"変更はありません");return JSON.parse(values.get(PLAYER_BUILD_STORAGE_KEY)); },
  };
}


function initial(aSelection=null) {
  const b=createEmptyPlayerBuild();b.ducks.push({...createEmptyDuck({idFactory:()=>"a-ui"}),stats:{AT:3,DF:3,SP:2},diceFrame:"normal",dice:[1,2,3,4,5,6],aSelection});return b;
}
const heal={effectId:"heal",targetId:"enemy",options:{amount:"amount-5"}};
test("A setting UI: enable, current trigger prices, independent cancel plus four slots, v2 save/reload",async()=>{
  let p=await page(initial());assert.equal(p.get("a-trigger"),undefined);
  p.choose("a-enabled","on");assert.equal(p.get("a-effect-0"),undefined);
  assert.match(p.get("a-trigger").textContent,/出目3以下の時 \/ 1pt/);
  assert.match(p.get("a-trigger").textContent,/出目5以下の時 \/ 2pt/);
  p.choose("a-trigger","exact:1");p.choose("a-cancel","on");
  for(let i=0;i<4;i++) {
    p.get("a-add-effect").handlers.click();p.choose(`a-effect-${i}`,"heal");p.choose(`a-effect-${i}-targetId`,"enemy");p.choose(`a-effect-${i}-options.amount`,"amount-5");
  }
  assert.equal(p.get("a-add-effect").disabled,true);
  assert.match(p.get("duck-editor").textContent,/相手のHPを5回復する（デメリット）/);
  assert.equal(p.all().some(e=>e.tagName==="select" && /成功率|50%|25%|10%/.test(e.textContent)),false);
  const saved=p.save(),selection=saved.ducks[0].aSelection;
  assert.equal(selection.effects.length,5);assert.equal(compileASkill(saved.ducks[0],selection).ok,true);
  assert.ok(selection.effects.every(e=>Object.hasOwn(e,"targetId")));
  p=await page(saved);assert.equal(p.get("a-cancel").value,"on");assert.equal(p.get("a-effect-3-options.amount").value,"amount-5");
  p.choose("a-cancel","off");assert.deepEqual(p.save().ducks[0].aSelection.effects,[heal,heal,heal,heal]);
});

test("A setting UI: dice invalidates trigger in place, preserves effect, disabled trigger and refreshed candidates",async()=>{
  const b=initial({triggerId:"exact:6",effects:[heal]});const p=await page(b);
  p.choose("dice-type","light");assert.equal(p.get("a-trigger").value,"exact:6");
  assert.equal(p.get("a-trigger").children.find(e=>e.value==="exact:6").disabled,true);
  assert.match(p.get("a-trigger").textContent,/現在は使用不可：出目6の時/);
  assert.equal(p.get("a-effect-0").value,"heal");
  p.choose("dice-0","2");assert.equal(p.get("a-trigger").children.some(e=>e.value==="exact:1"),false);
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
  assert.match(p.get("a-effect-0").textContent,/現在は使用不可：出目1のAP/);
  assert.equal(p.get("a-effect-0").value,"cancel-dice-effect");
  assert.match(p.get("a-issues").textContent,/一致しません/);
  p.choose("a-trigger","exact:1");assert.match(p.get("duck-editor").textContent,/出目1のAP\+1を無効化する（デメリット）/);
});

test("A setting UI: both conflict directions, invalid saved leaves and cancellation OFF preserve normal effects",async()=>{
  const conflict={effectId:"change-attacks",targetId:"self",options:{amount:"amount-1"}};
  let p=await page(initial({triggerId:"exact:1",effects:[conflict]}));
  assert.equal(p.get("a-cancel").children.find(o=>o.value==="on").disabled,true);
  p=await page(initial({triggerId:"exact:1",effects:[{effectId:"cancel-attack",targetId:"self",options:{}},conflict]}));
  assert.equal(p.get("a-effect-0").value,"change-attacks");assert.equal(p.get("a-effect-0").children.find(o=>o.value==="change-attacks").disabled,true);
  assert.match(p.get("a-issues").textContent,/併用できません/);
  p.choose("a-cancel","off");assert.equal(p.get("a-effect-0-options.amount").value,"amount-1");
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

test("A POINT: hidden when unset; source, trigger, totals and mid-array cancel map to resource fields",async()=>{
  let p=await page(initial());assert.equal(p.get("a-metrics"),undefined);
  p.choose("a-enabled","on");assert.equal(point(p,"base"),"3pt");assert.equal(point(p,"trigger"),"未確定");
  const b=initial({triggerId:"lte:3",effects:[damage,cancel,heal,damage]});
  const before=structuredClone(b),r=calculateASkillResources(b.ducks[0],b.ducks[0].aSelection);
  p=await page(b);
  for(const [id,key] of [["base","basePoints"],["available","availablePoints"],["trigger","triggerCost"],
    ["benefit-slots","benefitSlotCost"],["gross","grossCost"],["drawback","drawbackPoints"],["net","netCost"],["remaining","remaining"]]) {
    assert.equal(point(p,id),`${r[key]}pt`,id);
  }
  assert.equal(point(p,"dice"),"0pt");
  assert.equal(point(p,"effect-1"),`${r.effectBreakdown[0].effectCost}pt`);
  assert.equal(point(p,"effect-2"),`+${r.effectBreakdown[2].drawbackPoints}pt`);
  assert.equal(point(p,"effect-3"),`${r.effectBreakdown[3].effectCost}pt`);
  assert.equal(point(p,"effect-4"),undefined);
  assert.equal(point(p,"cancel"),`+${r.cancelDrawbackPoints}pt`);
  assert.equal(point(p,"benefit-slots"),"1pt");
  const saved=p.save();assert.deepEqual(saved.ducks[0].aSelection,b.ducks[0].aSelection);
  p=await page(saved);assert.equal(point(p,"effect-2"),"+2pt");
  assert.deepEqual(b,before);assert.deepEqual(calculateASkillResources(b.ducks[0],b.ducks[0].aSelection),r);
});

test("A POINT: preset dice, unsaved standard edits and trigger changes refresh immediately",async()=>{
  const p=await page(initial({triggerId:"exact:1",effects:[damage,cancel]}));
  assert.equal(point(p,"dice"),"0pt");assert.equal(point(p,"trigger"),"0pt");assert.equal(point(p,"benefit-slots"),"0pt");
  assert.equal(point(p,"cancel"),"+1pt");
  p.choose("a-trigger","lte:3");assert.equal(point(p,"trigger"),"1pt");assert.equal(point(p,"cancel"),"+2pt");
  p.choose("a-trigger","all");assert.equal(point(p,"trigger"),"2pt");assert.equal(point(p,"cancel"),"+3pt");
  p.choose("dice-preset","void");assert.equal(point(p,"dice"),"+4pt");assert.equal(point(p,"available"),"7pt");
  p.choose("dice-type","light");assert.equal(point(p,"dice"),"+2pt");assert.equal(point(p,"available"),"5pt");
  p.choose("dice-0","2");p.choose("dice-2","2");
  assert.equal(point(p,"dice"),"+1pt");assert.equal(point(p,"available"),"4pt");
  p.choose("dice-3","0");assert.equal(point(p,"dice"),"+1pt");
  p.choose("dice-0","0");assert.equal(point(p,"dice"),"未確定");assert.equal(point(p,"available"),"未確定");
});

test("A POINT: stale trigger and unknown dice never look like zero, saved selection is retained",async()=>{
  const b=initial({triggerId:"exact:0",effects:[damage,cancel]});
  let p=await page(b);assert.equal(point(p,"trigger"),"未確定");assert.equal(point(p,"cancel"),"未確定");
  assert.equal(point(p,"remaining"),"未確定");assert.equal(p.get("a-trigger").value,"exact:0");
  assert.match(p.get("a-trigger").textContent,/現在は使用不可/);
  assert.deepEqual(b.ducks[0].aSelection,{triggerId:"exact:0",effects:[damage,cancel]});
  const noDice=initial({triggerId:"",effects:[]});noDice.ducks[0].diceFrame=null;noDice.ducks[0].stats.SP=null;
  p=await page(noDice);assert.equal(point(p,"base"),"3pt");assert.equal(point(p,"dice"),"未確定");assert.equal(point(p,"available"),"未確定");
});

test("A POINT: partial or invalid effects keep confirmed rows, never display provisional prices as final",async()=>{
  const leaves=[
    {effectId:"",targetId:"",options:{}},
    {effectId:"heal",options:{amount:"amount-5"}},
    {effectId:"grant-status",targetId:"self",options:{amount:"amount-2"}},
    {effectId:"heal",targetId:"self",options:{}},
    {effectId:"heal",targetId:"self",options:{amount:"bad"}},
    {effectId:"grant-status",targetId:"self",statusId:"bad",options:{amount:"amount-2"}},
    {effectId:"obsolete",targetId:"self",options:{}},
  ];
  for(const leaf of leaves) {
    const b=initial({triggerId:"exact:1",effects:[damage,leaf]}),before=structuredClone(b);
    const r=calculateASkillResources(b.ducks[0],b.ducks[0].aSelection),rBefore=structuredClone(r);
    const compiled=compileASkill(b.ducks[0],b.ducks[0].aSelection);
    const p=await page(b);
    assert.equal(point(p,"base"),"3pt");assert.equal(point(p,"dice"),"0pt");assert.equal(point(p,"available"),"3pt");
    assert.equal(point(p,"trigger"),"0pt");assert.equal(point(p,"effect-1"),"2pt");
    assert.equal(point(p,"effect-2"),"未確定");assert.equal(point(p,"remaining"),"未確定");
    const catalog=createASkillCatalog();aPointSections(r,aNormalSlots(b.ducks[0].aSelection,catalog),false);
    assert.deepEqual(r,rBefore);assert.deepEqual(b,before);assert.deepEqual(compileASkill(b.ducks[0],b.ducks[0].aSelection),compiled);
  }
});

test("A POINT: overspending shows negative remaining plus shortage and keeps existing validation",async()=>{
  const b=initial({triggerId:"all",effects:[damage,damage]});const r=calculateASkillResources(b.ducks[0],b.ducks[0].aSelection);
  const p=await page(b);assert.ok(r.remaining<0);
  assert.equal(point(p,"remaining"),`${r.remaining}pt`);
  assert.equal(p.get("a-point-shortage").textContent,`${Math.abs(r.remaining)}pt不足しています`);
  assert.equal(p.get("a-point-remaining").className,"a-point-shortage");
  assert.match(p.get("a-issues").textContent,/ポイント.*不足/);
});

test("A form: effect first, catalog targets, placeholders, downstream reset and completed previews",async()=>{
  const p=await page(initial({triggerId:"exact:1",effects:[]}));p.get("a-add-effect").handlers.click();
  assert.equal(p.get("a-effect-0-targetId"),undefined);
  assert.equal(p.get("a-effect-0").children[0].textContent,"スキル効果");
  assert.ok(!p.get("a-effect-0").children.some(o=>o.value==="cancel-attack"));
  const previews=()=>p.all().filter(e=>e.className==="a-completed-sentence").map(e=>e.textContent);
  p.choose("a-effect-0","damage");
  assert.deepEqual(p.get("a-effect-0-targetId").children.map(o=>o.value),["","enemy"]);
  assert.equal(p.get("a-effect-0-targetId").value,"enemy");
  assert.equal(p.get("a-effect-0-statusId"),undefined);assert.deepEqual(previews(),[]);
  assert.equal(p.get("a-effect-0-options.amount").children[0].textContent,"効果量");
  p.choose("a-effect-0-options.amount","amount-3");assert.match(previews()[0],/相手に固定ダメージを3与える/);
  p.choose("a-effect-0","heal");assert.equal(p.get("a-effect-0-targetId").value,"");assert.equal(p.get("a-effect-0-options.amount").value,"");assert.deepEqual(previews(),[]);
  p.choose("a-effect-0-targetId","self");p.choose("a-effect-0-options.amount","amount-10");assert.equal(previews()[0],"自分のHPを10回復する");
  p.choose("a-effect-0","grant-status");assert.equal(p.get("a-effect-0-targetId").value,"");assert.equal(p.get("a-effect-0-statusId").children[0].textContent,"状態種別");
  p.choose("a-effect-0-targetId","enemy");p.choose("a-effect-0-statusId","crack");p.choose("a-effect-0-options.amount","amount-2");
  assert.equal(previews()[0],"相手に亀裂を2stack付与する");
  const fields=p.get("a-effect-0").parent.parent.children.map(e=>e.children[0]?.id);
  assert.deepEqual(fields,["a-effect-0","a-effect-0-targetId","a-effect-0-statusId","a-effect-0-options.amount"]);
  p.choose("a-effect-0","cancel-dice-effect");assert.equal(p.get("a-effect-0-statusId"),undefined);assert.equal(p.get("a-effect-0-options.amount"),undefined);
  assert.match(previews()[0],/出目1のAP/);
});
