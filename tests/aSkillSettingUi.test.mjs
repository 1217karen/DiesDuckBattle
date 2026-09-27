import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PLAYER_BUILD_STORAGE_KEY } from "../js/playerBuildStorage.js";
import { createEmptyDuck, createEmptyPlayerBuild } from "../js/playerBuildModel.js";
import { compileASkill } from "../js/aSkillCompiler.js";

// Exercise the real settingPage handlers with an in-memory DOM/storage, no browser dependency.
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
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  await import(`../js/settingPage.js?ui-test=${crypto.randomUUID()}`);
  return { get:id=>document.getElementById(id), all,
    choose(id,value) {const e=this.get(id);assert.ok(e,`missing ${id}`);assert.ok(e.children.some(o=>o.value===value&&!o.disabled),`illegal ${id}/${value}`);e.value=value;e.handlers.change();},
    save() { this.get("save").handlers.click();const confirm=all().find(e=>e.tagName==="button"&&e.textContent==="このまま保存");confirm?.handlers.click();
      assert.equal(this.get("save-message").textContent,"保存しました");return JSON.parse(values.get(PLAYER_BUILD_STORAGE_KEY)); },
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
    p.get("a-add-effect").handlers.click();p.choose(`a-effect-${i}-targetId`,"enemy");p.choose(`a-effect-${i}`,"heal");p.choose(`a-effect-${i}-options.amount`,"amount-5");
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

test("A setting UI: v1 data loads through existing migration and saves the same compiled meaning",async()=>{
  const b=initial({triggerId:"exact:1",effects:[{effectId:"heal-enemy",amountOptionId:"amount-5"}]});b.schemaVersion=1;
  const original=compileASkill(b.ducks[0],b.ducks[0].aSelection);
  const p=await page(b);assert.equal(p.get("a-effect-0").value,"heal");assert.equal(p.get("a-effect-0-options.amount").value,"amount-5");
  const saved=p.save();assert.equal(saved.schemaVersion,2);
  assert.deepEqual(compileASkill(saved.ducks[0],saved.ducks[0].aSelection),original);
});

test("A setting UI: unavailable v2 effect remains a disabled saved value",async()=>{
  const p=await page(initial({triggerId:"exact:1",effects:[{effectId:"obsolete-effect",targetId:"self",options:{amount:"amount-1"}}]}));
  assert.equal(p.get("a-effect-0").value,"obsolete-effect");
  assert.equal(p.get("a-effect-0").children.find(o=>o.value==="obsolete-effect").disabled,true);
  p.choose("a-effect-0","heal");assert.equal(p.get("a-effect-0-options.amount").value,"");
});
