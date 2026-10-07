import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOnlineSelectService, decodePublicOpponent } from '../js/onlineSelectService.js';
import { createOnlineSelectController } from '../js/onlineSelectController.js';
import { createBattleResultStorage } from '../js/battleResultStorage.js';
import { startSelectedBattle } from '../js/selectBattle.js';
import { buildBattlePresentationSnapshot } from '../js/battlePresentationSnapshot.js';
import { a,b,da,db,privateDuck,fixture } from './onlineSelectFixture.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function setup(options={}) {
  const f=await fixture(), service=createOnlineSelectService(f.client), values=new Map();
  const results=createBattleResultStorage({async rpc(name,args) {
    if(name==='save_online_battle_result') {
      const meta={battleId:'online-test',battleNo:1,dateISO:'2026-10-04T12:00:00Z'};
      values.set(meta.battleId,structuredClone({...args.p_record,...meta}));return {data:meta};
    }
    return {data:values.get(args.p_battle_id)??null};
  }});
  const c=createOnlineSelectController({service,results,...options});
  return {...f,service,c,results};
}
async function ready(f) {assert.equal((await f.c.load()).ok,true);f.c.chooseOwn(da);assert.equal((await f.c.chooseOpponent(b)).ok,true);}
test('opponent list computes readiness from public build and keeps incomplete opponents visible',async()=>{
  const f=await setup();await f.c.load();
  assert.equal((await f.c.listOpponents()).opponents[0].ready,true);
  f.rows.get(b).ducks[0].build.aSelection=null;
  const listed=await f.c.listOpponents();assert.equal(listed.ok,true);assert.equal(listed.opponents.length,1);
  assert.equal(listed.opponents[0].ready,false);assert.deepEqual(listed.opponents[0].reasons,[]);
  assert.equal((await f.c.chooseOpponent(b)).status,'not-ready');assert.equal(f.c.snapshot().state.opponent,null);
});
test('initial load selects the ready public Duck without changing or saving player data',async()=>{
  const f=await setup(), before=structuredClone(f.rows);
  const loaded=await f.c.load();
  assert.equal(loaded.ok,true);assert.equal(f.c.snapshot().state.selectedDuckId,da);
  assert.equal(loaded.data.publicSettings.publicDuckId,da);
  assert.deepEqual(f.rows,before);
  assert.deepEqual(f.calls.map(([name])=>name),['load_online_player','get_online_random_win_streak']);
});
for(const kind of ['incomplete','invalid','missing','unset'])test('initial public Duck selection has no fallback: '+kind,async()=>{
  const f=await setup(), loaded=await f.service.loadSelf();
  const alternative=structuredClone(loaded.data.build.ducks[0]);alternative.id=privateDuck;
  loaded.data.build.ducks.push(alternative);
  if(kind==='incomplete')loaded.data.build.ducks[0].aSelection=null;
  if(kind==='invalid')loaded.data.build.ducks[0].stats.AT=100;
  if(kind==='missing')loaded.data.publicSettings.publicDuckId=db;
  if(kind==='unset')loaded.data.publicSettings.publicDuckId=null;
  const before=structuredClone(loaded), persisted=structuredClone(f.rows);
  // Exercise the controller boundary, including stale IDs rejected by the persistence decoder.
  const c=createOnlineSelectController({service:{
    loadSelf:async()=>loaded,
    getRandomWinStreak:async()=>({ok:true,randomWinStreak:0}),
  }});
  assert.equal((await c.load()).ok,true);assert.equal(c.snapshot().state.selectedDuckId,null);
  c.chooseOwn(privateDuck);assert.equal(c.snapshot().state.selectedDuckId,privateDuck);
  assert.deepEqual(loaded,before);assert.deepEqual(f.rows,persisted);
});
test('manual selection overrides the public Duck and survives fresh battle preparation',async()=>{
  const f=await setup(), row=f.rows.get(a), alternative=structuredClone(row.ducks[0]);
  alternative.id=privateDuck;row.ducks.push(alternative);
  const before=structuredClone(row);
  assert.equal((await f.c.load()).ok,true);assert.equal(f.c.snapshot().state.selectedDuckId,da);
  f.c.chooseOwn(privateDuck);assert.equal(f.c.snapshot().state.selectedDuckId,privateDuck);
  assert.equal((await f.c.chooseOpponent(b)).ok,true);
  assert.equal((await f.c.start()).ok,true);
  assert.equal(f.c.snapshot().state.selectedDuckId,privateDuck);
  assert.equal((await f.results.load('online-test')).record.p1.duckId,privateDuck);
  assert.equal(f.calls.filter(([name])=>name==='prepare_online_battle').length,1);
  assert.deepEqual(row,before);assert.equal(row.publicDuckId,da);
});
for(const [kind,status] of [['logout','not-signed-in'],['zero','no-access'],['multiple','selection-required']])test('SELECT blocks '+kind,async()=>{
  const f=await setup();if(kind==='logout')f.user(null);else f.access(kind==='zero'?[]:[a,b]);
  assert.equal((await f.c.load()).status,status);assert.equal(f.c.snapshot().canStart,false);assert.equal(f.calls.length,0);
});
test('one access loads only online own UUIDs; ENo and auth ID are independent',async()=>{
  const f=await setup();await f.c.load();assert.equal(f.c.snapshot().eno,'88');assert.equal(f.c.snapshot().state.build.ducks[0].id,da);
  f.access([b]);f.user('auth-B');f.c.invalidate();await f.c.load();assert.equal(f.c.snapshot().eno,'89');assert.equal(f.c.snapshot().state.build.ducks[0].id,db);
});
test('list/detail expose public opponent only, exclude self and private Ducks',async()=>{
  const f=await setup();const row=f.rows.get(b),privateRow=structuredClone(row.ducks[0]);privateRow.id=privateDuck;row.ducks.unshift(privateRow);
  row.battler.presentation.detachedDuckPresentation={hidden:{iconUrl:'private'}};
  await f.c.load();const listed=await f.c.listOpponents();assert.deepEqual(listed.opponents.map(o=>o.id),[b]);
  await f.c.chooseOpponent(b);assert.deepEqual(f.c.snapshot().state.opponent.build.ducks.map(d=>d.id),[db]);
  assert.deepEqual(Object.keys(f.c.snapshot().state.opponent.presentation.ducks),[db]);
  assert.equal((await f.c.chooseOpponent(a)).ok,false);
});
test('malformed public projection with extra private Duck or detached icon is rejected',async()=>{
  const f=await fixture(),row=structuredClone(f.rows.get(b));row.ducks.push({...row.ducks[0],id:privateDuck});assert.throws(()=>decodePublicOpponent(row,a));
  row.ducks.pop();row.battler.presentation.detachedDuckPresentation={hidden:{iconUrl:'secret'}};assert.throws(()=>decodePublicOpponent(row,a));
});
test('opponent list validates the default icon URL and returns only list fields',async()=>{
  const f=await setup(); await f.c.load();
  let listed=await f.c.listOpponents();
  assert.equal(listed.opponents[0].defaultIconUrl,'https://example.invalid/89.png');
  assert.deepEqual(Object.keys(listed.opponents[0]).sort(),['defaultIconUrl','eno','id','name','publicDuckId','ready','reasons']);
  for(const value of ['',null,undefined]) {
    f.rows.get(b).battler.presentation.defaultIconUrl=value;
    listed=await f.c.listOpponents(); assert.equal(listed.ok,true); assert.equal(listed.opponents[0].defaultIconUrl,'');
  }
  for(const value of [42,{},[]]) {
    f.rows.get(b).battler.presentation.defaultIconUrl=value;
    assert.equal((await f.c.listOpponents()).status,'unsupported-data');
  }
});
for(const mutation of ['unpublish','switch'])test('VS rechecks publication: '+mutation,async()=>{
  const f=await setup();await ready(f);f.rows.get(b).publicDuckId=mutation==='unpublish'?null:privateDuck;
  assert.equal((await f.c.start()).status,'public-unavailable');assert.equal((await f.results.load('online-test')).ok,false);assert.equal(f.c.snapshot().canStart,false);
  assert.equal(f.c.snapshot().state.opponent,null);
});
test('VS uses latest online data, existing engine and start-time presentation snapshots without loadouts',async()=>{
  let battle;
  const f=await setup({run:state=>{battle=startSelectedBattle(state,{rng:()=>.5});return battle;}});await ready(f);
  f.rows.get(a).battler.presentation.defaultIconUrl='latest.png';f.rows.get(b).battler.presentation.quotes.battleStart.lines[0].text='最新の相手';
  const started=await f.c.start();assert.equal(started.ok,true);
  const record=(await f.results.load('online-test')).record;assert.deepEqual(record.events,battle.events);assert.equal(record.events.at(-1).type,'battleEnd');
  assert.equal(record.p1.presentation.battlerDefaultIconUrl,'latest.png');
  assert.equal(record.p1.presentation.cutinUrl,'https://example.invalid/cutin88.png');
  assert.equal(record.p2.presentation.cutinUrl,'https://example.invalid/cutin89.png');
  assert.deepEqual(record.p2.presentation,buildBattlePresentationSnapshot(f.c.snapshot().state.opponent.presentation,db));
  assert.equal(record.p1.duckId,da);assert.equal(record.p2.duckId,db);assert.ok(!('loadout' in record.p1));assert.ok(!('loadout' in record.p2));
  f.rows.get(a).battler.presentation.defaultIconUrl='after.png';
  f.rows.get(a).ducks[0].presentation.icon.cutinUrl='changed-self.png';
  f.rows.get(b).ducks[0].presentation.icon.cutinUrl='changed-opponent.png';assert.deepEqual((await f.results.load('online-test')).record,record);
  assert.equal(f.calls.filter(c=>c[0]==='prepare_online_battle').length,1);
});
test('latest incomplete build cannot start or save a result',async()=>{
  const f=await setup();await ready(f);f.rows.get(a).battler.build.dSelection=null;
  assert.equal((await f.c.start()).status,'not-ready');assert.equal((await f.results.load('online-test')).ok,false);
});
for(const phase of ['load','opponent','battle'])test('logout invalidates in-flight '+phase+' and stale responses',async()=>{
  const f=await setup();if(phase!=='load')await ready(f);
  const gate=deferred();f.gate(gate.promise);
  const pending=phase==='load'?f.c.load():phase==='opponent'?f.c.chooseOpponent(b):f.c.start();
  await new Promise(r=>setImmediate(r));f.c.invalidate();f.user(null);gate.resolve();await pending;
  assert.equal(f.c.snapshot().state.build,null);assert.equal(f.c.snapshot().canStart,false);assert.equal((await f.results.load('online-test')).ok,false);
});
test('access switch without auth event is rejected during public read',async()=>{
  const f=await setup();await f.c.load();const gate=deferred();f.gate(gate.promise);const pending=f.c.listOpponents();
  await new Promise(r=>setImmediate(r));f.access([b]);gate.resolve();assert.equal((await pending).status,'session-changed');assert.equal(f.c.snapshot().state.build,null);
});
test('double VS is blocked and canceled selection cannot return late',async()=>{
  const f=await setup();await ready(f);const gate=deferred();f.gate(gate.promise);const pending=f.c.start();
  assert.equal((await f.c.start()).ok,false);gate.resolve();assert.equal((await pending).ok,true);
  await f.c.load();const gate2=deferred();f.gate(gate2.promise);const pick=f.c.chooseOpponent(b);f.c.cancelSelection();gate2.resolve();await pick;
  assert.equal(f.c.snapshot().state.opponent,null);
});
for(const error of ['PGRST202','42501','network'])test('public failure has no fallback/retry or upstream disclosure: '+error,async()=>{
  const f=await setup();await f.c.load();f.error(error);const result=await f.c.listOpponents();assert.equal(result.ok,false);
  assert.ok(!JSON.stringify(result).includes('SECRET'));assert.equal(f.calls.filter(c=>c[0]==='list_online_opponents').length,1);
});
test('SELECT imports no local player adapters and uses only online result persistence',async()=>{
  for(const name of ['select','onlineSelectController','onlineSelectService']) {
    const source=await readFile(new URL('../js/'+name+'.js',import.meta.url),'utf8');
    assert.doesNotMatch(source,/player(Build|Presentation|PublicSettings)Storage|opponentSource|localStorage/);
  }
});

test('save must complete successfully before returning a navigation ID',async()=>{
  const gate=deferred();let calls=0;
  const f=await setup({results:{save:async()=>{calls++;return gate.promise;}}});await ready(f);
  let settled=false;const pending=f.c.start().then(r=>{settled=true;return r;});
  await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(settled,false);
  assert.equal((await f.c.start()).status,'blocked');
  gate.resolve({ok:true,battleId:'server-uuid'});assert.equal((await pending).battleId,'server-uuid');
});
test('failed server save never returns a navigation ID',async()=>{
  const f=await setup({results:{save:async()=>({ok:false,status:'server-error'})}});await ready(f);
  const result=await f.c.start();assert.equal(result.status,'result-save-failed');assert.equal(result.battleId,undefined);
  assert.match(result.message,/サーバー/);
});
test('session invalidation while saving suppresses navigation',async()=>{
  const gate=deferred();const f=await setup({results:{save:()=>gate.promise}});await ready(f);
  const pending=f.c.start();await new Promise(r=>setImmediate(r));f.c.invalidate();
  gate.resolve({ok:true,battleId:'server-uuid'});assert.equal((await pending).status,'stale');
});
