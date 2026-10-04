import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makeCSkillCutinLines, attachCutinImages } from "../js/resultPresentation.js";
import { buildBlocks } from "../js/resultBlocks.js";
const presentations={P1:{cutinUrl:"one.png",quotes:{skill:{C:{text:"Cセリフ",iconUrl:"icon.png"}}}},P2:{cutinUrl:"two.png"}};
const context={presentations,maxHP:{P1:100,P2:100},names:{P1:{battler:"一",duck:"一羽"},P2:{battler:"二",duck:"二羽"}}};
const phase=actor=>({type:"phaseStart",actor,turn:1,phase:1});
const activation=(actor,extra={})=>({type:"cSkillActivated",actor,turn:1,phase:1,groupId:"c",...extra});
const effect={type:"valueChanged",actor:"P1",target:"P1",key:"hp",delta:10,before:50,after:60,groupId:"c"};
for(const actor of ["P1","P2"])test(`normal C ${actor}: activation/quote/cut-in/effects; no skill indentation`,()=>{
 const blocks=buildBlocks([{type:"battleStart"},phase(actor),activation(actor),effect],"draw",context);
 const block=blocks.find(b=>b.side===actor),lines=block.lines;
 const index=lines.findIndex(l=>l.kind.startsWith("c-cutin"));assert.ok(index>0);
 assert.equal(lines[index].kind,`c-cutin ${actor.toLowerCase()}`);assert.match(lines[index].text,new RegExp(presentations[actor].cutinUrl));
 assert.doesNotMatch(lines[index].kind,/skill/);assert.ok(lines[index+1].text.includes("10"));
 if(actor==="P1"){assert.equal(lines[index-1].kind,"quoteLine skill");assert.match(lines[index-1].text,/Cセリフ/);}
 assert.equal(lines.filter(l=>l.kind.startsWith("c-cutin")).length,1);
});
for(const actor of ["P1","P2"])for(const canonical of [{mode:"special"},{trigger:"beforeTurnEnd"},{trigger:"turnEnd"}])test(`special C ${actor} ${JSON.stringify(canonical)} centers in system tail`,()=>{
 const blocks=buildBlocks([{type:"battleStart"},phase(actor),activation(actor,canonical),effect,{type:"turnEnd",turn:1}],"draw",context);
 const block=blocks.find(b=>b.lines.some(l=>l.kind.startsWith("c-cutin")));
 assert.equal(block.side,"system");const line=block.lines.find(l=>l.kind.startsWith("c-cutin"));assert.equal(line.kind,"c-cutin center");
 assert.ok(block.lines.some(l=>l.text.includes("10")));
});
test("only actual C activation with nonempty snapshot cut-in renders; absent old data is safe",()=>{
 for(const type of ["skillTriggered","valueChanged","passiveSkillStateChanged","roll"])assert.deepEqual(makeCSkillCutinLines({type,actor:"P1",skill:{category:"C"}},presentations),[]);
 for(const value of ["",undefined,"  "])assert.deepEqual(makeCSkillCutinLines(activation("P1"),{P1:{cutinUrl:value}}),[]);
 assert.deepEqual(makeCSkillCutinLines(activation("P1")),[]);
 assert.deepEqual(makeCSkillCutinLines(activation("P3"),presentations),[]);
 const line=makeCSkillCutinLines(activation("P1"),{P1:{cutinUrl:'x" onerror="alert(1)<>&'}})[0];
 assert.match(line.text,/&quot;/);assert.doesNotMatch(line.text,/src="x" onerror=/);assert.doesNotMatch(line.text,/data-fallback/);
});
test("failed cut-in loads hide entire row without fallback, including cached failures",()=>{
 for(const cached of [false,true]){
  let error;const img={complete:cached,naturalWidth:0,addEventListener(type,fn){assert.equal(type,"error");error=fn;}};
  const row={hidden:false,querySelectorAll(selector){assert.equal(selector,"img[data-c-cutin]");return[img];}};
  attachCutinImages(row);if(!cached){assert.equal(row.hidden,false);error();}assert.equal(row.hidden,true);
 }
});
test("shared result and preview CSS cap natural size without stretching or cropping",async()=>{
 for(const file of ["result","character"]){const css=await readFile(new URL(`../css/${file}.css`,import.meta.url),"utf8");
  assert.match(css,/width:auto; height:auto; max-width:min\(480px,100%\); max-height:480px; object-fit:contain/);
 }
 const css=await readFile(new URL("../css/result.css",import.meta.url),"utf8");
 assert.match(css,/\.line\.c-cutin\.p2\s*\{ justify-content:flex-end/);assert.match(css,/\.line\.c-cutin\.center\s*\{ justify-content:center/);
});
