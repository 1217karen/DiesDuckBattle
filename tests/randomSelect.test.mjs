import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, b, da } from './onlineSelectFixture.mjs';
import { createOnlineSelectService, selectFailure } from '../js/onlineSelectService.js';
import { createOnlineSelectController } from '../js/onlineSelectController.js';

async function setup(options={}) {
  const f=await fixture(), service=createOnlineSelectService(f.client), saved=[], prompts=[];
  let approve=true;
  const c=createOnlineSelectController({service,random:()=>0,
    results:{save:async record=>{saved.push(structuredClone(record));return {ok:true,battleId:'saved'};}},
    run:()=>({ok:true,result:'P1_win',events:[{type:'battleEnd',result:'P1_win'}]}),
    confirmManualBattle:message=>{prompts.push(message);return approve;},...options});
  return {...f,service,c,saved,prompts,approve:value=>{approve=value;}};
}
async function ready(f,mode='random') {
  assert.equal((await f.c.load()).ok,true);f.c.chooseOwn(da);
  assert.equal((await (mode==='random'?f.c.chooseRandomOpponent():f.c.chooseOpponent(b))).ok,true);
}

test('random selects from public list, retains real data, allows same opponent and manual/random transitions',async()=>{
  const f=await setup(); await ready(f);
  const before=f.c.snapshot();assert.equal(before.selectionMode,'random');assert.equal(before.state.opponent.id,b);
  assert.equal(before.state.opponent.name,'DB名89');assert.equal(before.state.opponent.presentation.battler.defaultIconUrl,'https://example.invalid/89.png');
  await f.c.listOpponents();f.c.cancelSelection();assert.equal(f.c.snapshot().selectionMode,'random');
  await f.c.chooseRandomOpponent();assert.equal(f.c.snapshot().state.opponent.id,b);
  assert.equal(f.c.snapshot().state.selectedDuckId,da);assert.equal(f.saved.length,0);
  await f.c.chooseOpponent(b);assert.equal(f.c.snapshot().selectionMode,'manual');
  await f.c.chooseRandomOpponent();assert.equal(f.c.snapshot().selectionMode,'random');
});

test('random samples candidates rather than assuming the first opponent',async()=>{
  const f=await setup({random:()=>.99});
  const other=structuredClone(f.rows.get(b));other.gameAccountId='66666666-6666-4666-8666-666666666666';other.eno='90';
  f.rows.set(other.gameAccountId,other);await ready(f);
  assert.equal(f.c.snapshot().state.opponent.id,other.gameAccountId);
});

test('failed list/manual picks do not replace a successful random selection or its mode',async()=>{
  const f=await setup();await ready(f);const before=f.c.snapshot();
  f.service.listOpponents=async()=>selectFailure('public-unavailable');
  assert.equal((await f.c.listOpponents()).ok,false);
  f.service.getOpponent=async()=>selectFailure('public-unavailable');
  assert.equal((await f.c.chooseOpponent(b)).ok,false);
  assert.deepEqual(f.c.snapshot().state,before.state);assert.equal(f.c.snapshot().selectionMode,'random');
});

for(const failure of ['empty','list','detail','throw']) test('random failure preserves valid selection: '+failure,async()=>{
  const f=await setup();await ready(f,'manual');const before=f.c.snapshot();
  if(failure==='empty')f.service.listOpponents=async()=>({ok:true,opponents:[]});
  if(failure==='list')f.service.listOpponents=async()=>selectFailure('load-failed');
  if(failure==='detail')f.service.getOpponent=async()=>selectFailure('public-unavailable');
  if(failure==='throw')f.service.getOpponent=async()=>{throw Error('network');};
  assert.equal((await f.c.chooseRandomOpponent()).ok,false);
  assert.deepEqual(f.c.snapshot().state,before.state);assert.equal(f.c.snapshot().selectionMode,'manual');
  assert.equal(f.c.snapshot().randomWinStreak,0);assert.equal(f.c.snapshot().canStart,true);
  assert.match(f.c.snapshot().message,/ランダム相手を選択できません/);assert.equal(f.saved.length,0);
});

test('random busy and auth invalidation suppress competing/stale requests',async()=>{
  const f=await setup();await ready(f);let release;f.gate(new Promise(resolve=>{release=resolve;}));
  const pending=f.c.chooseRandomOpponent();assert.equal((await f.c.chooseRandomOpponent()).status,'busy');
  f.c.invalidate();f.user(null);release();await pending;
  assert.equal(f.c.snapshot().state.opponent,null);assert.equal(f.c.snapshot().selectionMode,null);assert.equal(f.c.snapshot().randomWinStreak,null);
});

test('random battle keeps its mode through prepare and saves real names/presentation without confirmation',async()=>{
  const f=await setup();f.streak(3);await ready(f);
  f.rows.get(b).battler.presentation.defaultIconUrl='real-latest.png';
  assert.equal((await f.c.start()).ok,true);assert.equal(f.prompts.length,0);
  assert.equal(f.saved[0].selectionMode,'random');assert.equal(f.c.snapshot().selectionMode,'random');
  assert.equal(f.saved[0].p2.battlerName,'DB名89');assert.equal(f.saved[0].p2.duckName,'耐久型');
  assert.equal(f.saved[0].p2.presentation.battlerDefaultIconUrl,'real-latest.png');
  assert.equal(f.saved[0].p2.presentation.duckIconUrl,'https://example.invalid/duck89.png');
  assert.doesNotMatch(JSON.stringify(f.saved[0]),/B00_random|D00_random|？？？/);
});

test('manual start rechecks streak; cancel preserves selection/streak and OK saves manual',async()=>{
  const f=await setup();await ready(f,'manual');f.streak(3);f.approve(false);
  const before=f.c.snapshot().state;
  assert.equal((await f.c.start()).status,'cancelled');assert.equal(f.saved.length,0);
  assert.deepEqual(f.c.snapshot().state,before);assert.equal(f.c.snapshot().randomWinStreak,3);
  assert.equal(f.c.snapshot().canStart,true);assert.match(f.prompts[0],/現在ランダムで3連勝中です。\n相手を指定して戦闘すると、連勝記録は途切れます。/);
  f.approve(true);assert.equal((await f.c.start()).ok,true);assert.equal(f.saved[0].selectionMode,'manual');
});

test('manual at latest zero starts without prompt; viewing/selecting opponents never updates streak',async()=>{
  const f=await setup();f.streak(3);await ready(f,'manual');
  await f.c.listOpponents();await f.c.chooseOpponent(b);assert.equal(f.c.snapshot().randomWinStreak,3);assert.equal(f.saved.length,0);
  f.streak(0);assert.equal((await f.c.start()).ok,true);assert.equal(f.prompts.length,0);
});

test('focus scope recheck updates streak, but unavailable/invalid streak is never assumed zero',async()=>{
  const f=await setup();await ready(f,'manual');f.streak(5);await f.c.checkScope();assert.equal(f.c.snapshot().randomWinStreak,5);
  f.streak(-1);assert.equal((await f.c.start()).ok,false);assert.equal(f.saved.length,0);assert.equal(f.prompts.length,0);
  assert.equal(f.c.snapshot().randomWinStreak,null);assert.equal(f.c.snapshot().canStart,false);
  f.streak(2);await f.c.checkScope();assert.equal(f.c.snapshot().canStart,true);assert.equal(f.c.snapshot().randomWinStreak,2);
});

test('initial streak migration failure retains loaded characters but blocks manual start',async()=>{
  const f=await setup();f.service.getRandomWinStreak=async()=>selectFailure('migration-required');
  assert.equal((await f.c.load()).ok,false);f.c.chooseOwn(da);await f.c.chooseOpponent(b);
  assert.equal(f.c.snapshot().randomWinStreak,null);assert.equal(f.c.snapshot().canStart,false);
  assert.match(f.c.snapshot().message,/連勝数を確認できません/);assert.equal((await f.c.start()).ok,false);
});

test('streak service rejects non-integer responses and verifies scope',async()=>{
  const f=await setup();const base=await f.service.loadSelf();
  for(const value of [null,-1,1.5,'3',{},[],Number.MAX_SAFE_INTEGER+1]) {
    f.streak(value);assert.equal((await f.service.getRandomWinStreak(base)).ok,false);
  }
  f.streak(0);assert.equal((await f.service.getRandomWinStreak(base)).randomWinStreak,0);
  f.access([b]);assert.equal((await f.service.getRandomWinStreak(base)).status,'session-changed');
});
