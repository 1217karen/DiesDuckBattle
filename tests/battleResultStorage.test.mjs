import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBattleResultStorage } from '../js/battleResultStorage.js';
const side={battlerId:'a',duckId:'d',battlerName:'name',duckName:'duck',presentation:{duckIconUrl:'duck.png',cutinUrl:'cutin.png',quotes:{battleStart:{text:'Hi'}}}};
const record={p1:side,p2:{...side,battlerId:'b'},result:'draw',events:[{type:'battleEnd',result:'draw'}]};
test('RPC adapter sends only result snapshot, never client metadata/loadout',async()=>{
  const calls=[];const meta={battleId:'server-id',battleNo:12,dateISO:'server-time'};
  const store=createBattleResultStorage({async rpc(...args){calls.push(args);return {data:meta};}});
  assert.deepEqual(await store.save({...record,battleId:'client-id',dateISO:'client-time',p1:{...side,loadout:{secret:1}}}),{ok:true,status:'saved',...meta});
  const [name,params]=calls[0];assert.equal(name,'save_online_battle_result');assert.deepEqual(params.p_record,record);
  assert.equal(params.p_p1_account_id,'a');assert.equal(params.p_p2_account_id,'b');assert.equal(calls.length,1);
});
test('detail and list use dedicated RPCs, preserving returned snapshots',async()=>{
  const calls=[];const store=createBattleResultStorage({async rpc(name,args){calls.push([name,args]);return {data:name==='get_online_battle_result'?record:{records:[{battleNo:1}],page:2,pageSize:30,total:31,totalPages:2}};}});
  assert.deepEqual((await store.load('id')).record,record);
  assert.equal((await store.list({page:2,order:'asc'})).totalPages,2);
  assert.deepEqual(calls,[['get_online_battle_result',{p_battle_id:'id'}],['list_online_battle_results',{p_page:2,p_page_size:30,p_order:'asc',p_eno:null,p_outcome:'all',p_favorites_only:false,p_game_account_id:null}]]);
  assert.equal((await createBattleResultStorage({rpc:async()=>({data:null})}).load('missing')).status,'not-found');
});
for(const throws of [false,true])test('server failure has no local fallback or retry '+throws,async()=>{
  let count=0;const store=createBattleResultStorage({rpc:async()=>{count++;if(throws)throw Error('offline');return {error:{message:'private'}};}});
  for(const result of [await store.save(record),await store.load('id'),await store.list()])assert.equal(result.status,'server-error');
  assert.equal(count,3);
});
test('all result consumers await RPC adapter and no result local storage remains',async()=>{
  for(const file of ['battleResultStorage','onlineSelectController','result','storagePage']) {
    const source=await readFile(new URL('../js/'+file+'.js',import.meta.url),'utf8');
    assert.doesNotMatch(source,/localStorage|createBattleId|randomUUID|addEventListener\("storage"/);
  }
  assert.match(await readFile(new URL('../js/result.js',import.meta.url),'utf8'),/await createBattleResultStorage\(\).load/);
  assert.match(await readFile(new URL('../js/storagePage.js',import.meta.url),'utf8'),/await storage.list/);
});

test('history adapter explicitly forwards every filter and idempotent favorite state',async()=>{
  const calls=[];const store=createBattleResultStorage({async rpc(name,args){calls.push([name,args]);return {data:name==='set_online_battle_favorite'?{battleId:'id',favorite:args.p_favorite}:{records:[],total:0}};}});
  await store.list({eno:'12',outcome:'lose',favoritesOnly:true,gameAccountId:'account'});
  assert.deepEqual(calls[0],['list_online_battle_results',{p_page:1,p_page_size:30,p_order:'desc',p_eno:'12',p_outcome:'lose',p_favorites_only:true,p_game_account_id:'account'}]);
  assert.equal((await store.setFavorite({gameAccountId:'account',battleId:'id',favorite:true})).favorite,true);
  assert.deepEqual(calls[1],['set_online_battle_favorite',{p_game_account_id:'account',p_battle_id:'id',p_favorite:true}]);
  assert.equal((await store.setFavorite({gameAccountId:'account',battleId:'id',favorite:false})).favorite,false);
  assert.equal((await createBattleResultStorage({rpc:async()=>({data:null})}).setFavorite({gameAccountId:'a',battleId:'id',favorite:true})).ok,false);
});
