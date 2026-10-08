import test from "node:test";
import { loadSettingPage } from "./settingPageHarness.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PLAYER_BUILD_STORAGE_KEY } from "../js/playerBuildStorage.js";
import { createEmptyDuck, createEmptyPlayerBuild } from "../js/playerBuildModel.js";
import { compileBSkill } from "../js/bSkillCompiler.js";

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


function initial() {const b=createEmptyPlayerBuild();b.ducks.push({...createEmptyDuck({idFactory:()=>"ui-duck"}),name:"テストDuck",stats:{AT:4,DF:4,SP:1},diceFrame:"custom-heavy",dice:[0,0,3,4,5,6],aSelection:{triggerId:"exact:6",effects:[{effectId:"heal",targetId:"enemy",options:{amount:"amount-5"}}]}});return b;}
test("dice-first UI derives SP, resets dice only on type changes, exposes budget and preserves invalid A",async()=>{
  const p=await page(initial());
  assert.equal(p.get("stat-SP").textContent,"SP 1");
  const headings=p.get("duck-editor").textContent;assert.ok(headings.indexOf("DICE /")<headings.indexOf("STATUS /"));assert.ok(headings.indexOf("STATUS /")<headings.indexOf("A SKILL"));
  assert.match(p.get("stat-metrics").textContent,/ステータス合計：9 \/ 9/);
  p.choose("dice-type","custom-speed");
  assert.deepEqual(Array.from({length:6},(_,i)=>p.get(`dice-${i}`).value),["1","2","3","4","0","0"]);
  assert.equal(p.get("stat-AT").value,"4");assert.equal(p.get("stat-DF").value,"4");
  assert.match(p.get("stat-metrics").textContent,/ステータス合計：11 \/ 9/);
  assert.equal(p.get("a-trigger").value,"exact:6");assert.match(p.get("a-trigger").textContent,/現在は使用不可/);
  p.choose("dice-0","0");assert.match(p.get("dice-metrics").textContent,/^ダイスpt　獲得 3pt \/ 消費 1pt$/);
  p.choose("dice-type","custom-normal");assert.deepEqual(Array.from({length:6},(_,i)=>p.get(`dice-${i}`).value),["0","2","3","4","5","0"]);
  assert.match(p.get("stat-metrics").textContent,/ステータス合計：10 \/ 9/);
});
test("preset UI offers normal/void, locks every dice slot, and restores custom standard dice on load",async()=>{
  const b=initial();b.ducks[0].dice=[0,3,3,4,5,6];const p=await page(b);
  assert.equal(p.get("dice-1").value,"3");p.choose("dice-type","preset-standard");
  assert.equal(p.get("dice-preset"),undefined);
  assert.deepEqual(Array.from({length:6},(_,i)=>p.get(`dice-${i}`).value),["1","2","3","4","5","6"]);
  assert.ok(Array.from({length:6},(_,i)=>p.get(`dice-${i}`).disabled).every(Boolean));
  p.choose("dice-type","preset-void");assert.match(p.get("dice-metrics").textContent,/^ダイスpt　獲得 4pt \/ 消費 0pt$/);
  assert.deepEqual(Array.from({length:6},(_,i)=>p.get(`dice-${i}`).value),["0","0","0","0","0","0"]);
  assert.equal(p.get("a-trigger").value,"exact:6");assert.match(p.get("a-trigger").textContent,/現在は使用不可/);
  p.choose("dice-type","custom-heavy");assert.equal(p.get("dice-preset"),undefined);assert.equal(p.get("dice-0").disabled,false);
});

test("empty dice shows grouped types only; cards stay visible and locked",async()=>{
 const b=createEmptyPlayerBuild();b.ducks.push({...createEmptyDuck({idFactory:()=>"empty"}),name:"テストDuck"});const before=structuredClone(b),p=await page(b);
 for(const id of ["dice-0","stat-AT","stat-DF","stat-SP","a-trigger","c-mode"]) assert.equal(p.get(id),undefined,id);
 const groups=p.get("dice-type").children.filter(e=>e.tagName==="optgroup");
 assert.deepEqual(groups.map(g=>[g.label,g.children.map(o=>o.value)]),[["カスタマイズ",["custom-speed","custom-normal","custom-heavy"]],["プリセット",["preset-standard","preset-void"]]]);
 assert.match(groups[0].textContent,/スピード（SP3）/);assert.match(groups[1].textContent,/ヴォイド（SP1）/);
 assert.equal(p.all().filter(e=>e.tagName==="section"&&["A SKILL / Aスキル","C SKILL / Cスキル"].includes(e.attributes["aria-label"])).length,2);
 assert.equal(p.all().filter(e=>e.tagName==="p"&&e.textContent==="ステータスを設定してください").length,2);
 assert.deepEqual(p.save(),before);p.choose("dice-type","custom-speed");
 assert.ok(p.get("dice-0"));for(const key of ["AT","DF"]) assert.equal(p.get("stat-"+key).tagName,"select");
 assert.equal(p.get("stat-SP").tagName,"span");assert.equal(p.get("stat-SP").textContent,"SP 3");
 assert.equal(p.get("stat-AT").value,"0");assert.equal(p.get("a-trigger"),undefined);assert.equal(p.save().ducks[0].stats.AT,null);
});
test("0..5 stay visible and pt shortage candidates are disabled",async()=>{
 const b=initial();b.ducks[0].stats={AT:4,DF:null,SP:3};b.ducks[0].diceFrame="custom-speed";b.ducks[0].dice=[1,2,3,4,0,0];
 const before=structuredClone(b),p=await page(b);
 assert.deepEqual(p.get("stat-DF").children.map(o=>[o.value,o.disabled,o.textContent]),[["0",false,"0"],["1",false,"1"],["2",false,"2"],["3",true,"3（pt不足）"],["4",true,"4（pt不足）"],["5",true,"5（pt不足）"]]);
 assert.deepEqual(b,before);p.choose("stat-DF","1");assert.match(p.get("stat-metrics").textContent,/ステータス合計：8 \/ 9/);
 assert.ok(p.get("a-trigger"));assert.ok(p.get("c-mode"));p.choose("stat-AT","0");assert.equal(p.get("a-trigger"),undefined);
 assert.deepEqual(p.get("stat-DF").children.map(o=>o.value),["0","1","2","3","4","5"]);
});
test("lock preserves A/C through save/reload and re-unlock",async()=>{
 const b=initial();b.ducks[0].cSelection={mode:"normal",structure:{kind:"flat",effects:[{effectId:"heal",targetId:"self",options:{amount:"healAmount-30"}}]}};
 const a=structuredClone(b.ducks[0].aSelection),c=structuredClone(b.ducks[0].cSelection);
 let p=await page(b);p.choose("stat-AT","0");assert.equal(p.get("a-effect-0"),undefined);assert.equal(p.get("c-effect-flat-0"),undefined);
 let saved=p.save();assert.deepEqual(saved.ducks[0].aSelection,a);assert.deepEqual(saved.ducks[0].cSelection,c);
 p=await page(saved);assert.equal(p.get("a-trigger"),undefined);p.choose("stat-AT","4");
 assert.equal(p.get("a-trigger").value,"exact:6");assert.equal(p.get("c-effect-flat-0").value,"heal");assert.match(p.get("c-metrics").textContent,/必要AP/);
 p.choose("stat-DF","0");saved=p.save();assert.deepEqual(saved.ducks[0].aSelection,a);assert.deepEqual(saved.ducks[0].cSelection,c);
});
test("old ID remains disabled and read-only without dice/stats controls",async()=>{
 const b=initial();b.ducks[0].diceFrame="heavy";const before=structuredClone(b),p=await page(b);
 assert.equal(p.get("dice-type").value,"heavy");assert.ok(p.get("dice-type").children.find(o=>o.value==="heavy").disabled);
 assert.equal(p.get("dice-0"),undefined);assert.equal(p.get("stat-AT"),undefined);assert.deepEqual(b,before);
});
