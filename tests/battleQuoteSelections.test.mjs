import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyPlayerPresentation, createEmptyDuckPresentation, LEGACY_QUOTE_PATHS } from "../js/playerPresentationModel.js";
import { buildBattlePresentationSnapshot } from "../js/battlePresentationSnapshot.js";
import { freezeBattleQuoteSelections } from "../js/battleQuoteSelections.js";
import { createQuotePresenter } from "../js/resultPresentation.js";
import { buildBlocks } from "../js/resultBlocks.js";
const line=(text,opponentEno=null,iconSlot=null)=>({text,opponentEno,iconSlot});
const eno="9223372036854775807";
function display(lines, opponent=eno) {
 const p=createEmptyPlayerPresentation();p.battler.defaultIconUrl="default.png";p.battler.iconSlots[0]="extra.png";
 p.ducks.duck=createEmptyDuckPresentation();p.ducks.other=createEmptyDuckPresentation();
 for(const path of LEGACY_QUOTE_PATHS){const source=path[0]==="skill"&&["A","C"].includes(path[1])?p.ducks.duck.quotes:p.battler.quotes;
 path.slice(0,-1).reduce((v,k)=>v[k],source)[path.at(-1)]={lines:structuredClone(lines)};}
 p.ducks.other.quotes.skill.A.lines[0].text="wrong Duck";
 return buildBattlePresentationSnapshot(p,"duck",opponent);
}
const skill=(category="A",actor="P1",groupId=1)=>({type:category==="C"?"cSkillActivated":"skillTriggered",actor,groupId,skill:{category}});
const choose=(lines,rng=()=>0,opponent=eno)=>freezeBattleQuoteSelections([skill()],{P1:display(lines,opponent)},rng).events[0].quoteSelections.P1;
test("normal pool, empty primary, whitespace and exact string ENo priority",()=>{
 const pool=[line("base"),line("normal",null,1),line("target",eno),line("other","9007199254740992"),line("  ",eno)];
 assert.equal(choose(pool,()=>0).text,"target");assert.equal(choose(pool,()=>.99).text,"target");
 assert.equal(choose(pool,()=>0,"7").text,"base");assert.deepEqual(choose(pool,()=>.99,"7"),{text:"normal",iconUrl:"extra.png"});
 assert.equal(choose([line(""),line("extra")]).text,"extra");
 assert.equal(choose([line(" "),line("other","7")]),null);
 assert.equal(choose([line("base"),line(" ",eno)]).text,"base");
 assert.equal(choose([line("base"),line("one",eno),line("two",eno)],()=>0).text,"one");
 assert.equal(choose([line("base"),line("one",eno),line("two",eno)],()=>.999).text,"two");
 assert.equal(choose([line("base"),line("near","9223372036854775806")]).text,"base");
 assert.equal(choose([line(""),line("missing slot",null,2)]).iconUrl,"default.png");
});
test("five A activations draw independently; duplicate group does not speak twice",()=>{
 const events=Array.from({length:5},(_,i)=>skill("A","P1",i));events.splice(1,0,events[0]);
 let calls=0;const p={P1:display([line("one"),line("two")])},before=structuredClone(events);
 const frozen=freezeBattleQuoteSelections(events,p,()=>calls++%2?.99:0);
 assert.deepEqual(frozen.events.filter(e=>e.quoteSelections).map(e=>e.quoteSelections.P1.text),["one","two","one","two","one"]);
 assert.equal(calls,5);assert.deepEqual(events,before);assert.doesNotMatch(JSON.stringify(frozen.presentations),/candidates|opponentEno/);
 const replay=()=>{const render=createQuotePresenter(frozen.presentations);return JSON.parse(JSON.stringify(frozen.events)).flatMap(render);};
 assert.deepEqual(replay(),replay());assert.equal(replay().length,5);
});
test("all utterance opportunities on both sides persist, including situations and all results",()=>{
 const p={P1:display([line(""),line("P1",eno,1)]),P2:display([line(""),line("P2",eno,1)])};
 for(const result of ["P1_win","P2_win","draw"]){
 const events=[{type:"battleStart",meta:{P1:{maxHP:100},P2:{maxHP:100}}}];
 for(const [turn,hp] of [[1,{P1:100,P2:100}],[2,{P1:10,P2:100}],[3,{P1:100,P2:10}]]){
 events.push({type:"turnStart",turn,state:{hp}});
 for(let n=0;n<3;n++)for(const actor of ["P1","P2"])events.push({type:"phaseStart",turn,actor});}
 for(const actor of ["P1","P2"])for(const category of ["A","B","C","D"])events.push(skill(category,actor,category));
 events.push({type:"battleEnd",result});
 const frozen=freezeBattleQuoteSelections(events,p,()=>0);
 assert.ok(frozen.events.every(e=>Object.hasOwn(e,"quoteSelections")));
 for(const e of frozen.events)for(const [side,q] of Object.entries(e.quoteSelections))assert.deepEqual(q,{text:side,iconUrl:"extra.png"});
 const render=createQuotePresenter(frozen.presentations);assert.ok(frozen.events.flatMap(render).every(row=>!row.text.includes("wrong Duck")));
 const context={presentations:frozen.presentations,maxHP:{P1:100,P2:100},names:{P1:{battler:"1",duck:"1"},P2:{battler:"2",duck:"2"}}};
 assert.deepEqual(buildBlocks(frozen.events,result,context),buildBlocks(JSON.parse(JSON.stringify(frozen.events)),result,JSON.parse(JSON.stringify(context))));
 }
});
test("legacy results retain basic dialogue; persisted null never falls back",()=>{
 const p={P1:display([line("old")])},event=skill();
 assert.match(createQuotePresenter(p)(event)[0].text,/old/);
 assert.deepEqual(createQuotePresenter(p)({...event,quoteSelections:{P1:null}}),[]);
 const frozen=freezeBattleQuoteSelections([event],p,()=>0);
 assert.deepEqual(createQuotePresenter(p)(event),createQuotePresenter(frozen.presentations)(frozen.events[0]));
});
