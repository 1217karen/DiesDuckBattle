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
  const results=createBattleResultStorage({getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)});
  const c=createOnlineSelectController({service,results,idFactory:()=> 'online-test',...options});
  return {...f,service,c,results};
}
async function ready(f) {assert.equal((await f.c.load()).ok,true);f.c.chooseOwn(da);assert.equal((await f.c.chooseOpponent(b)).ok,true);}
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
for(const mutation of ['unpublish','switch'])test('VS rechecks publication: '+mutation,async()=>{
  const f=await setup();await ready(f);f.rows.get(b).publicDuckId=mutation==='unpublish'?null:privateDuck;
  assert.equal((await f.c.start()).status,'public-unavailable');assert.equal(f.results.load('online-test').ok,false);assert.equal(f.c.snapshot().canStart,false);
  assert.equal(f.c.snapshot().state.opponent,null);
});
test('VS uses latest online data, existing engine and start-time presentation/loadout snapshots',async()=>{
  let battle;
  const f=await setup({run:state=>{battle=startSelectedBattle(state,{rng:()=>.5});return battle;}});await ready(f);
  f.rows.get(a).battler.presentation.defaultIconUrl='latest.png';f.rows.get(b).battler.presentation.quotes.battleStart.text='最新の相手';
  const started=await f.c.start();assert.equal(started.ok,true);
  const record=f.results.load('online-test').record;assert.deepEqual(record.events,battle.events);assert.equal(record.events.at(-1).type,'battleEnd');
  assert.equal(record.p1.presentation.battlerDefaultIconUrl,'latest.png');
  assert.equal(record.p1.presentation.cutinUrl,'https://example.invalid/cutin88.png');
  assert.equal(record.p2.presentation.cutinUrl,'https://example.invalid/cutin89.png');
  assert.deepEqual(record.p2.presentation,buildBattlePresentationSnapshot(f.c.snapshot().state.opponent.presentation,db));
  assert.equal(record.p1.loadout.duck.id,da);assert.equal(record.p2.loadout.duck.id,db);
  f.rows.get(a).battler.presentation.defaultIconUrl='after.png';
  f.rows.get(a).ducks[0].presentation.icon.cutinUrl='changed-self.png';
  f.rows.get(b).ducks[0].presentation.icon.cutinUrl='changed-opponent.png';assert.deepEqual(f.results.load('online-test').record,record);
  assert.equal(f.calls.filter(c=>c[0]==='prepare_online_battle').length,1);
});
test('latest incomplete build cannot start or save a result',async()=>{
  const f=await setup();await ready(f);f.rows.get(a).battler.build.dSelection=null;
  assert.equal((await f.c.start()).status,'not-ready');assert.equal(f.results.load('online-test').ok,false);
});
for(const phase of ['load','opponent','battle'])test('logout invalidates in-flight '+phase+' and stale responses',async()=>{
  const f=await setup();if(phase!=='load')await ready(f);
  const gate=deferred();f.gate(gate.promise);
  const pending=phase==='load'?f.c.load():phase==='opponent'?f.c.chooseOpponent(b):f.c.start();
  await new Promise(r=>setImmediate(r));f.c.invalidate();f.user(null);gate.resolve();await pending;
  assert.equal(f.c.snapshot().state.build,null);assert.equal(f.c.snapshot().canStart,false);assert.equal(f.results.load('online-test').ok,false);
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
test('SELECT imports no local player adapters and leaves result storage local',async()=>{
  for(const name of ['select','onlineSelectController','onlineSelectService']) {
    const source=await readFile(new URL('../js/'+name+'.js',import.meta.url),'utf8');
    assert.doesNotMatch(source,/player(Build|Presentation|PublicSettings)Storage|opponentSource|localStorage/);
  }
});
