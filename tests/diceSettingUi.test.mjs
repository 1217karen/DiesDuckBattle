import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PLAYER_BUILD_STORAGE_KEY } from "../js/playerBuildStorage.js";
import { createEmptyDuck, createEmptyPlayerBuild } from "../js/playerBuildModel.js";
import { compileBSkill } from "../js/bSkillCompiler.js";

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
    choose(id,value) {const e=this.get(id);assert.ok(e,`missing ${id}`);assert.ok(e.children.some(o=>o.value===value),`illegal ${id}/${value}`);e.value=value;e.handlers.change();},
    save() { this.get("save").handlers.click();const confirm=all().find(e=>e.tagName==="button"&&e.textContent==="このまま保存");confirm?.handlers.click();
      assert.equal(this.get("save-message").textContent,"保存しました");return JSON.parse(values.get(PLAYER_BUILD_STORAGE_KEY)); },
  };
}


function initial() {const b=createEmptyPlayerBuild();b.ducks.push({...createEmptyDuck({idFactory:()=>"ui-duck"}),stats:{AT:4,DF:4,SP:1},diceFrame:"heavy",dice:[0,0,3,4,5,6],aSelection:{triggerId:"exact:6",effects:[{effectId:"heal",targetId:"enemy",options:{amount:"amount-5"}}]}});return b;}
test("dice-first UI derives SP, resets dice only on type changes, exposes budget and preserves invalid A",async()=>{
  const p=await page(initial());
  assert.equal(p.get("stat-SP"),undefined);
  const headings=p.get("duck-editor").textContent;assert.ok(headings.indexOf("DICE /")<headings.indexOf("STATUS /"));assert.ok(headings.indexOf("STATUS /")<headings.indexOf("A SKILL"));
  assert.match(p.get("stat-metrics").textContent,/合計8pt.*使用中：8pt.*残り0pt/);
  p.choose("dice-type","light");
  assert.deepEqual(Array.from({length:6},(_,i)=>p.get(`dice-${i}`).value),["1","2","3","4","0","0"]);
  assert.equal(p.get("stat-AT").value,4);assert.equal(p.get("stat-DF").value,4);
  assert.match(p.get("stat-metrics").textContent,/合計6pt.*残り-2pt/);
  assert.equal(p.get("a-trigger").value,"exact:6");assert.match(p.get("a-trigger").textContent,/現在は使用不可/);
  p.choose("dice-0","0");assert.match(p.get("dice-metrics").textContent,/獲得 3pt.*消費 1pt.*残り 2pt/);
  p.choose("dice-type","basic");assert.deepEqual(Array.from({length:6},(_,i)=>p.get(`dice-${i}`).value),["0","2","3","4","5","0"]);
  assert.match(p.get("stat-metrics").textContent,/合計7pt/);
});
test("preset UI offers normal/void, locks every dice slot, and restores custom standard dice on load",async()=>{
  const b=initial();b.ducks[0].dice=[0,3,3,4,5,6];const p=await page(b);
  assert.equal(p.get("dice-1").value,"3");p.choose("dice-type","preset");
  assert.equal(p.get("dice-preset").value,"normal");
  assert.deepEqual(Array.from({length:6},(_,i)=>p.get(`dice-${i}`).value),["1","2","3","4","5","6"]);
  assert.ok(Array.from({length:6},(_,i)=>p.get(`dice-${i}`).disabled).every(Boolean));
  p.choose("dice-preset","void");assert.match(p.get("dice-metrics").textContent,/残り 4pt/);
  assert.deepEqual(Array.from({length:6},(_,i)=>p.get(`dice-${i}`).value),["0","0","0","0","0","0"]);
  assert.equal(p.get("a-trigger").value,"exact:6");assert.match(p.get("a-trigger").textContent,/現在は使用不可/);
  p.choose("dice-type","heavy");assert.equal(p.get("dice-preset"),undefined);assert.equal(p.get("dice-0").disabled,false);
});
