import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PLAYER_BUILD_STORAGE_KEY } from "../js/playerBuildStorage.js";
import { createEmptyPlayerBuild } from "../js/playerBuildModel.js";
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

test("実設定UI：文章プルダウン→状態→保存→復元、条件変更で後段クリア", async () => {
  let p=await page();
  assert.match(p.get("b-type").textContent,/トリガー型.*パッシブ型/);
  p.choose("b-type","event"); assert.equal(p.get("b-effect"),undefined);
  p.choose("b-trigger","after-hit"); p.choose("b-condition","damage-medium"); p.choose("b-effect","enemy-debuff");
  p.choose("b-status-option","crack");
  assert.match(p.get("battler-editor").textContent,/攻撃命中後、与えた通常ダメージが7以上なら、相手アヒルに亀裂を2付与する/);
  assert.equal(p.get("b-effect-targetId"),undefined);
  const saved=p.save(); assert.equal(compileBSkill(saved.battler.bSelection).ok,true);
  p=await page(saved); assert.equal(p.get("b-status-option").value,"crack"); assert.equal(p.get("b-effect").value,"enemy-debuff");
  p.choose("b-status-option","random"); assert.match(p.get("battler-editor").textContent,/相手アヒルにランダムな状態異常を2付与する/);
  p.choose("b-effect","self-heal"); assert.equal(p.get("b-status-option"),undefined);
  p.choose("b-condition","always"); assert.equal(p.get("b-effect").value,"");
  p.choose("b-trigger","before-attack"); p.choose("b-condition","self-has-debuff");
  assert.equal(p.get("b-effect"),undefined); assert.match(p.get("battler-editor").textContent,/次の通常攻撃をAT2増加する/);
});

test("実設定UI：パッシブ分類とHP条件→traitId保存→復元、AP補正へ変更", async () => {
  let p=await page();p.choose("b-type","trait");p.choose("b-category","HP条件");
  p.choose("b-hp-condition","自分アヒルのHPが50%以下なら");
  assert.equal(p.get("b-trait").children.filter(e=>e.value).length,5);
  p.choose("b-trait","hp-mid-low-at3-df1"); const saved=p.save();
  assert.deepEqual(saved.battler.bSelection,{type:"trait",traitId:"hp-mid-low-at3-df1",options:{}});
  p=await page(saved);assert.equal(p.get("b-category").value,"HP条件");assert.equal(p.get("b-trait").value,"hp-mid-low-at3-df1");
  p.choose("b-category","AP基準補正"); assert.equal(p.get("b-hp-condition"),undefined);
  assert.equal(p.get("b-trait").value,"");p.choose("b-trait","ap-inverse-df");
  const result=compileBSkill(p.save().battler.bSelection);assert.equal(result.ok,true);assert.equal(result.bSkills[0].modifier.scale,-1);
});
