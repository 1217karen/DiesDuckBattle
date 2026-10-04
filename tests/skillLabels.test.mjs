import { battleResultRpcFixture } from "./battleResultRpcFixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEmptyPlayerBuild, createEmptyDuck, clonePlayerBuild, updateDuck, updateBattler, duplicateDuck } from "../js/playerBuildModel.js";
import { migratePlayerBuild } from "../js/playerBuildMigration.js";
import { createPlayerBuildStorage, PLAYER_BUILD_STORAGE_KEY, V2_PLAYER_BUILD_STORAGE_KEY, LEGACY_PLAYER_BUILD_STORAGE_KEY } from "../js/playerBuildStorage.js";
import { validSkillLabel } from "../js/skillLabels.js";
import { encodeOnlinePlayer, decodeOnlinePlayer } from "../js/onlinePlayerDto.js";
import { compileBattleLoadout } from "../js/battleLoadoutCompiler.js";
import { getOpponent } from "../js/opponentSource.js";
import { runBattle } from "../js/battleEngine.js";
import { buildBlocks, renderSkillDisplayName } from "../js/resultBlocks.js";
import { createBattleResultStorage } from "../js/battleResultStorage.js";
import { player, a, da } from "./onlineSelectFixture.mjs";

const label = {name:"雷アタック",ruby:"   サン   ダー      "};
function memory(entries=[]) {
  const values=new Map(entries);
  return {values,writes:0,getItem:k=>values.get(k)??null,setItem(k,v){this.writes++;values.set(k,v);}};
}
const draft = () => ({...createEmptyPlayerBuild(),ducks:[createEmptyDuck({idFactory:()=>"one"}),createEmptyDuck({idFactory:()=>"two"})]});

test("skill metadata ownership, selection independence and Duck duplication",()=>{
  let build=draft();build.ducks[0].aSelection={triggerId:"exact:1",effects:[]};build.battler.bSelection={type:"trait"};
  const selections=structuredClone([build.ducks[0].aSelection,build.battler.bSelection]);
  build=updateDuck(build,"one",{skillLabels:{A:label,C:{name:"回復",ruby:"ヒール"}}});
  build=updateBattler(build,{skillLabels:{B:label,D:{name:"骰子",ruby:"ダイス"}}});
  assert.deepEqual([build.ducks[0].aSelection,build.battler.bSelection],selections);
  assert.deepEqual(build.ducks[1].skillLabels,{A:{name:"",ruby:""},C:{name:"",ruby:""}});
  build=duplicateDuck(build,"one",{idFactory:()=>"copy"});
  assert.deepEqual(build.ducks[2].skillLabels,build.ducks[0].skillLabels);
  build=updateDuck(build,"copy",{skillLabels:{A:{name:"別名",ruby:""},C:{name:"",ruby:""}}});
  assert.deepEqual(build.ducks[0].skillLabels.A,label);
  assert.deepEqual(build.battler.skillLabels.B,label);
  const before=structuredClone(build.ducks[0].skillLabels);
  build=updateDuck(build,"one",{aSelection:null,cSelection:null});
  assert.deepEqual(build.ducks[0].skillLabels,before);
});

for(const [name,ruby,valid] of [["名".repeat(15)," ".repeat(50),true],["名".repeat(16),"",false],["","ル".repeat(51),false],["😀".repeat(15),"ル".repeat(50),true],[null,"",false],["",42,false]]) {
  test(`model enforces name/ruby limits: ${String(name).length}/${String(ruby).length}/${valid}`,()=>{
    assert.equal(validSkillLabel({name,ruby}),valid);
    const b=draft();b.ducks[0].skillLabels.A={name,ruby};
    if(valid)assert.deepEqual(clonePlayerBuild(b),b);else assert.throws(()=>clonePlayerBuild(b));
    b.battler.skillLabels.B={name,ruby};
    if(!valid)assert.throws(()=>clonePlayerBuild(b));
  });
}

test("v3 storage roundtrip preserves leading, trailing and repeated ruby spaces exactly",()=>{
  const b=draft();for(const owner of [b.battler,...b.ducks]) for(const key of Object.keys(owner.skillLabels))owner.skillLabels[key]={...label};
  const repo=createPlayerBuildStorage(memory());assert.equal(repo.save(b).ok,true);
  assert.deepEqual(repo.load().build,b);
  for(const owner of [repo.load().build.battler,...repo.load().build.ducks])for(const value of Object.values(owner.skillLabels))assert.equal(value.ruby,label.ruby);
});

for(const version of [1,2])test(`v${version} migration fills empty labels without writing or changing source`,async()=>{
  const old=version===1?(await getOpponent("dev-opponent-2")).build:await currentBuild();
  old.schemaVersion=version;delete old.battler.skillLabels;for(const duck of old.ducks)delete duck.skillLabels;
  const raw=JSON.stringify(old),key=version===1?LEGACY_PLAYER_BUILD_STORAGE_KEY:V2_PLAYER_BUILD_STORAGE_KEY;
  const store=memory([[key,raw]]),repo=createPlayerBuildStorage(store),loaded=repo.load();
  assert.equal(loaded.ok,true);assert.equal(loaded.migratedFrom,version);assert.equal(loaded.build.schemaVersion,3);
  assert.equal(store.writes,0);assert.equal(JSON.stringify(old),raw);
  assert.deepEqual(loaded.build.battler.skillLabels,{B:{name:"",ruby:""},D:{name:"",ruby:""}});
  for(const duck of loaded.build.ducks)assert.deepEqual(duck.skillLabels,{A:{name:"",ruby:""},C:{name:"",ruby:""}});
  if(version===2)assert.deepEqual(loaded.build.ducks[0].aSelection,old.ducks[0].aSelection);
  assert.equal(repo.save(loaded.build).ok,true);assert.equal(store.values.get(key),raw);
  assert.equal(JSON.parse(store.values.get(PLAYER_BUILD_STORAGE_KEY)).schemaVersion,3);
  const options={duckId:old.ducks[0].id,battlerId:"p",battlerName:"名前"};
  assert.deepEqual(compileBattleLoadout(old,options),compileBattleLoadout(loaded.build,options));
});

test("online v3 roundtrip preserves labels, v2 loads with blank labels and saves as v3",async()=>{
  const {data}=await player(a,"1",da);
  data.build.ducks[0].skillLabels.A={...label};data.build.battler.skillLabels.B={...label};
  const dto=encodeOnlinePlayer(data);assert.deepEqual(decodeOnlinePlayer(dto),data);
  const v2=structuredClone(dto);v2.battler.build.schemaVersion=2;delete v2.battler.build.skillLabels;
  for(const d of v2.ducks){d.build.schemaVersion=2;delete d.build.skillLabels;}
  const before=JSON.stringify(v2),loaded=decodeOnlinePlayer(v2);
  assert.equal(JSON.stringify(v2),before);assert.equal(loaded.build.schemaVersion,3);
  assert.deepEqual(loaded.build.ducks[0].skillLabels.A,{name:"",ruby:""});
  assert.equal(encodeOnlinePlayer(loaded).battler.build.schemaVersion,3);
  dto.ducks[0].build.skillLabels.A.ruby="x".repeat(51);assert.throws(()=>decodeOnlinePlayer(dto));
});

async function currentBuild(){return migratePlayerBuild((await getOpponent("dev-opponent-2")).build).build;}
const compile=(b,id="P1")=>compileBattleLoadout(b,{duckId:b.ducks[0].id,battlerId:id,battlerName:id});
const battle=(p1,p2)=>runBattle({p1:{battlerId:p1.battler.id,duckId:p1.duck.id},p2:{battlerId:p2.battler.id,duckId:p2.duck.id},data:{BATTLERS:[p1.battler,p2.battler],DUCKS:[p1.duck,p2.duck]},maxTurns:12,rng:()=>0.75,field:null});

test("A/B/C/D snapshot metadata reaches actual engine events and saved records, without changing combat",async()=>{
  const b=await currentBuild();b.ducks[0].aSelection.triggerId="all";
  // AP-based B fires every turn; C becomes available during this battle.
  b.battler.bSelection={type:"trait",traitId:"ap-at",options:{}};
  const blank=compile(b),otherBuild=await currentBuild();otherBuild.ducks[0].id="other";const other=compile(otherBuild,"P2");
  for(const owner of [b.battler,b.ducks[0]])for(const k of Object.keys(owner.skillLabels))owner.skillLabels[k]={name:`${k}雷`,ruby:label.ruby};
  const loadout=compile(b);assert.equal(loadout.ok,true);
  for(const [k,skill]of [["A",loadout.duck.aSkill],["B",loadout.battler.bSkills[0]],["C",loadout.duck.cSkill],["D",loadout.battler.dSkill]])assert.deepEqual([skill.skillName,skill.skillRuby],[`${k}雷`,label.ruby]);
  const result=battle(loadout,other),baseline=battle(blank,other);
  const withoutLabels=v=>JSON.parse(JSON.stringify(v,(key,value)=>["skillName","skillRuby"].includes(key)?undefined:value));
  assert.deepEqual(withoutLabels(result),withoutLabels(baseline));
  for(const k of ["A","B","C","D"]){
    const events=result.events.filter(e=>e.actor==="P1"&&e.skill?.category===k);
    assert.ok(events.length,k);for(const e of events)assert.deepEqual([e.skill.skillName,e.skill.skillRuby],[`${k}雷`,label.ruby]);
  }
  const side=(p)=>({battlerId:p.battler.id,battlerName:p.battler.name,duckId:p.duck.id,duckName:p.duck.name});
  const record={battleId:"names",dateISO:new Date().toISOString(),p1:side(loadout),p2:side(other),result:result.result,events:result.events};
  const repo=createBattleResultStorage(battleResultRpcFixture("names"));const saved=await repo.save(record);assert.equal(saved.ok,true);
  const expected=structuredClone({...record,battleId:saved.battleId,battleNo:saved.battleNo,dateISO:saved.dateISO});
  b.ducks[0].skillLabels.A.name="変更";b.battler.skillLabels.B.ruby="変更";
  assert.equal(loadout.duck.aSkill.skillName,"A雷");assert.equal(loadout.battler.bSkills[0].skillRuby,label.ruby);
  assert.deepEqual((await repo.load("names")).record,expected);
});

test("multiple compiled B rules share one Battler label snapshot",async()=>{
  const b=await currentBuild();b.battler.bSelection={type:"trait",traitId:"damage-both-up",options:{}};b.battler.skillLabels.B={...label};
  const r=compile(b);assert.equal(r.ok,true);assert.ok(r.battler.bSkills.length>1);
  for(const skill of r.battler.bSkills)assert.deepEqual([skill.skillName,skill.skillRuby],[label.name,label.ruby]);
});

const context={maxHP:{P1:100,P2:100},names:{P1:{battler:"主人",duck:"アヒル"},P2:{battler:"敵",duck:"相手"}}};
function textFor(event){return buildBlocks([{type:"battleStart"},{type:"phaseStart",actor:"P1",turn:1,phase:1},event],"draw",context).flatMap(b=>b.lines).map(l=>l.text).join("\n");}
for(const category of ["A","B","C","D"])test(`${category} result uses the common safe whole-name renderer, hides ruby-only labels`,()=>{
  const event={type:category==="C"?"cSkillActivated":"skillTriggered",actor:"P1",turn:1,phase:1,skill:{category,skillName:"雷<&>",skillRuby:"  サン   ダー &<>  "}};
  assert.match(textFor(event),/<br><span class="skill-display-name"><ruby>雷&lt;&amp;&gt;<rt>  サン   ダー &amp;&lt;&gt;  <\/rt><\/ruby><\/span>/);
  assert.doesNotMatch(textFor(event),/雷<&>|サン   ダー &<>/);
  event.skill.skillRuby="";assert.match(textFor(event),/<span class="skill-display-name">雷&lt;&amp;&gt;<\/span>/);assert.doesNotMatch(textFor(event),/<ruby>/);
  event.skill.skillName="";event.skill.skillRuby="孤立";assert.doesNotMatch(textFor(event),/skill-display-name|孤立|<ruby>/);
});
test("passive B names use the same renderer and oversized record labels are not rendered",async()=>{
  const html=textFor({type:"passiveModifierChanged",actor:"P1",turn:1,phase:1,skill:{category:"B",skillName:label.name,skillRuby:label.ruby},before:{AT:0,DF:0},after:{AT:1,DF:0}});
  assert.ok(html.includes(renderSkillDisplayName(label.name,label.ruby)));
  assert.equal(renderSkillDisplayName("x".repeat(16),""),"");assert.equal(renderSkillDisplayName("ok","x".repeat(51)),"");
  const css=await readFile(new URL("../css/result.css",import.meta.url),"utf8");
  assert.match(css,/\.skill-display-name\s*\{[^}]*font-size:\s*1\.2em/s);
  assert.match(css,/\.skill-display-name rt\s*\{[^}]*white-space:\s*pre/s);
});
