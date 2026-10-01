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

function initial(cSelection=null) {
  const b=createEmptyPlayerBuild();b.ducks.push({...createEmptyDuck({idFactory:()=>"c-ui"}),stats:{AT:3,DF:3,SP:2},diceFrame:"normal",dice:[1,2,3,4,5,6],cSelection});return b;
}
const selection=(effects,mode="normal")=>({mode,structure:{kind:"flat",effects}});
const grant={effectId:"grant-status",targetId:"enemy",statusId:"crack",options:{amount:"statusStacks-3"}};
const control="c-effect-flat-0";
const add=p=>p.all().find(e=>e.tagName==="button"&&e.textContent==="＋ C効果を追加").handlers.click();

test("C explicit edits: singleton amount becomes fixed, multiple targets/status/chance stay select; save/reload",async()=>{
  let p=await page(initial());p.choose("c-mode","normal");assert.equal(p.get("c-structure").tagName,"select");add(p);
  p.choose(control,"grant-status");
  assert.equal(p.get(control+"-options.amount").tagName,"span");assert.equal(p.get(control+"-options.amount").textContent,"3");
  assert.equal(p.get(control+"-targetId").tagName,"select");assert.equal(p.get(control+"-targetId").value,"");
  assert.equal(p.get(control+"-statusId").tagName,"select");assert.equal(p.get(control+"-statusId").value,"");
  p.choose(control+"-targetId","enemy");p.choose(control+"-statusId","crack");
  const saved=p.save();assert.deepEqual(saved.ducks[0].cSelection,selection([grant]));assert.equal(compileCSkill(saved.ducks[0].cSelection).ok,true);
  p=await page(saved);assert.equal(p.get(control+"-options.amount").textContent,"3");
  p.choose(control,"damage");assert.equal(p.get(control+"-options.amount").tagName,"select");assert.equal(p.get(control+"-options.amount").value,"");
  p.choose(control+"-targetId","enemy");assert.equal(p.get(control+"-chanceOptionId").tagName,"select");
});

test("C target and status edits clear illegal downstream axes and fill only singletons",async()=>{
  const p=await page(initial(selection([grant])));
  p.choose(control,"clear-status");p.choose(control+"-targetId","self");
  assert.equal(p.get(control+"-statusId").value,"");assert.equal(p.get(control+"-options.scope").tagName,"select");
  p.choose(control+"-statusId","@debuff");
  assert.equal(p.get(control+"-options.scope").tagName,"span");assert.equal(p.get(control+"-options.scope").textContent,"状態グループ");
  let saved=p.save();assert.equal(saved.ducks[0].cSelection.structure.effects[0].options.scope,"group");
  p.choose(control+"-statusId","crack");assert.equal(p.get(control+"-options.scope").textContent,"指定状態");
  saved=p.save();assert.equal(saved.ducks[0].cSelection.structure.effects[0].options.scope,"single");
  p.choose(control,"turn-damage");assert.equal(p.get(control+"-targetId").tagName,"span");
  assert.equal(p.get(control+"-options.baseAmount").textContent,"30");
  assert.equal(p.get(control+"-options.everyTurns").tagName,"select");assert.equal(p.get(control+"-options.everyTurns").value,"");
  assert.equal(p.get(control+"-options.stepAmount").value,"");
});

test("C special flat is fixed; normal branching and HP threshold remain selectable",async()=>{
  const p=await page(initial());p.choose("c-mode","special");
  assert.equal(p.get("c-structure").tagName,"span");assert.equal(p.get("c-structure").textContent,"分岐なし");
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
