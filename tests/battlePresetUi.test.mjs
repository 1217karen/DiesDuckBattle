import { presentASkill } from "../js/aSkillPresentation.js";
import { presentCSkill } from "../js/cSkillPresentation.js";
import { D_SKILL_OPTIONS } from "../js/dSkillCatalog.js";
import { battlerSummary, duckSummary as characterDuckSummary } from "../js/selectState.js";
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
  assert.equal(children[3].attributes["aria-label"],"ダイス・ステータス");
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


test("Japanese card titles, fixed SP and concise skill guidance",async()=>{
  const p=await page();
  for(const title of ["Ｂスキル","Ｄスキル","Ａスキル","Ｃスキル"]) {
    const card=p.all().find(e=>e.attributes["aria-label"]===title);
    assert.ok(card,title);assert.ok([...card.children,...card.children[0].children].some(e=>e.tagName==="h3"&&e.textContent===title),title);
  }
  const sp=p.get("stat-SP");assert.equal(sp.tagName,"span");assert.equal(sp.textContent,"1（固定）");
  assert.equal(sp.children[1].className,"stat-fixed-hint");assert.equal(sp.children[1].textContent,"（固定）");
  assert.equal(sp.handlers.change,undefined);assert.equal(sp.parent.attributes.role,"group");
  assert.equal(p.all().some(e=>e.tagName==="select"&&e.id==="stat-SP"),false);
  const a=p.all().find(e=>e.attributes["aria-label"]==="Ａスキル");
  assert.ok(a.textContent.includes("使用可能pt初期pt 2 ＋ ダイスpt余剰 0 ＝ 2pt"));
  assert.ok(a.textContent.includes("最大４枠まで効果を選択できます。"));
  const c=p.all().find(e=>e.attributes["aria-label"]==="Ｃスキル");
  assert.ok(c.textContent.includes("最大５枠まで効果を選択できます。効果を分岐させた場合は、最も消費APが多い分岐が必要APに採用されます。"));
});

test("card widths, left aligned dice, shared skill borders and mobile layout rules",async()=>{
  const css=await readFile(new URL("../css/setting.css",import.meta.url),"utf8");
  assert.match(css,/\.battler-grid > \.skill-b, \.battler-grid > \.skill-d\s*\{\s*grid-column:1\s*\/\s*-1/);
  assert.match(css,/\.battle-presets\s*\{[^}]*width:min\(100%,640px\);[^}]*justify-self:start/);
  assert.match(css,/@media\s*\(max-width:700px\)\s*\{\s*\.battle-presets\s*\{\s*width:100%/);
  assert.match(css,/\.dice-grid label\s*\{\s*text-align:left/);
  assert.match(css,/\.dice-grid\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/\.card\.skill-card\s*\{\s*border:1px solid var\(--skill-line\)/);
  for(const kind of ["a","b","c","d"]) assert.equal([...css.matchAll(new RegExp('\\.skill-'+kind+'\\s*\\{[^}]*--skill-line:', 'g'))].length,2);
  assert.match(css,/\.stat-fixed-hint\s*\{[^}]*color:var\(--muted\)/);
  assert.match(css,/\.skill-label-controls\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,2fr\)/);
});


test("compact editor headings and responsive battle layout are scoped",async()=>{
 const css=await readFile(new URL("../css/setting.css",import.meta.url),"utf8");
 const common=await readFile(new URL("../css/common-page.css",import.meta.url),"utf8");
 assert.match(common,/\.page-shell--editor\s*\{[^}]*--page-title-size:clamp\(1\.7rem,4vw,2\.8rem\)/);
 assert.match(common,/font-size:var\(--page-title-size, 2em\)/);
 assert.match(css,/grid-template-columns:repeat\(6,minmax\(70px,90px\)\); justify-content:start/);
 assert.match(css,/\.a-condition-card\s*\{ background:transparent/);
 const mobile=css.slice(css.indexOf("  .setting-shell {"));
 for(const selector of ["label",".description",".metrics","button","select",".effect-meta"]) assert.ok(mobile.includes(".setting-shell "+selector));
 assert.match(mobile,/min-height:42px/);
 for(const file of ["setting.html","character.html"]) assert.match(await readFile(new URL("../"+file,import.meta.url),"utf8"),/page-shell--editor/);
});


test("dice and stats share one card with separate validation and metrics",async()=>{
 const p=await page(),card=p.all().find(e=>e.className==="card dice-stats-card");
 const descendants=e=>[e,...e.children.flatMap(descendants)];
 assert.deepEqual(card.children.map(e=>e.tagName),["section","hr","section"]);
 assert.ok(!card.children.some(e=>e.tagName==="h3"));
 assert.equal(card.children[0].children[0].children[0].textContent,"ダイス");
 assert.equal(card.children[2].children[0].children[0].textContent,"ステータス");
 assert.equal(card.children[1].className,"dice-stats-divider");
 for(const [i,ids] of [[0,["dice-status","dice-metrics","dice-issues"]],[2,["stats-status","stat-metrics","stats-issues"]]])
  for(const id of ids) {assert.ok(p.get(id),id);assert.ok(descendants(card.children[i]).includes(p.get(id)),id);}
});
test("B/C timing label and select stay paired beside their unchanged wrapping hint",async()=>{
 const p=await page();
 for(const [id,hint] of [["b-type","条件を満たす限り、常に発動します。"],["c-mode","自分のフェイズ開始時、APが溜まっていれば発動します。"]]) {
  const input=p.get(id),pair=input.parent,row=pair.parent;
  assert.equal(pair.className,"timing-choice");assert.equal(pair.children[0].textContent,"発動タイミング");
  assert.equal(row.className,"timing-field");assert.equal(row.children[1],p.get(id+"-hint"));assert.equal(row.children[1].textContent,hint);
  assert.equal(input.attributes["aria-describedby"],id+"-hint");
 }
 const css=await readFile(new URL("../css/setting.css",import.meta.url),"utf8");
 assert.match(css,/\.timing-field\s*\{[^}]*flex-wrap:wrap[^}]*min-width:0/);
 assert.match(css,/\.timing-field > \.description\s*\{[^}]*flex:1 1 18em[^}]*overflow-wrap:anywhere/);
 assert.match(css,/\.a-effect-row \.effect-meta \.price-gain/);
 assert.match(css,/\.skill-c \.effect-meta \.price-positive/);
 assert.doesNotMatch(css,/\.a-condition-card[^{}]*\.price-(gain|spend)/);
});


test("condition rows keep paired metadata, shared labels and full-width separators on mobile",async()=>{
 const p=await page(),card=p.get("a-condition-card");
 assert.equal(card.children.length,2);
 for(const row of card.children) assert.deepEqual(row.children.map(e=>e.className),["effect-meta","effect-editor"]);
 const labels=p.all().filter(e=>e.className==="condition-label");assert.deepEqual(labels.map(e=>e.textContent),["発動条件","通常攻撃"]);
 const css=await readFile(new URL("../css/setting.css",import.meta.url),"utf8");
 assert.match(css,/\.a-condition-row \+ \.a-condition-row\s*\{ border-top:1px solid var\(--line\)/);
 assert.match(css,/\.a-condition-row > \.effect-meta\s*\{[^}]*justify-content:center[^}]*border-right:1px solid var\(--line\)/);
 assert.match(css,/\.a-condition-card \.a-condition-row\s*\{[^}]*grid-template-columns:80px minmax\(0,1fr\)/);
 assert.match(css,/\.completed-skill-sentence\s*\{[^}]*color:var\(--accent\)[^}]*border-left:2px solid var\(--accent\)/);
});
for(const preset of DUCK_PRESETS) test(preset.id+" D/A/C completed text uses trusted presentation after totals without changing drafts",async()=>{
 const data=initial();Object.assign(data.build.ducks[0],duckPresetPatch(preset.id));const before=structuredClone(data),p=await page(data),duck=data.build.ducks[0];
 for(const [key,expected] of [["d",D_SKILL_OPTIONS.find(o=>o.id===data.build.battler.dSelection.optionId).label],["a",presentASkill(duck,duck.aSelection).text],["c",presentCSkill(duck.cSelection).text]]) {
  const node=p.get(key+"-completed-sentence");assert.ok(node,key);assert.equal(node.textContent,expected);assert.equal(node.className,"completed-skill-sentence");
  const children=node.parent.children;assert.ok(children.indexOf(node)<children.indexOf(p.get(key+"-issues")));
  if(key!=="d")assert.ok(children.indexOf(p.get(key+"-metrics"))<children.indexOf(node));
 }
 assert.match(p.get("c-completed-sentence").textContent,/^〈AP/);
 assert.deepEqual(p.controller.snapshot().draft,before);assert.equal(p.edits.length,0);assert.equal(p.writes.length,0);
 await p.get("save").handlers.click();assert.deepEqual(p.controller.snapshot().draft,before);
});
for(const invalid of [false,true]) test("unfinished/invalid skill selections suppress completed text: "+invalid,async()=>{
 const data=initial();data.build.battler.dSelection=invalid?{optionId:"unknown"}:null;
 data.build.ducks[0].aSelection=invalid?{triggerId:"unknown",effects:[]}:null;
 data.build.ducks[0].cSelection=invalid?{mode:"normal",structure:{kind:"flat",effects:[{effectId:"unknown"}]}}:null;
 const p=await page(data);for(const key of ["d","a","c"])assert.equal(p.get(key+"-completed-sentence"),undefined);
 assert.deepEqual(p.controller.snapshot().draft,data);
});
test("A over-budget preview matches CHARACTER presentation",async()=>{
 const data=initial();data.build.ducks[0].aSelection={triggerId:"all",effects:[{effectId:"heal",targetId:"self",options:{amount:"amount-10"}}]};
 const p=await page(data);assert.equal(p.get("a-completed-sentence").textContent,presentASkill(data.build.ducks[0],data.build.ducks[0].aSelection).text);
});
test("B keeps its completed sentence with the shared appearance",async()=>{
 const data=initial();Object.assign(data.build.battler,battlerPresetPatch("defense"));const p=await page(data);
 const b=p.all().find(e=>e.className==="card skill-card skill-b");
 const walk=e=>[e,...e.children.flatMap(walk)];const sentences=walk(b).filter(e=>e.className==="completed-skill-sentence");
 assert.equal(sentences.length,1);assert.ok(sentences[0].textContent.includes("反撃"));
});


for(const preset of DUCK_PRESETS) test(preset.id+" all four setting sentences exactly match CHARACTER bodies",async()=>{
 const data=initial();Object.assign(data.build.battler,battlerPresetPatch(preset.id));Object.assign(data.build.ducks[0],duckPresetPatch(preset.id));
 const p=await page(data),b=battlerSummary(data.build.battler),d=characterDuckSummary(data.build.ducks[0]);
 const expected={b:b.split("\nD：")[0].slice(2),d:b.split("\nD：")[1],a:d.split("\nA：")[1].split("\nC：")[0],c:d.split("\nC：")[1]};
 for(const key of ["b","d","a","c"])assert.equal(p.get(key+"-completed-sentence").textContent,expected[key]);
 assert.doesNotMatch(expected.d,/戦闘開始|（1個）/);assert.deepEqual(p.controller.snapshot().draft,data);
});
test("compact identity and colored text use responsive widths and existing palettes",async()=>{
 const css=await readFile(new URL("../css/setting.css",import.meta.url),"utf8");
 assert.match(css,/\.duck-identity\s*\{[^}]*width:min\(100%,500px\)/);
 assert.match(css,/@media\(max-width:700px\)\s*\{ \.duck-identity\s*\{[^}]*width:100%/);
 assert.match(css,/\.skill-card \.completed-skill-sentence\s*\{ color:var\(--skill-heading\); border-left-color:var\(--skill-heading\)/);
 assert.match(css,/\.a-effect-row \.effect-meta \.price-gain,[^{}]*\.skill-c \.effect-meta \.price-negative\s*\{ font-weight:700/);
});
