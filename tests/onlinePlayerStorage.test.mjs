import { legacyQuoteOwnership, legacyDtoQuoteOwnership } from './legacyPresentationFixture.mjs';
import { createEmptyDuckQuotes } from "../js/playerPresentationModel.js";
import { LEGACY_QUOTE_PATHS as QUOTE_PATHS } from "../js/playerPresentationModel.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyPlayerBuild, createEmptyDuck } from "../js/playerBuildModel.js";
import { createEmptyDuckProfile, createEmptyPlayerPresentation } from "../js/playerPresentationModel.js";
import { encodeOnlinePlayer, decodeOnlinePlayer } from "../js/onlinePlayerDto.js";
import { createOnlinePlayerStorage } from "../js/onlinePlayerStorage.js";
const a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222",duckId="33333333-3333-4333-8333-333333333333";
const empty=()=>({build:createEmptyPlayerBuild(),presentation:createEmptyPlayerPresentation(),publicSettings:{schemaVersion:1,publicDuckId:null},battlerName:"DB初期名"});
function fixture(ids=[a]) {
  let user="auth-A", rows=ids, fail=null, sessionCalls=0, switchAt=0;
  const calls=[],db=new Map([a,b].map((id,index)=>[id,{gameAccountId:id,eno:String(index+77),revision:"0",battler:{build:{},presentation:{name:"DB名"+index}},ducks:[],publicDuckId:null}]));
  const client={auth:{getSession:async()=>{sessionCalls++; if(switchAt===sessionCalls)user="changed";return{data:{session:user?{user:{id:user}}:null}};}},
    from:table=>({select:fields=>({eq:async(field,value)=>{calls.push(["access",table,fields,field,value]);return{data:rows.map(id=>({game_account_id:id,game_accounts:{eno:db.get(id).eno}}))};}})}),
    rpc:async(name,params)=>{
      calls.push([name,structuredClone(params)]);
      if(fail==="network")throw Error("upstream secret"); if(fail)return{error:{code:fail,message:"upstream secret"}};
      const id=params.p_game_account_id;if(!rows.includes(id))return{error:{code:"42501"}};
      if(name==="load_online_player")return{data:structuredClone(db.get(id))};
      const old=db.get(id);if(params.p_expected_revision!==old.revision)return{error:{code:"40001"}};
      const next={...old,...structuredClone(params.p_payload),revision:String(BigInt(old.revision)+1n)};db.set(id,next);
      return{data:{revision:next.revision}};
    }};
  return {storage:createOnlinePlayerStorage(client),db,calls,client,fail:code=>{fail=code;},rows:ids=>{rows=ids;},user:id=>{user=id;},switchAt:n=>{switchAt=n;}};
}

test("lossless draft DTO includes incomplete selections, duplicate names, dice, icons, all quote slots and detached icons",()=>{
  const data=empty();const d=createEmptyDuck({idFactory:()=>duckId});d.name="name";d.aSelection={effects:[null,{effectId:null,targetId:"unknown",options:{x:null}}]};
  d.stats.AT=-1;d.dice=[6,6,0,-1,2,3];data.build.ducks.push(d);data.build.battler.bSelection={type:null};
  data.presentation.battler.standingImageUrl="https://example.invalid/full.png";
  data.presentation.battler.iconSlots[9]="slot10";data.presentation.battler.quotes.battleStart={ lines: [{text:"hello",iconSlot:10, opponentEno:null}] };
  data.presentation.ducks[duckId]={ iconUrl:"duck",cutinUrl:"cutin", quotes:createEmptyDuckQuotes(),profile:createEmptyDuckProfile() };data.presentation.ducks.orphan={ iconUrl:"still preserved",cutinUrl:"private-cutin", quotes:createEmptyDuckQuotes(),profile:createEmptyDuckProfile() };
  data.publicSettings.publicDuckId=duckId;
  const dto=encodeOnlinePlayer(data);assert.deepEqual(decodeOnlinePlayer(dto),data);
  dto.ducks[0].build.stats.AT=99;assert.equal(data.build.ducks[0].stats.AT,-1);
});
for(const mutate of [d=>{d.build.schemaVersion=4;},d=>{d.presentation.future="unknown";},d=>{d.presentation.battler.iconSlots.push("eleventh");},d=>{d.publicSettings.publicDuckId=duckId;},d=>{d.build.ducks.push(createEmptyDuck({idFactory:()=>"not-uuid"}));}])test("lossy/unsupported online draft rejected",()=>{const d=empty();mutate(d);assert.throws(()=>encodeOnlinePlayer(d));});
test("registration draft defaults are independent, keep DB names, and do not write during load",async()=>{
  const f=fixture();const first=await f.storage.load();assert.equal(first.data.battlerName,"DB名0");assert.deepEqual(first.data.build,createEmptyPlayerBuild());
  f.rows([b]);const second=await f.storage.load();assert.equal(second.data.battlerName,"DB名1");assert.notEqual(first.account.id,second.account.id);
  assert.equal(f.calls.filter(c=>c[0]==="save_online_player").length,0);
});
test("zero/multiple access require explicit choice; auth UUID is never the game account UUID",async()=>{
  const f=fixture([]);assert.equal((await f.storage.load()).status,"no-access");f.rows([a,b]);
  assert.equal((await f.storage.load()).status,"selection-required");const base=await f.storage.load({gameAccountId:b});assert.equal(base.account.id,b);
  assert.equal((await f.storage.save(base,base.data)).status,"selection-required");
  assert.equal((await f.storage.save(base,base.data,{gameAccountId:b})).ok,true);
  assert.equal(f.calls[0][4],"auth-A");
});
test("arbitrary account IDs and switched identity cannot redirect a loaded draft",async()=>{
  const f=fixture();const base=await f.storage.load();assert.equal((await f.storage.load({gameAccountId:b})).status,"forbidden");
  f.user("auth-B");assert.equal((await f.storage.save(base,base.data)).status,"session-changed");
  assert.equal(f.calls.filter(c=>c[0]==="save_online_player").length,0);
});
test("one-RPC save preserves rows per account, handles Duck add/delete/unpublish and detects stale revision",async()=>{
  const f=fixture();const base=await f.storage.load(),draft=structuredClone(base.data);draft.build.ducks.push(createEmptyDuck({idFactory:()=>duckId}));draft.publicSettings.publicDuckId=duckId;
  const saved=await f.storage.save(base,draft);assert.equal(saved.ok,true);
  assert.deepEqual((await f.storage.load()).data,draft);assert.equal(f.db.get(b).revision,"0");
  assert.equal((await f.storage.save(base,base.data)).status,"conflict");
  draft.build.ducks=[];draft.publicSettings.publicDuckId=null;assert.equal((await f.storage.save(saved,draft)).ok,true);
  assert.deepEqual((await f.storage.load()).data.build.ducks,[]);
});
for(const [error,status] of [["network","save-unknown"],["42501","forbidden"],["40001","conflict"],["40P01","conflict"],["23514","invalid-data"],["PGRST202","migration-required"],["unexpected","save-unknown"]])test("sanitized failed save without retry: "+error,async()=>{
  const f=fixture(),base=await f.storage.load(),before=structuredClone(f.db.get(a));f.fail(error);
  const result=await f.storage.save(base,base.data);assert.equal(result.status,status);assert.ok(!JSON.stringify(result).includes("upstream secret"));
  assert.deepEqual(f.db.get(a),before);assert.equal(f.calls.filter(c=>c[0]==="save_online_player").length,1);
});
test("unsupported server shape must not default to an empty overwrite; network load failure stays an error",async()=>{
  const f=fixture();f.db.get(a).battler.build={schemaVersion:99};assert.equal((await f.storage.load()).status,"unsupported-data");
  f.fail("network");assert.equal((await f.storage.load()).status,"load-failed");
  f.user(null);assert.equal((await f.storage.load()).status,"not-signed-in");
});
test("session changes during a load discard the returned data",async()=>{
  const f=fixture();f.switchAt(2);assert.equal((await f.storage.load()).status,"session-changed");
});

test("legacy v1 icon-only online data migrates to v2 with empty cut-ins and unchanged selections",()=>{
  const data=empty();data.build.ducks.push(createEmptyDuck({idFactory:()=>duckId}));data.publicSettings.publicDuckId=duckId;
  legacyQuoteOwnership(data.presentation);
  for (const path of QUOTE_PATHS) { const p=path.slice(0,-1).reduce((v,k)=>v[k],data.presentation.battler.quotes); p[path.at(-1)]={text:"",iconSlot:null}; }
  data.presentation.schemaVersion=1;delete data.presentation.battler.profile;
  data.presentation.ducks[duckId]={iconUrl:"old.png"};data.presentation.ducks.orphan={iconUrl:"private-old.png"};
  const before=structuredClone(data),dto=encodeOnlinePlayer(data);
  legacyDtoQuoteOwnership(dto);
  for (const path of QUOTE_PATHS) { const p=path.slice(0,-1).reduce((v,k)=>v[k],dto.battler.presentation.quotes); p[path.at(-1)]={text:"",iconSlot:null}; }
  dto.battler.presentation.schemaVersion=1;delete dto.battler.presentation.profile;
  dto.ducks[0].presentation.schemaVersion=1;delete dto.ducks[0].presentation.icon.profile;delete dto.battler.presentation.detachedDuckPresentation.orphan.profile;
  delete dto.ducks[0].presentation.icon.cutinUrl;delete dto.battler.presentation.detachedDuckPresentation.orphan.cutinUrl;
  const read=decodeOnlinePlayer(dto);
  assert.equal(read.presentation.schemaVersion,6);assert.equal(read.presentation.ducks[duckId].cutinUrl,"");
  assert.equal(read.presentation.ducks.orphan.cutinUrl,"");assert.deepEqual(read.build,data.build);assert.deepEqual(data,before);
  for(const value of [5,null,{url:"bad"}]){
    const bad=structuredClone(dto);bad.ducks[0].presentation.icon.cutinUrl=value;assert.throws(()=>decodeOnlinePlayer(bad));
  }
  const bad=structuredClone(dto);bad.ducks[0].presentation.icon.private="hidden";assert.throws(()=>decodeOnlinePlayer(bad));
});
test("online storage save/load round-trips cut-ins including detached private display data",async()=>{
  const f=fixture();const loaded=await f.storage.load();const data=loaded.data;
  data.build.ducks.push(createEmptyDuck({idFactory:()=>duckId}));data.publicSettings.publicDuckId=duckId;
  data.presentation.ducks[duckId]={ iconUrl:"duck.png",cutinUrl:"cutin.png", quotes:createEmptyDuckQuotes(),profile:createEmptyDuckProfile() };
  data.presentation.ducks.orphan={ iconUrl:"orphan.png",cutinUrl:"private.png", quotes:createEmptyDuckQuotes(),profile:createEmptyDuckProfile() };
  data.presentation.battler.profile.text='保存する本文';
  data.presentation.battler.profile.iconSlots=[1,10];
  data.presentation.ducks[duckId].profile.type='speed';
  data.presentation.ducks.orphan.profile.flavorStats=[{label:'保持',value:6}];
  const saved=await f.storage.save(loaded,data);
  assert.equal(saved.ok,true);assert.deepEqual((await f.storage.load()).data.presentation,data.presentation);
});

test('legacy unpublished Ducks load without mutation, but saving requires a public Duck',()=>{
  const data=empty();data.build.ducks.push(createEmptyDuck({idFactory:()=>duckId}));
  data.publicSettings.publicDuckId=duckId;const dto=encodeOnlinePlayer(data);
  dto.publicDuckId=null;const before=structuredClone(dto),loaded=decodeOnlinePlayer(dto);
  assert.deepEqual(dto,before);assert.equal(loaded.publicSettings.publicDuckId,null);
  assert.throws(()=>encodeOnlinePlayer(loaded));
  loaded.publicSettings.publicDuckId=duckId;assert.doesNotThrow(()=>encodeOnlinePlayer(loaded));
  assert.doesNotThrow(()=>encodeOnlinePlayer(empty()));
});
