import test from "node:test";
import { loadSettingPage } from "./settingPageHarness.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PLAYER_BUILD_STORAGE_KEY } from "../js/playerBuildStorage.js";
import { createEmptyDuck, createEmptyPlayerBuild } from "../js/playerBuildModel.js";

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


import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { compileCSkill } from "../js/cSkillCompiler.js";
import { calculateCSkillResources } from "../js/cSkillResources.js";
import { cControlDefinitions, changeCControl } from "../js/cSkillControlEditor.js";
import { effectSelectionFields } from "../js/effectSelectionCatalog.js";
import { presentCSkill } from "../js/cSkillPresentation.js";

function initial(cSelection=null) {
  const b=createEmptyPlayerBuild();b.ducks.push({...createEmptyDuck({idFactory:()=>"c-ui"}),name:"テストDuck",stats:{AT:3,DF:3,SP:2},diceFrame:"preset-standard",dice:[1,2,3,4,5,6],cSelection});return b;
}
const selection=(effects,mode="normal")=>({mode,structure:{kind:"flat",effects}});
const grant={effectId:"grant-status",targetId:"enemy",statusId:"crack",options:{amount:"statusStacks-3"}};
const control="c-effect-flat-0";
const add=p=>p.all().find(e=>e.tagName==="button"&&e.textContent==="＋ C効果を追加").handlers.click();

test("C explicit edits: singleton amount becomes fixed, multiple targets/status/chance stay select; save/reload",async()=>{
  let p=await page(initial());p.choose("c-mode","normal");assert.equal(p.get("c-structure").tagName,"select");
  p.choose(control,"grant-status");
  assert.equal(p.get(control+"-options.amount").tagName,"span");assert.equal(p.get(control+"-options.amount").textContent,"3");
  assert.equal(p.get(control+"-targetId").tagName,"select");assert.equal(p.get(control+"-targetId").value,"");
  assert.equal(p.get(control+"-statusId").tagName,"select");assert.equal(p.get(control+"-statusId").value,"");
  p.choose(control+"-targetId","enemy");p.choose(control+"-statusId","crack");
  assert.equal(p.get("c-metrics").textContent,`必要AP：最低AP5＋0＝${calculateCSkillResources(selection([grant])).requiredAP}`);
  const saved=p.save();assert.deepEqual(saved.ducks[0].cSelection,selection([grant]));assert.equal(compileCSkill(saved.ducks[0].cSelection).ok,true);
  p=await page(saved);assert.equal(p.get(control+"-options.amount").textContent,"3");
  p.choose(control,"damage");assert.equal(p.get(control+"-options.amount").tagName,"select");assert.equal(p.get(control+"-options.amount").value,"");
  p.choose(control+"-targetId","enemy");assert.equal(p.get(control+"-chanceOptionId").tagName,"select");
});

test("C target and status edits clear illegal downstream axes and fill only singletons",async()=>{
  const p=await page(initial(selection([grant])));
  p.choose(control,"remove-random-status");p.choose(control+"-targetId","self");
  p.choose(control+"-statusId","@debuff");
  const saved=p.save();assert.deepEqual(saved.ducks[0].cSelection.structure.effects[0],{effectId:"remove-random-status",targetId:"self",statusId:"@debuff",options:{}});
  assert.equal(p.get(control+"-options.scope"),undefined);
  p.choose(control,"turn-damage");assert.equal(p.get(control+"-targetId").tagName,"span");
  assert.equal(p.get(control+"-options.baseAmount").textContent,"30");
  assert.equal(p.get(control+"-options.everyTurns").tagName,"select");assert.equal(p.get(control+"-options.everyTurns").value,"");
  assert.equal(p.get(control+"-options.stepAmount").value,"");
});

test("C special flat is fixed; normal branching and HP threshold remain selectable",async()=>{
  const p=await page(initial());p.choose("c-mode","special");
  assert.equal(p.get("c-structure"),undefined);
  assert.equal(p.save().ducks[0].cSelection.structure.kind,"flat");
  p.choose("c-mode","normal");assert.equal(p.get("c-structure").tagName,"select");
  p.choose("c-structure","hpCondition");assert.equal(p.get("c-threshold").tagName,"select");
});

test("C render/load never fills blank singleton; explicit fix button sets it",async()=>{
  const leaf={...grant,options:{}}, b=initial(selection([leaf]));let p=await page(b);
  assert.match(p.get(control+"-options.amount").textContent,/未選択.*固定値：3/);
  assert.equal(p.get(control+"-options.amount").tagName,"span");
  assert.deepEqual(p.save().ducks[0].cSelection,b.ducks[0].cSelection);
  p.all().find(e=>e.tagName==="button"&&e.textContent==="3に設定").handlers.click();
  assert.deepEqual(p.save().ducks[0].cSelection,selection([grant]));
});

test("C invalid singleton stays visible, save is rejected, only explicit edit repairs",async()=>{
  const b=initial(selection([{...grant,options:{amount:"obsolete"}}])),before=structuredClone(b);
  const p=await page(b);assert.match(p.get(control+"-options.amount").textContent,/現在は使用不可：obsolete/);
  p.get("save").handlers.click();assert.ok(p.all().some(e=>e.textContent==="保存できない設定があります"));
  p.all().find(e=>e.tagName==="dialog").close();
  assert.deepEqual(b,before);
  p.all().find(e=>e.tagName==="button"&&e.textContent==="3に設定").handlers.click();
  assert.equal(p.get(control+"-options.amount").textContent,"3");
});

test("C helper changes only the edited leaf and never selects an arbitrary multi-option child",()=>{
  const catalog=createCSkillCatalog(),context={mode:"normal"};
  for(const d of cControlDefinitions(catalog,context)) {
    const leaf=changeCControl({},"effectId",d.id,catalog,context);
    for(const field of effectSelectionFields(cControlDefinitions(catalog,context),leaf).fields) {
      const current=field.key.startsWith("options.")?leaf.options[field.key.slice(8)]:leaf[field.key];
      assert.equal(current,field.options.length===1?field.options[0].id:"",`${d.id}/${field.key}`);
    }
  }
  const old={...grant,options:{amount:"bad"}},before=structuredClone(old);
  changeCControl(old,"targetId","self",catalog,context);assert.deepEqual(old,before);
  assert.ok(!cControlDefinitions(catalog,context).some(d=>d.id==="revive"));
  assert.ok(cControlDefinitions(catalog,{mode:"special"}).some(d=>d.id==="revive"));
  const narrow={...catalog,chanceOptions:[catalog.chanceOptions[0]]};
  let leaf=changeCControl({},"effectId","damage",narrow,context);leaf=changeCControl(leaf,"targetId","enemy",narrow,context);
  assert.equal(leaf.chanceOptionId,"100");
});

test("C display and unrelated mode/branch edits preserve existing leaves and compiler/resource results",async()=>{
  const c=selection([grant]);const compiled=compileCSkill(c),resources=calculateCSkillResources(c),p=await page(initial(c));
  assert.deepEqual(p.save().ducks[0].cSelection,c);assert.deepEqual(compileCSkill(c),compiled);assert.deepEqual(calculateCSkillResources(c),resources);
  const incomplete={...grant,options:{}};
  const random={mode:"normal",structure:{kind:"random",branches:[{effects:[grant]},{effects:[incomplete]}]}};
  const q=await page(initial(random));q.choose("c-effect-0-0-targetId","self");
  const saved=q.save();assert.deepEqual(saved.ducks[0].cSelection.structure.branches[1].effects[0],incomplete);
});

const sentenceText = e => e.tagName === "select" ? e.children.find(o => o.value === e.value)?.textContent ?? ""
  : (e.text ?? "") + e.children.map(sentenceText).join("");
test("C sentence UI and completed preview share formal wording, with singletons as text", async () => {
  const c=selection([grant]),p=await page(initial(c));
  assert.equal(sentenceText(p.get(control+"-sentence")),presentCSkill(c).branches[0][0]);
  assert.equal(p.get(control+"-options.amount").tagName,"span");
  assert.equal(p.get(control+"-targetId").tagName,"select");
  assert.equal(p.get("c-completed-sentence").textContent,presentCSkill(c).text);
  p.choose(control,"change-at");
  assert.equal(p.get(control+"-options.direction").tagName,"span");
  p.choose(control+"-targetId","self");
  assert.equal(p.get(control+"-options.direction").tagName,"span");
  assert.equal(p.get(control+"-options.direction").textContent,"増加する");
  p.choose(control+"-targetId","enemy");
  assert.equal(p.get(control+"-options.direction").textContent,"減少する");
});
test("aura has no target select, status determines target in explicit edits and survives reload", async () => {
  let p=await page(initial(selection([grant])));p.choose(control,"grant-on-hit");
  assert.equal(p.get(control+"-targetId").tagName,"span");
  p.choose(control+"-statusId","focus");assert.equal(p.get(control+"-targetId").textContent,"自分");
  p.choose(control+"-options.duration","timedTurns-3");
  p.choose(control+"-statusId","crack");assert.equal(p.get(control+"-targetId").textContent,"相手");
  const saved=p.save(), c=saved.ducks[0].cSelection;
  assert.equal(c.structure.effects[0].targetId,"enemy");
  p=await page(saved);assert.equal(sentenceText(p.get(control+"-sentence")),presentCSkill(c).branches[0][0]);
  assert.deepEqual(p.save().ducks[0].cSelection,c);
});
test("healing chance is unavailable and preserved until an explicit reselection", async () => {
  const leaf={effectId:"heal",targetId:"self",options:{amount:"healAmount-30"},chanceOptionId:"50"};
  const b=initial(selection([leaf])),before=structuredClone(b),p=await page(b);
  const chance=p.get(control+"-chanceOptionId");
  assert.ok(chance.children.find(o=>o.value==="50").disabled);
  assert.ok(!chance.children.some(o=>o.value==="70"));
  assert.deepEqual(b,before);
  p.choose(control,"heal");assert.equal(p.get(control+"-chanceOptionId"),undefined);
  p.choose(control+"-targetId","enemy");p.choose(control+"-options.amount","healAmount-30");
  assert.ok(!Object.hasOwn(p.save().ducks[0].cSelection.structure.effects[0],"chanceOptionId"));
});
test("obsolete C effect IDs and directions remain unavailable saved choices", async () => {
  for (const leaf of [
    {effectId:"clear-status",targetId:"self",statusId:"@debuff",options:{scope:"group"}},
    {effectId:"clear-debuff-group-self",options:{scope:"all"}},
    {effectId:"change-df",targetId:"enemy",options:{direction:"increase",amount:"turnDFAmount-2",duration:"turnCount-2"}},
  ]) {
    const b=initial(selection([leaf])),before=structuredClone(b),p=await page(b);
    assert.deepEqual(b,before);
    assert.ok(p.all().some(e=>e.textContent.includes("現在は使用不可")));
    p.get("save").handlers.click();assert.ok(p.all().some(e=>e.textContent==="保存できない設定があります"));
  }
});

test("C normal singleton clauses are unframed text; turn period/increment remain selects",async()=>{
 const p=await page(initial(selection([{effectId:"turn-damage",targetId:"enemy",options:{baseAmount:"stepBaseAmount-30",everyTurns:"stepEveryTurns-5",stepAmount:"stepAmount-10"}}])));
 for(const [key,text] of [["targetId","相手"],["options.baseAmount","30"]]) {
  const node=p.get(control+"-"+key);assert.equal(node.tagName,"span");assert.equal(node.textContent,text);assert.equal(node.className,"c-fixed-clause");assert.equal(node.parent.className,"c-sentence-controls");
 }
 assert.equal(p.get(control+"-options.everyTurns").tagName,"select");assert.equal(p.get(control+"-options.stepAmount").tagName,"select");
 assert.deepEqual(p.get(control+"-sentence").children.filter(e=>e.tagName==="select").map(e=>e.id),[control+"-options.everyTurns",control+"-options.stepAmount"]);
 p.choose(control,"grant-status");assert.equal(p.get(control+"-options.amount").className,"c-fixed-clause");
 p.choose(control,"grant-on-hit");p.choose(control+"-statusId","focus");assert.equal(p.get(control+"-targetId").className,"c-fixed-clause");
});
test("C parent edits retain legal amount/duration and update direction without changing stored data on reads",async()=>{
 const c=selection([{effectId:"change-at",targetId:"self",options:{amount:"turnATAmount-3",duration:"turnCount-4",direction:"increase"}}]),before=structuredClone(c),p=await page(initial(c));
 assert.deepEqual(p.save().ducks[0].cSelection,before);p.choose(control+"-targetId","enemy");
 const saved=p.save().ducks[0].cSelection;assert.deepEqual(saved.structure.effects[0].options,{amount:"turnATAmount-3",duration:"turnCount-4",direction:"decrease"});
 assert.deepEqual(c,before);
});

test("C virtual first rows render for null, flat and every branch without changing stored data",async()=>{
 for(const c of [null,selection([]),{mode:"normal",structure:{kind:"random",branches:[{effects:[]},{effects:[]},{effects:[]}]}},
 {mode:"normal",structure:{kind:"hpCondition",branches:{met:{effects:[]},unmet:{effects:[]}}}}]) {
  const b=initial(c),before=structuredClone(b),p=await page(b);
  const ids=c?.structure.kind==="random"?[0,1,2]:c?.structure.kind==="hpCondition"?["met","unmet"]:["flat"];
  for(const id of ids) {assert.equal(p.get(`c-effect-${id}-0`).tagName,"select");assert.match(p.get(`c-effect-${id}-0`).className,/select-empty/);}
  assert.deepEqual(p.save().ducks[0].cSelection,c);assert.deepEqual(b,before);
  assert.equal(p.get("c-issues").textContent,"");assert.match(p.get("c-metrics").textContent,/^必要AP：/);
 }
});
test("C first edit materializes only its branch; add starts a second row",async()=>{
 const p=await page(initial());p.choose("c-mode","normal");p.choose("c-structure","random2");
 p.choose("c-effect-0-0","grant-status");
 const saved=p.save().ducks[0].cSelection;
 assert.equal(saved.structure.branches[0].effects.length,1);assert.equal(saved.structure.branches[1].effects.length,0);
 add(p);assert.ok(p.get("c-effect-0-1"));
 assert.equal(p.get("c-structure").parent.parent.parent.className,"auxiliary-control");
 assert.ok(p.all().some(e=>e.className==="card skill-card skill-c"));
});
test("C effect metadata uses branch-local resource prices and retains maximum-branch total",async()=>{
 const d=(n,target="enemy")=>({effectId:"damage",targetId:target,options:{amount:`damageAmount-${n}`}});
 const s={mode:"normal",structure:{kind:"random",branches:[{effects:[d(60),d(70)]},{effects:[d(80),d(60,"self")]}]}};
 const b=initial(s),before=structuredClone(b),p=await page(b),r=calculateCSkillResources(s);
 for(const [branch,index,cost,slot] of [[0,0,"+1","0"],[0,1,"+2","+1"],[1,0,"+3","0"],[1,1,"-1","0"]]) {
  const id=`c-effect-${branch}-${index}`;
  assert.equal(p.get(id+"-price").textContent,`AP ${cost}`);assert.equal(p.get(id+"-slot-price").textContent,`枠AP ${slot}`);
  const meta=p.get(id+"-price").parent;assert.equal(meta.className,"effect-meta");assert.equal(meta.parent.children[1].className,"effect-editor c-effect-controls");
 }
 assert.equal(r.selectedBranchPath,"structure.branches.0");assert.equal(p.get("c-metrics").textContent,`必要AP：最低AP5＋1＋3＝${r.requiredAP}`);
 assert.deepEqual(p.save().ducks[0].cSelection,s);assert.deepEqual(b,before);
});
test("C incomplete and dependent slot prices are unknown without contaminating another branch",async()=>{
 const d={effectId:"damage",targetId:"enemy",options:{amount:"damageAmount-60"}};
 const s={mode:"normal",structure:{kind:"random",branches:[{effects:[{effectId:"damage",targetId:"",options:{}},d]},{effects:[d]}]}};
 const p=await page(initial(s));
 for(const id of ["c-effect-0-0-price","c-effect-0-0-slot-price","c-effect-0-1-slot-price"]) assert.match(p.get(id).textContent,/—$/);
 assert.equal(p.get("c-effect-1-0-slot-price").textContent,"枠AP 0");assert.equal(p.get("c-metrics").textContent,"必要AP：—");
});


test("C upper settings are wrapping forms without AP metadata",async()=>{
 const p=await page(initial(selection([grant]))),top=p.get("c-settings");
 const descendants=e=>[e,...e.children.flatMap(descendants)];
 assert.equal(top.className,"skill-settings c-setting-form");
 assert.ok(!top.textContent.includes("最低AP"));
 assert.ok(!descendants(top).some(e=>e.className==="skill-setting-line"||e.className==="setting-meta"));
 for(const id of ["c-mode","c-structure"]) assert.ok(descendants(top).includes(p.get(id)));
});


test("C signed amount colors and two-line footer preserve AP resources",async()=>{
 const s=selection([{effectId:"damage",targetId:"enemy",options:{amount:"damageAmount-60"}},{effectId:"damage",targetId:"self",options:{amount:"damageAmount-70"}}]);
 const before=calculateCSkillResources(s),p=await page(initial(s));
 assert.equal(p.get("c-effect-flat-0-price").children[0].className,"price-positive");
 assert.equal(p.get("c-effect-flat-1-price").children[0].className,"price-negative");
 assert.ok(!p.get("c-effect-flat-0-slot-price").children[0].className);
 const description=p.get("c-effect-description");assert.deepEqual(description.children.map(e=>e.tagName),["span","br","span"]);
 assert.equal(description.children[2].textContent,"デメリット効果に枠追加コストはかかりません。");
 assert.deepEqual(calculateCSkillResources(p.save().ducks[0].cSelection),before);
 const incomplete=await page(initial(selection([{effectId:"damage",targetId:"enemy",options:{}}])));
 assert.equal(incomplete.get("c-effect-flat-0-price").children[0].textContent,"—");assert.ok(!incomplete.get("c-effect-flat-0-price").children[0].className);
});
