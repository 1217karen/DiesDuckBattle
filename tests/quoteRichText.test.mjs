import { battleResultRpcFixture } from "./battleResultRpcFixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderQuoteRichText } from "../js/quoteRichText.js";
import { editQuoteMarkup, createQuoteToolbar } from "../js/quoteRichTextToolbar.js";
import { makeQuoteRowLine } from "../js/resultPresentation.js";
import { buildBattlePresentationSnapshot } from "../js/battlePresentationSnapshot.js";
import { createEmptyPlayerPresentation } from "../js/playerPresentationModel.js";
import { createPlayerPresentationStorage } from "../js/playerPresentationStorage.js";
import { createBattleResultStorage } from "../js/battleResultStorage.js";
import { FIXED_IMAGES, setImageFromCandidates } from "../js/fixedImages.js";

for(const tag of ["b","i","u"])test(`quote renderer: ${tag}`,()=>{
 assert.equal(renderQuoteRichText(`<${tag}>行くぞ！</${tag}>`),`<${tag}>行くぞ！</${tag}>`);
});
for(const tag of ["small","big"])test(`quote renderer: ${tag} and bounded nested sizes`,()=>{
 assert.equal(renderQuoteRichText(`<${tag}>文字</${tag}>`),`<span class="quote-text-${tag}">文字</span>`);
 const input=`<${tag}>`.repeat(500)+"文字"+`</${tag}>`.repeat(500),html=renderQuoteRichText(input);
 assert.equal((html.match(/class="quote-text-/g)??[]).length,1);
 assert.doesNotMatch(html,/<small>|<big>/);
 assert.equal(renderQuoteRichText("<big>大<small>内側</small></big>"),'<span class="quote-text-big">大内側</span>');
});
test("ruby uses the whole adjacent rb/rt pair, including safe nested decoration",()=>{
 assert.equal(renderQuoteRichText("<rb>雷</rb><rt>サンダー</rt>"),"<ruby>雷<rt>サンダー</rt></ruby>");
 assert.equal(renderQuoteRichText("<rb><b>雷</b></rb><rt>  サン  ダー </rt>"),"<ruby><b>雷</b><rt>  サン  ダー </rt></ruby>");
});
test("plain quotes escape exactly as before, retaining whitespace",()=>{
 assert.equal(renderQuoteRichText('  雷 < > & "\'  '),'  雷 &lt; &gt; &amp; &quot;&#39;  ');
});
for(const input of ['<script>alert(1)</script>','<img src=x onerror=alert(1)>','<a href=javascript:alert(1)>雷</a>','<b onclick=alert(1)>雷</b>','<br>','<s>雷</s>','<svg><foreignObject>雷</foreignObject></svg>'])test(`unknown markup/attributes are inert: ${input}`,()=>{
 const html=renderQuoteRichText(input);assert.doesNotMatch(html,/<(?:script|img|a|b|br|s|svg|foreignObject)(?:\s|>)/i);
 assert.ok(html.includes("&lt;"));
});
for(const input of ['<b>未閉鎖','<b><i>雷</b></i>','<rt>読みだけ</rt>','<rb>雷</rb>','<rb>雷</rb><rt>未閉鎖','<<<<','<big><small></big>'])test(`malformed markup is safe: ${input}`,()=>{
 const html=renderQuoteRichText(input);assert.equal(typeof html,"string");assert.doesNotMatch(html,/<rb>|<small>|<big>/);
});
for(const tag of ["b","i","u","small","big"])test(`toolbar wraps a selection and inserts at an empty caret: ${tag}`,()=>{
 assert.deepEqual(editQuoteMarkup("雷アタック",0,1,tag),{text:`<${tag}>雷</${tag}>アタック`,selectionStart:tag.length+2,selectionEnd:tag.length+3});
 const edit=editQuoteMarkup("雷",1,1,tag);assert.equal(edit.text,`雷<${tag}></${tag}>`);assert.equal(edit.selectionStart,edit.selectionEnd);assert.equal(edit.selectionStart,1+tag.length+2);
});
test("ruby toolbar selects the reading placeholder immediately",()=>{
 const edit=editQuoteMarkup("雷アタック",0,1,"rb");assert.equal(edit.text,"<rb>雷</rb><rt>ルビ</rt>アタック");
 assert.equal(edit.text.slice(edit.selectionStart,edit.selectionEnd),"ルビ");
 const empty=editQuoteMarkup("雷",1,1,"rb");assert.equal(empty.text,"雷<rb></rb><rt>ルビ</rt>");assert.equal(empty.text.slice(empty.selectionStart,empty.selectionEnd),"ルビ");
 assert.throws(()=>editQuoteMarkup("雷",0,1,"br"));
});
test("toolbar has six controls and updates the input and its persisted string callback",()=>{
 const doc={createElement(){return {children:[],handlers:{},setAttribute(){},append(node){this.children.push(node);},addEventListener(type,handler){this.handlers[type]=handler;}};}};
 let changed;
 const input={value:"  雷アタック  ",selectionStart:2,selectionEnd:3,focus(){this.focused=true;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}};
 const toolbar=createQuoteToolbar(input,value=>{changed=value;},doc);
 assert.deepEqual(toolbar.children.map(b=>b.textContent),["B","I","U","rb","小","大"]);
 toolbar.children[3].handlers.click();assert.equal(changed,"  <rb>雷</rb><rt>ルビ</rt>アタック  ");assert.equal(input.value,changed);assert.equal(input.value.slice(input.selectionStart,input.selectionEnd),"ルビ");assert.equal(input.focused,true);
});
test("quote image candidate fallback advances to default/fixed and stops on terminal failure",()=>{
 const img={};setImageFromCandidates(img,["slot.png","default.png"],FIXED_IMAGES.battlerIcon);
 assert.equal(img.src,"slot.png");img.onerror();assert.equal(img.src,"default.png");img.onerror();assert.equal(img.src,FIXED_IMAGES.battlerIcon);img.onerror();assert.equal(img.onerror,null);
 setImageFromCandidates(img,[],FIXED_IMAGES.battlerIcon);assert.equal(img.src,FIXED_IMAGES.battlerIcon);
 setImageFromCandidates(img,["same.png","same.png"],FIXED_IMAGES.battlerIcon);img.onerror();assert.equal(img.src,FIXED_IMAGES.battlerIcon);
});
test("saved quote markup and spaces stay unchanged in presentation and past battle snapshots",async()=>{
 const entries=new Map(),backend={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)};
 const p=createEmptyPlayerPresentation();p.battler.quotes.battleStart={text:"  <b>行くぞ！</b> <rb>雷</rb><rt>サンダー</rt>  ",iconSlot:null};
 const original=p.battler.quotes.battleStart.text,repo=createPlayerPresentationStorage(backend);assert.equal(repo.save(p).ok,true);assert.equal(repo.load().presentation.battler.quotes.battleStart.text,original);
 assert.equal(repo.load().presentation.schemaVersion,1);assert.deepEqual(Object.keys(repo.load().presentation.battler.quotes.battleStart),["text","iconSlot"]);
 const snapshot=buildBattlePresentationSnapshot(p,"duck"),side={battlerId:"b",battlerName:"主人",duckId:"duck",duckName:"アヒル",presentation:snapshot};
 const record={battleId:"rich-quotes",dateISO:"2026-10-04",p1:side,p2:side,result:"draw",events:[]},battles=createBattleResultStorage(battleResultRpcFixture("rich-quotes"));
 assert.equal((await battles.save(record)).ok,true);p.battler.quotes.battleStart.text="後の変更";
 const saved=(await battles.load("rich-quotes")).record.p1.presentation.quotes.battleStart;
 assert.equal(saved.text,original);assert.match(makeQuoteRowLine(saved,null)[0].text,/<b>行くぞ！<\/b> <ruby>雷<rt>サンダー<\/rt><\/ruby>/);
 assert.ok(makeQuoteRowLine({text:"昔のセリフ",iconUrl:""},null)[0].text.includes('>昔のセリフ</div>'));
});
test("quote editor CSS keeps 60px icons, compact toolbar and responsive editor; result sizes are explicit",async()=>{
 const css=await readFile(new URL("../css/character.css",import.meta.url),"utf8");
 assert.match(css,/grid-template-columns:90px 60px minmax\(0,1fr\)/);assert.match(css,/\.quote-picker \{[^}]*width:60px; height:60px/);
 assert.match(css,/\.quote-picker img \{[^}]*width:100%; height:100%; object-fit:contain/);assert.match(css,/\.quote-label \{ grid-column:1 \/ -1/);
 const result=await readFile(new URL("../css/result.css",import.meta.url),"utf8");assert.match(result,/quote-text-small \{ font-size:0\.8em/);assert.match(result,/quote-text-big \{ font-size:1\.5em/);
});
