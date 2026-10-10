import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadSettingPage } from "./settingPageHarness.mjs";
import { createOnlineEditController } from "../js/onlineEditController.js";
import { createEmptyPlayerBuild, createEmptyDuck } from "../js/playerBuildModel.js";
import { createEmptyPlayerPresentation, createEmptyDuckPresentation } from "../js/playerPresentationModel.js";
import { BATTLER_PRESETS, DUCK_PRESETS, battlerPresetPatch, duckPresetPatch } from "../js/battlePresets.js";

function initial(blank=false) {
  const build=createEmptyPlayerBuild();
  if(!blank) Object.assign(build.battler,battlerPresetPatch("attack"));
  build.battler.skillLabels={B:{name:"B名",ruby:"びー"},D:{name:"D名",ruby:"でぃー"}};
  build.ducks=["one","two"].map(id=>({...createEmptyDuck({idFactory:()=>id}),name:id,...(blank ? {} : duckPresetPatch("attack")),skillLabels:{A:{name:"A名",ruby:"えー"},C:{name:"C名",ruby:"しー"}}}));
  const presentation=createEmptyPlayerPresentation();
  presentation.battler.profile.text="プロフィール";
  presentation.ducks.one=createEmptyDuckPresentation();presentation.ducks.two=createEmptyDuckPresentation();
  Object.assign(presentation.ducks.one,{iconUrl:"icon",cutinUrl:"cutin"});presentation.ducks.one.profile.text="アヒルプロフィール";
  presentation.ducks.one.quotes.skill.A.lines[0].text="セリフ";
  return {build,presentation,publicSettings:{schemaVersion:1,publicDuckId:"two"},battlerName:"バトラー名"};
}
async function page(data=initial()) {
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.attributes={};this.value="";this.classList={toggle(){}};}
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
    replaceChildren(...children){this.children=[];this.append(...children);}
    setAttribute(key,value){this.attributes[key]=value;}
    addEventListener(type,fn){this.handlers[type]=fn;}
    focus(){} showModal(){this.open=true;} close(){this.open=false;this.handlers.close?.();}
    remove(){this.parent.children=this.parent.children.filter(e=>e!==this);}
    set textContent(v){this.text=String(v);this.children=[];}
    get textContent(){return (this.text??"")+this.children.map(e=>e.textContent).join("");}
  }
  const body=new Element("body"),walk=e=>[e,...e.children.flatMap(walk)],all=()=>walk(body);
  for(const m of (await readFile(new URL("../setting.html",import.meta.url),"utf8")).matchAll(/\bid="([^"]+)"/g)){const e=new Element("div");e.id=m[1];body.append(e);}
  const get=id=>all().find(e=>e.id===id);
  globalThis.document={body,createElement:tag=>new Element(tag),getElementById:get};globalThis.window={addEventListener(){}};
  globalThis.localStorage={getItem(){throw Error("local storage is not used");},setItem(){throw Error("local storage is not used");}};
  let row={ok:true,account:{id:"account",eno:"1"},authUserId:"auth",revision:"0",data:structuredClone(data)};
  const writes=[],edits=[];let controller;
  const storage={resolveAccount:async()=>structuredClone(row),load:async()=>structuredClone(row),save:async(base,data)=>{
    writes.push(structuredClone(data));row={...base,revision:String(Number(base.revision)+1),data:structuredClone(data)};return structuredClone(row);
  }};
  await loadSettingPage(data.build,()=>{},async({sections,allowDuckPresentationDeletion,hydrate,onState})=>{
    controller=createOnlineEditController({storage,sections,allowDuckPresentationDeletion,confirm:()=>true});
    let version=-1;
    controller.subscribe(next=>{if(next.dataVersion!==version){version=next.dataVersion;hydrate(next.draft);}onState(next);});
    const edit=controller.edit;controller.edit=(...args)=>{edits.push(structuredClone(args));return edit(...args);};
    await controller.load();return controller;
  });
  const button=(text,root=body)=>walk(root).find(e=>e.tagName==="button"&&e.textContent===text);
  const dialog=()=>all().find(e=>e.tagName==="dialog");
  return {get,all,writes,edits,controller,dialog,button,
    choose(id,value){
      if (["battler-preset","duck-preset"].includes(id)) get(id+"-details").open=true;
      const e=get(id);assert.ok(e,`missing ${id}`);assert.ok(e.children.flatMap(o=>o.tagName==="optgroup"?o.children:[o]).some(o=>o.value===value&&!o.disabled),`illegal ${id}/${value}`);e.value=value;e.handlers.change();},
    apply(kind){get(kind+"-preset-apply").handlers.click();},
    confirm(){button("変更する",dialog()).handlers.click();},cancel(){button("取り消す",dialog()).handlers.click();},
  };
}
for(const [kind,presets] of [["battler",BATTLER_PRESETS],["duck",DUCK_PRESETS]]) for(const preset of presets) test(`${kind}/${preset.id}: select, cancel, atomic draft, then explicit save`,async()=>{
  const p=await page(),before=p.controller.snapshot().draft;
  assert.equal(p.get(kind+"-preset-apply").disabled,true);
  p.choose(kind+"-preset",preset.id);
  assert.equal(p.get(kind+"-preset-description").textContent,preset.description);
  assert.equal(p.edits.length,0);assert.equal(p.controller.snapshot().dirty,false);
  p.apply(kind);assert.ok(p.dialog());
  const expectedMessage=kind === "battler"
    ? `現在のB・Dスキル設定を『${preset.label}』プリセットで置き換えます。\n保存するまでは確定されません。`
    : `現在のアヒルの戦闘設定（能力・ダイス・A・C）を『${preset.label}』プリセットで置き換えます。\nアヒル名や表示設定は変更されません。\n保存するまでは確定されません。`;
  assert.ok(p.dialog().textContent.includes(expectedMessage));
  p.cancel();assert.deepEqual(p.controller.snapshot().draft,before);assert.equal(p.edits.length,0);
  p.choose(kind+"-preset",preset.id);p.apply(kind);p.confirm();
  const expected=structuredClone(before);
  if(kind === "battler") Object.assign(expected.build.battler,battlerPresetPatch(preset.id));
  else Object.assign(expected.build.ducks[0],duckPresetPatch(preset.id));
  assert.deepEqual(p.controller.snapshot().draft,expected);
  assert.equal(p.edits.length,1);assert.equal(p.writes.length,0);assert.equal(p.controller.snapshot().dirty,true);
  assert.deepEqual(Object.keys(p.edits[0][0]).sort(),["build","publicSettings"]);
  if(kind === "battler") assert.equal(p.get("d-option").value,preset.dSelection.optionId);
  else {assert.equal(p.get("stat-AT").value,String(preset.stats.AT));assert.equal(p.get("dice-type").value,preset.diceFrame);}
  await p.get("save").handlers.click();
  assert.equal(p.writes.length,1);assert.deepEqual(p.writes[0],expected);assert.equal(p.controller.snapshot().dirty,false);
});
test("blank battle settings apply without confirmation while names and display data remain",async()=>{
  const p=await page(initial(true)),before=p.controller.snapshot().draft;
  for(const kind of ["battler","duck"]){p.choose(kind+"-preset","attack");p.apply(kind);assert.equal(p.dialog(),undefined);}
  assert.equal(p.edits.length,2);assert.equal(p.writes.length,0);
  assert.deepEqual(p.controller.snapshot().draft.presentation,before.presentation);
  assert.equal(p.controller.snapshot().draft.build.ducks[0].name,"one");
});
test("applied samples can be edited again using the ordinary D/stats controls",async()=>{
  const p=await page();p.choose("battler-preset","defense");p.apply("battler");p.confirm();
  p.choose("d-option","add-self-1");assert.equal(p.controller.snapshot().draft.build.battler.dSelection.optionId,"add-self-1");
  p.choose("duck-preset","heal");p.apply("duck");p.confirm();p.choose("stat-AT","1");
  assert.equal(p.controller.snapshot().draft.build.ducks[0].stats.AT,1);
  assert.equal(DUCK_PRESETS.find(p=>p.id === "heal").stats.AT,2);
  assert.equal(p.writes.length,0);
});
test("preset controls are placed before cards, below duck identity controls",async()=>{
  const p=await page();assert.equal(p.get("battler-editor").children[0].id,"battler-presets");
  const children=p.get("duck-editor").children;
  assert.equal(children[2].id,"duck-presets");assert.equal(children[1].className,"duck-meta");
  assert.equal(children[3].attributes["aria-label"],"DICE / ダイス");
});
test("duck confirmation cannot accidentally apply to a different selected duck",async()=>{
  const p=await page();p.choose("duck-preset","heal");p.apply("duck");
  p.get("duck-tab-1").handlers.click();p.confirm();assert.equal(p.edits.length,0);
});

test("native preset disclosures start closed with visible heading/help and compact controls inside",async()=>{
  const p=await page();
  for(const [kind,title] of [["battler","バトラープリセットを使用する"],["duck","アヒルプリセットを使用する"]]) {
    const details=p.get(kind+"-preset-details"),heading=p.get(kind+"-preset-heading"),help=p.get(kind+"-preset-help");
    assert.equal(details.tagName,"details");assert.ok(!details.open);assert.equal(details.attributes.open,undefined);
    const summary=details.children[0];assert.equal(summary.tagName,"summary");
    assert.equal(heading.parent,summary);assert.equal(heading.textContent,title);
    assert.equal(help.parent,summary);assert.equal(help.textContent,"サンプル構成を読み込んで自由に編集できます。");
    assert.equal(summary.attributes["aria-labelledby"],heading.id);assert.equal(summary.attributes["aria-describedby"],help.id);
    assert.doesNotMatch(p.get(kind+"-presets").textContent,/設定を保存|確定されません/);
    const controls=details.children[1];
    assert.deepEqual(controls.children,[p.get(kind+"-preset"),p.get(kind+"-preset-apply")]);
    assert.equal(details.children[2],p.get(kind+"-preset-description"));
    details.open=true;p.choose(kind+"-preset","technical");
    assert.equal(details.open,true);assert.equal(p.get(kind+"-preset-apply").disabled,false);
    assert.ok(p.get(kind+"-preset-description").textContent.includes("出目2") || kind === "battler");
    assert.equal(p.edits.length,0);assert.equal(p.writes.length,0);
  }
});
