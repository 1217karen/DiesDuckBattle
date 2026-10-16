import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './accountIntegrationFixture.mjs';
import {createAccountAuthController} from '../js/accountAuthController.js';
import {DELETION_JOURNAL_KEY as KEY, SESSION_REGISTRY_KEY as REG, LEGACY_SESSION_KEY} from '../js/accountSessionManager.js';
import {internalEmailForEno} from '../supabase/functions/_shared/internal-email.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const journal=f=>JSON.parse(f.disk.get(KEY)).entries;
async function page(f){const p=f.page(),runtime=await p.get();const auth=createAccountAuthController({runtime,registrationService:{}});await auth.start();return {p,runtime,auth};}
async function setup(){const f=environment(),a=await page(f);await a.auth.login('1','valid');await a.auth.login('2','valid');const raw=a.runtime.getCurrent().client,target=a.runtime.getCurrent().account;let calls=0;
 raw.rpc=async()=>{calls++;return {data:{deleted:true,...target}};};return {...a,f,raw,target,calls:()=>calls};}
test('durable confirmed survives reload: clear only B, no delete RPC resend and no automatic A selection',async()=>{
 const a=await setup();assert.equal((await a.runtime.deleteCurrent(a.target)).ok,true);const record=journal(a.f)[0];
 assert.equal(record.state,'deletion-confirmed');assert.deepEqual(Object.keys(record).sort(),['authUserId','eno','gameAccountId','slot','state']);
 assert.doesNotMatch(a.f.disk.get(KEY),/password|access_token|refresh_token|"valid"/);a.auth.stop();
 const b=await page(a.f);assert.equal(b.auth.getClient(),null);assert.equal(b.auth.snapshot().deletionRecoveries[0].state,'deletion-confirmed');
 assert.equal((await b.auth.cleanupDeleted(record)).ok,true);assert.deepEqual(b.runtime.snapshot().entries.map(e=>e.eno),['1']);assert.equal(b.auth.getClient(),null);
 assert.equal(a.f.sessions.size,1);assert.equal(a.calls(),1);assert.deepEqual(journal(a.f),[]);
 assert.equal((await b.auth.cleanupDeleted(record)).ok,false);assert.equal(a.f.sessions.size,1);assert.equal(a.calls(),1);
});
test('cleanup preserves a different active account and its refresh; releases cleaned slot subscriptions',async()=>{
 const a=await setup();await a.runtime.deleteCurrent(a.target);await a.auth.login('1','valid');const active=a.runtime.getCurrent().client;
 assert.equal((await a.auth.cleanupDeleted(journal(a.f)[0])).ok,true);assert.equal(a.auth.snapshot().enos[0],'1');assert.equal(active.stopped,undefined);assert.equal(active.signouts.length,0);assert.equal(a.raw.stopped,true);assert.equal(a.calls(),1);
});
for(const phase of ['before-request','confirm','registry','journal-removal'])test('storage failure remains recoverable without second RPC: '+phase,async()=>{
 const a=await setup(),set=a.f.disk.set;let armed=true;
 a.f.disk.set=function(key,value){if(armed&&((phase==='before-request'&&key===KEY)||(phase==='confirm'&&key===KEY&&value.includes('deletion-confirmed'))||(phase==='registry'&&key===REG)||(phase==='journal-removal'&&key===KEY&&JSON.parse(value).entries.length===0)))throw Error('quota');return set.call(this,key,value);};
 if(['registry','journal-removal'].includes(phase)){armed=false;assert.equal((await a.runtime.deleteCurrent(a.target)).ok,true);armed=true;assert.equal((await a.runtime.cleanupDeleted(a.target)).ok,false);assert.equal(journal(a.f)[0].state,'deletion-confirmed');}
 else assert.equal((await a.runtime.deleteCurrent(a.target)).ok,false);
 armed=false;a.auth.stop();const b=await page(a.f);
 if(phase==='before-request'){assert.equal(a.calls(),0);assert.equal(a.f.disk.has(KEY),false);assert.equal(b.auth.snapshot().enos[0],'2');}
 else if(phase==='confirm'){assert.equal(journal(a.f)[0].state,'deletion-pending');assert.equal((await b.runtime.cleanupDeleted(a.target)).ok,false);assert.equal((await b.runtime.deleteCurrent(a.target)).ok,false);assert.equal(a.calls(),1);}
 else {assert.equal((await b.auth.cleanupDeleted(journal(a.f)[0])).ok,true);assert.deepEqual(journal(a.f),[]);assert.equal(a.f.sessions.size,1);assert.equal(a.calls(),1);}
});
for(const result of ['throw','error','mismatch','missing'])test('unknown deletion never becomes success or retries after absent/expired session: '+result,async()=>{
 const a=await setup();let calls=0;a.raw.rpc=async()=>{calls++;a.f.sessions.delete(a.raw.key);if(result==='throw')throw Error('offline');return result==='error'?{error:{}}:result==='mismatch'?{data:{deleted:true,...a.target,eno:'9'}}:{};};
 assert.equal((await a.runtime.deleteCurrent(a.target)).ok,false);assert.equal(journal(a.f)[0].state,'deletion-pending');a.auth.stop();const b=await page(a.f);
 for(const work of [()=>b.auth.select('2'),()=>b.auth.login('2','valid'),()=>b.runtime.deleteCurrent(a.target),()=>b.auth.cleanupDeleted(journal(a.f)[0]),()=>b.auth.logout()])assert.equal((await work()).ok,false);
 assert.equal(b.auth.getClient(),null);assert.equal((await b.auth.login('1','valid')).ok,true);assert.equal(calls,1);assert.equal(journal(a.f)[0].state,'deletion-pending');
});
test('journal immediately invalidates pre-existing scoped client, even without storage event delivery',async()=>{
 const a=await setup(),scope=a.auth.getClient();await a.runtime.deleteCurrent(a.target);
 assert.equal((await scope.rpc('set_index_message',{p_eno:'2'})).error.code,'PGRST301');assert.equal(a.calls(),1);
});
test('different user in recovery slot, mismatched target IDs or reused slot are never signed out',async()=>{
 for(const kind of ['auth-user','email','target-id','slot','registry']){
  const a=await setup();await a.runtime.deleteCurrent(a.target);let target={...journal(a.f)[0]};
  if(kind==='auth-user')a.f.sessions.set(a.raw.key,{id:'wrong',email:internalEmailForEno('2')});
  if(kind==='email')a.f.sessions.set(a.raw.key,{id:a.target.authUserId,email:internalEmailForEno('9')});
  if(kind==='target-id')target.gameAccountId='wrong';if(kind==='slot')target.slot='legacy';
  if(kind==='registry'){const r=JSON.parse(a.f.disk.get(REG));r.entries[1].eno='9';a.f.disk.set(REG,JSON.stringify(r));}
  assert.equal((await a.runtime.cleanupDeleted(target)).ok,false,kind);assert.equal(a.raw.signouts.length,0);assert.equal(a.f.sessions.size,2);assert.equal(journal(a.f).length,1);
 }
});
test('ambiguous SDK result and sign-out failure retain confirmed for later explicit retry',async()=>{
 for(const kind of ['missing','error','signout']){
  const a=await setup();await a.runtime.deleteCurrent(a.target);
  if(kind==='signout')a.raw.auth.signOut=async()=>({error:{}});else a.raw.auth.getSession=async()=>kind==='error'?{error:{}}:{data:{}};
  assert.equal((await a.runtime.cleanupDeleted(a.target)).ok,false);assert.equal(journal(a.f)[0].state,'deletion-confirmed');assert.equal(a.f.sessions.size,2);
 }
});
test('cross-tab cleanup serializes; confirmed is consumed once and never re-deleted',async()=>{
 const a=await setup();await a.runtime.deleteCurrent(a.target);const b=await page(a.f),record=journal(a.f)[0];
 const results=await Promise.all([a.runtime.cleanupDeleted(record),b.runtime.cleanupDeleted(record)]);assert.equal(results.filter(x=>x.ok).length,1);assert.equal(a.calls(),1);assert.equal(a.f.sessions.size,1);
});
test('registry or journal mutation during SDK await cannot sign out any slot',async()=>{
 for(const key of [REG,KEY]){
  const a=await setup();await a.runtime.deleteCurrent(a.target);let resume;const gate=new Promise(r=>resume=r),get=a.raw.auth.getSession;
  a.raw.auth.getSession=async()=>{await gate;return get();};const work=a.runtime.cleanupDeleted(a.target);await tick();
  const value=JSON.parse(a.f.disk.get(key));if(key===REG)value.active=null;else value.entries[0].authUserId='changed';a.f.disk.set(key,JSON.stringify(value));resume();
  assert.equal((await work).ok,false);assert.equal(a.raw.signouts.length,0);assert.equal(a.f.sessions.size,2);
 }
});
test('recovery uses coordinator and refuses while A is writing or has unsaved changes',async()=>{
 const a=await setup();await a.runtime.deleteCurrent(a.target);await a.auth.login('1','valid');const record=journal(a.f)[0];let resume;const pending=a.auth.coordinator.write(()=>new Promise(r=>resume=r));
 assert.equal((await a.auth.cleanupDeleted(record)).code,'operation-in-progress');resume(true);await pending;const stop=a.auth.beforeLogout(()=>false);
 assert.equal((await a.auth.cleanupDeleted(record)).code,'cancelled');stop();assert.equal((await a.auth.cleanupDeleted(record)).ok,true);
});
test('corrupt recovery journal refuses without changing SDK sessions',async()=>{
 const a=await setup();a.f.disk.set(KEY,'{"version":99,"entries":[]}');assert.equal((await a.runtime.restore()).ok,false);assert.equal(a.auth.getClient(),null);assert.equal(a.f.sessions.size,2);assert.equal(a.calls(),0);
});
test('legacy recovery reuses the shared client and never stops its auto refresh',async()=>{
 const f=environment();f.sessions.set(LEGACY_SESSION_KEY,{id:'auth-1',email:internalEmailForEno('1')});const a=await page(f),raw=a.runtime.getCurrent().client,target=a.runtime.getCurrent().account;let count=0;
 raw.rpc=async()=>{count++;return {data:{deleted:true,...target}};};await a.runtime.deleteCurrent(target);a.auth.stop();const b=await page(f);
 assert.equal((await b.auth.cleanupDeleted(journal(f)[0])).ok,true);assert.equal(raw.stopped,undefined);assert.equal(f.clients.filter(c=>c.key===LEGACY_SESSION_KEY).length,1);assert.equal(count,1);
});
test('one recovery never removes another journal record; storage events invalidate stale leases',async()=>{
 const a=await setup(),b=await page(a.f),stale=b.auth.getClient();await a.runtime.deleteCurrent(a.target);
 b.p.events.fire('storage',{key:KEY});assert.equal(b.auth.getClient(),null);assert.equal(stale.accountContext.isCurrent(),false);assert.equal(b.auth.snapshot().deletionRecoveries[0].state,'deletion-confirmed');
 await a.auth.login('1','valid');const first=a.runtime.getCurrent().account;a.runtime.getCurrent().client.rpc=async()=>({data:{deleted:true,...first}});
 await a.runtime.deleteCurrent(first);const other=journal(a.f).find(e=>e.eno==='1');assert.equal(journal(a.f).length,2);
 assert.equal((await a.runtime.cleanupDeleted(a.target)).ok,true); // B cleanup succeeds even while A still awaits recovery.
 assert.deepEqual(journal(a.f),[other]);assert.deepEqual(a.runtime.snapshot().entries.map(e=>e.eno),['1']);
 assert.equal((await a.runtime.cleanupDeleted(other)).ok,true);assert.deepEqual(journal(a.f),[]);assert.equal(a.calls(),1);
});
test('concurrent tabs cannot resend deletion once its durable intent exists',async()=>{
 const a=await setup(),b=await page(a.f);let resume;const gate=new Promise(r=>resume=r);let calls=0;
 a.raw.rpc=async()=>{calls++;await gate;return {data:{deleted:true,...a.target}};};
 const first=a.runtime.deleteCurrent(a.target);await tick();const second=b.runtime.deleteCurrent(a.target);resume();
 assert.equal((await first).ok,true);assert.equal((await second).ok,false);assert.equal(calls,1);assert.equal(journal(a.f)[0].state,'deletion-confirmed');
});
