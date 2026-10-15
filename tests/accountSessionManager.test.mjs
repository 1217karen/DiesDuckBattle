import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountSessionManager, SESSION_REGISTRY_KEY, LEGACY_SESSION_KEY } from '../js/accountSessionManager.js';
import { internalEmailForEno } from '../supabase/functions/_shared/internal-email.mjs';
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture() {
 const disk=new Map(), sessions=new Map(), instances=[], events=[];let sequence=0,tail=Promise.resolve();
 const storage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v)};
 const locks={request(name,options,fn){assert.equal(name,SESSION_REGISTRY_KEY);assert.equal(options.mode,'exclusive');const work=tail.then(fn);tail=work.catch(()=>{});return work;}};
 function client(key) {
  const c={key,loginCount:0,signouts:[],auth:{
   onAuthStateChange(fn){c.authEvent=fn;return {data:{subscription:{unsubscribe(){c.authEvent=null;}}}};},
   async signInWithPassword({email,password}){c.loginCount++;if(c.loginWait)await c.loginWait;if(password!=='correct')return {error:{}};const eno=email.match(/eno-(\d+)@/)[1];sessions.set(key,{id:'user-'+eno,email});return {data:{session:{user:sessions.get(key)}}};},
   async getSession(){return {data:{session:sessions.has(key)?{user:sessions.get(key)}:null},error:null};},
   async getUser(){if(c.userWait)await c.userWait;if(c.network)throw Error('offline');return {data:{user:sessions.get(key)??null}};},
   async signOut(options){c.signouts.push(options);if(c.signoutWait)await c.signoutWait;if(c.logoutError) return {error:{}};sessions.delete(key);return {error:null};},stopAutoRefresh(){c.stopped=true;}
  },from(table){assert.equal(table,'game_account_access');return {select(columns){assert.match(columns,/game_account_id/);return {async eq(field,uid){assert.equal(field,'auth_user_id');if(c.accessWait)await c.accessWait;assert.equal(uid,sessions.get(key)?.id);if(c.accessError)return {error:{}};const eno=sessions.get(key)?.email.match(/eno-(\d+)@/)[1];return {data:c.rows??[{game_account_id:'11111111-1111-4111-8111-111111111111',game_accounts:{eno,battlers:{presentation:{name:'Name '+eno}}}}]};}};}};}};
  instances.push(c);return c;
 }
 const factory=(url,pub,options)=>{assert.equal(url,'https://example.invalid');assert.equal(pub,'public');assert.deepEqual({...options.auth,storage:undefined,storageKey:undefined},{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage:undefined,storageKey:undefined});return client(options.auth.storageKey);};
 function manager(overrides={}) {const listeners={};events.push(listeners);return createAccountSessionManager({createClient:factory,config:{url:'https://example.invalid',publishableKey:'public'},storage:()=>storage,locks,randomUUID:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`,events:{addEventListener:(key,fn)=>listeners[key]=fn,removeEventListener:key=>delete listeners[key]},...overrides});}
 return {manager,disk,sessions,instances,client,events,storage};
}
test('A survives addition of B; unique SDK keys; metadata has no credentials; B alone logs out',async()=>{
 const f=fixture(),m=f.manager();assert.equal((await m.add('1','correct')).ok,true);const a=f.instances[0];
 assert.equal((await m.add('2','correct')).ok,true);const b=f.instances[1];assert.notEqual(a.key,b.key);assert.notEqual(a.key,LEGACY_SESSION_KEY);
 assert.equal(f.sessions.size,2);assert.equal(m.getActiveLease().account.eno,'2');
 const registry=JSON.parse(f.disk.get(SESSION_REGISTRY_KEY));assert.deepEqual(Object.keys(registry.entries[0]).sort(),['eno','name','slot']);assert.doesNotMatch(JSON.stringify(registry),/correct|token|user-1/);
 assert.equal((await m.logoutCurrent()).ok,true);assert.ok(f.sessions.has(a.key));assert.ok(!f.sessions.has(b.key));assert.deepEqual(b.signouts,[{scope:'local'}]);assert.equal(m.list().active,null);assert.equal(m.getActiveLease(),null);
 assert.equal((await m.select('1')).ok,true);assert.equal(a.loginCount,1);
});
test('failed B login does not alter active A or SDK session; duplicate is rejected before sign-in',async()=>{
 const f=fixture(),m=f.manager();await m.add('1','correct');const lease=m.getActiveLease(),raw=f.disk.get(SESSION_REGISTRY_KEY);
 assert.equal((await m.add('2','bad')).code,'login-failed');assert.equal(f.disk.get(SESSION_REGISTRY_KEY),raw);assert.equal(lease.isCurrent(),true);assert.equal(f.sessions.size,1);
 assert.equal((await m.add('01','correct')).code,'already-added');assert.equal(f.instances.length,2);
});
test('reload restores and validates all sessions without password; expiry requires reauthentication',async()=>{
 const f=fixture(),m=f.manager();await m.add('1','correct');await m.add('2','correct');m.dispose();
 const n=f.manager();assert.equal(n.getActiveLease(),null);assert.deepEqual((await n.restore()).entries.map(e=>e.status),['ready','ready']);assert.equal(n.getActiveLease().account.eno,'2');
 const b=n.getActiveLease().client;f.sessions.delete(b.key);assert.equal((await n.select('2')).code,'reauthentication-required');
 const restored=await n.restore();assert.equal(restored.active,null);assert.equal(restored.entries[1].status,'reauthentication-required');assert.ok(f.sessions.has(f.instances[0].key));
});
test('network/access failures preserve healthy A and cannot activate B',async()=>{
 const f=fixture(),m=f.manager();await m.add('1','correct');await m.add('2','correct');await m.select('1');const lease=m.getActiveLease();
 f.instances[1].network=true;assert.equal((await m.select('2')).code,'verification-unavailable');assert.equal(lease.isCurrent(),true);f.instances[1].network=false;f.instances[1].accessError=true;assert.equal((await m.select('2')).code,'verification-unavailable');assert.equal(lease.isCurrent(),true);
});
test('successful authentication for the wrong ENo, forged metadata, missing access are refused',async()=>{
 const f=fixture(),m=f.manager();await m.add('1','correct');await m.add('2','correct');await m.select('1');
 const b=f.instances[1];f.sessions.set(b.key,{id:'user-9',email:internalEmailForEno('9')});assert.equal((await m.select('2')).code,'eno-mismatch');
 const r=JSON.parse(f.disk.get(SESSION_REGISTRY_KEY));r.entries[1].eno='9';r.entries[1].slot=r.entries[0].slot;f.disk.set(SESSION_REGISTRY_KEY,JSON.stringify(r));assert.equal((await m.restore()).code,'invalid-registry');
});
test('add verifies requested ENo after sign-in and cleans only rejected candidate',async()=>{
 const f=fixture(),m=f.manager();await m.add('1','correct');
 const adding=m.add('2','correct');await tick(); // use a separate delayed factory for deterministic mismatch
 await adding;
 await m.select('1');f.instances[1].rows=[];assert.equal((await m.select('2')).code,'eno-mismatch');assert.equal(m.getActiveLease().account.eno,'1');
 const n=f.manager({createClient:(url,key,opts)=>{const c=f.client(opts.auth.storageKey);c.rows=[];return c;}});
 assert.equal((await n.add('3','correct')).code,'eno-mismatch');assert.deepEqual(f.instances.at(-1).signouts,[{scope:'local'}]);assert.equal(f.sessions.size,2);
});
test('legacy adoption uses supplied existing client without copying tokens or signing it in/out',async()=>{
 const f=fixture(),old=f.client(LEGACY_SESSION_KEY);f.sessions.set(LEGACY_SESSION_KEY,{id:'user-7',email:internalEmailForEno('7')});
 const m=f.manager({getLegacyClient:()=>old});assert.equal((await m.adoptLegacy()).ok,true);assert.equal(m.getActiveLease().client,old);assert.equal(old.loginCount,0);assert.deepEqual(old.signouts,[]);
 await m.add('2','correct');await m.logoutCurrent();assert.ok(f.sessions.has(LEGACY_SESSION_KEY));assert.equal((await m.select('7')).ok,true);
 m.dispose();assert.equal(old.stopped,undefined);
});
test('legacy is opt-in and ambiguous legacy access is never inferred',async()=>{
 const f=fixture(),m=f.manager();assert.equal((await m.adoptLegacy()).code,'legacy-handoff-required');
 const old=f.client(LEGACY_SESSION_KEY);f.sessions.set(LEGACY_SESSION_KEY,{id:'user-7',email:internalEmailForEno('7')});old.rows=[{game_accounts:{eno:'7'}},{game_accounts:{eno:'8'}}];
 assert.equal((await f.manager({getLegacyClient:()=>old}).adoptLegacy()).code,'ambiguous-account');assert.deepEqual(old.signouts,[]);
});
test('invalid/unavailable registry or absent cross-tab lock fails closed before creating client',async()=>{
 for(const raw of ['{','[]','{"version":2,"entries":[],"active":null}','{"version":1,"entries":[],"active":"forged"}']) {
  const f=fixture();f.disk.set(SESSION_REGISTRY_KEY,raw);assert.equal((await f.manager().add('1','correct')).code,'invalid-registry');assert.equal(f.instances.length,0);assert.equal(f.disk.get(SESSION_REGISTRY_KEY),raw);
 }
 const f=fixture();assert.equal((await f.manager({storage:()=>{throw Error();}}).add('1','correct')).code,'storage-unavailable');assert.equal((await f.manager({locks:null}).add('1','correct')).code,'locking-unavailable');assert.equal(f.instances.length,0);
});
test('new selection intent invalidates slow add, and failed cleanup is never success',async()=>{
 const f=fixture(),m=f.manager();await m.add('1','correct');const gate=defer();
 const n=f.manager({createClient:(url,key,opts)=>{const c=f.client(opts.auth.storageKey);c.loginWait=gate.promise;return c;}});
 const adding=n.add('2','correct');await tick();const selecting=n.select('1');gate.resolve();assert.equal((await adding).code,'stale-operation');assert.equal((await selecting).ok,true);assert.equal(n.getActiveLease().account.eno,'1');assert.equal(f.sessions.size,1);
 const bad=f.manager({createClient:(url,key,opts)=>{const c=f.client(opts.auth.storageKey);c.logoutError=true;return c;}});assert.equal((await bad.add('3','bad')).code,'cleanup-required');
});
test('cross-tab lock prevents duplicate additions and storage/pageshow invalidate leases',async()=>{
 const f=fixture(),a=f.manager(),b=f.manager();const results=await Promise.all([a.add('1','correct'),b.add('1','correct')]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(f.sessions.size,1);
 await a.select('1');const lease=a.getActiveLease();f.events[0].storage({key:SESSION_REGISTRY_KEY});assert.equal(lease.isCurrent(),false);await a.restore();f.events[0].pageshow({persisted:true});assert.equal(a.getActiveLease(),null);
});
test('external selection change during a request rejects old result even without storage event',async()=>{
 const f=fixture(),m=f.manager();await m.add('1','correct');await m.add('2','correct');const gate=defer();f.instances[0].accessWait=gate.promise;
 const selecting=m.select('1');await tick();const r=JSON.parse(f.disk.get(SESSION_REGISTRY_KEY));r.active=null;f.disk.set(SESSION_REGISTRY_KEY,JSON.stringify(r));gate.resolve();assert.equal((await selecting).code,'stale-operation');assert.equal(m.list().active,null);
});
test('unknown logout result never switches to another account or reports success',async()=>{
 const f=fixture(),m=f.manager();await m.add('1','correct');await m.add('2','correct');f.instances[1].logoutError=true;assert.equal((await m.logoutCurrent()).code,'logout-unknown');assert.equal(m.getActiveLease(),null);assert.equal(f.sessions.size,2);
});
test('interrupted/unknown add remains discoverable after reload and supports explicit SDK cleanup',async()=>{
 const f=fixture(),a=f.manager();await a.add('1','correct');
 const b=f.manager({createClient:(url,key,opts)=>{const c=f.client(opts.auth.storageKey);c.rows=[];c.logoutError=true;return c;}});
 assert.equal((await b.add('2','correct')).code,'cleanup-required');const slot=b.list().pending[0].slot;assert.equal((await b.add('3','correct')).code,'cleanup-required');
 const restored=f.manager();assert.equal((await restored.restore()).pending[0].slot,slot);assert.equal((await restored.cleanupPending(slot)).ok,true);assert.equal(restored.list().pending.length,0);assert.equal(f.sessions.size,1);assert.equal(restored.list().entries[0].eno,'1');
});
test('storage write failure before login preserves old registry and does not create candidate',async()=>{
 const f=fixture(),m=f.manager();await m.add('1','correct');const raw=f.disk.get(SESSION_REGISTRY_KEY);f.storage.setItem=()=>{throw Error('quota');};assert.equal((await m.add('2','correct')).code,'storage-unavailable');assert.equal(f.instances.length,1);assert.equal(f.disk.get(SESSION_REGISTRY_KEY),raw);
});
test('post-login registry write failure signs out only candidate and exposes pending cleanup',async()=>{
 const f=fixture(),m=f.manager();await m.add('1','correct');const original=f.storage.setItem;let writes=0;f.storage.setItem=(...args)=>{if(++writes>1)throw Error('quota');original(...args);};
 assert.equal((await m.add('2','correct')).code,'cleanup-required');assert.equal(f.sessions.size,1);f.storage.setItem=original;assert.equal((await m.cleanupPending(m.list().pending[0].slot)).ok,true);
});
test('a changed authenticated user between access lookup and final check is rejected',async()=>{
 const f=fixture(),m=f.manager();await m.add('1','correct');await m.add('2','correct');await m.select('1');const b=f.instances[1];let count=0;const get=b.auth.getUser;b.auth.getUser=async()=>{if(++count===2)f.sessions.set(b.key,{id:'other',email:internalEmailForEno('2')});return get();};
 assert.equal((await m.select('2')).code,'session-changed');assert.equal(m.getActiveLease().account.eno,'1');
});
test('UUID collision is rejected and dispose cancels pending activation without ending stored sessions',async()=>{
 const f=fixture(),m=f.manager();await m.add('1','correct');const slot=m.list().entries[0].slot;assert.equal((await f.manager({randomUUID:()=>slot}).add('2','correct')).code,'slot-collision');
 const gate=defer();f.instances[0].accessWait=gate.promise;const selecting=m.select('1');await tick();m.dispose();gate.resolve();assert.equal((await selecting).code,'stale-operation');assert.equal(f.sessions.size,1);assert.equal(m.getActiveLease(),null);
});
test('production obtains legacy SDK through its single shared factory',async()=>{
 const {readFile}=await import('node:fs/promises');const runtime=await readFile(new URL('../js/authRuntime.js',import.meta.url),'utf8');
 assert.match(runtime,/getLegacySupabaseClient/);assert.doesNotMatch(runtime,/createClient\(/);
});

test('SDK sign-out or identity change invalidates active lease; token refresh of same user does not',async()=>{
 const f=fixture(),m=f.manager();await m.add('1','correct');const c=f.instances[0],lease=m.getActiveLease();c.authEvent('TOKEN_REFRESHED',{user:f.sessions.get(c.key)});assert.equal(lease.isCurrent(),true);
 c.authEvent('SIGNED_OUT',null);assert.equal(m.getActiveLease(),null);await m.select('1');c.authEvent('SIGNED_IN',{user:{id:'other'}});assert.equal(m.getActiveLease(),null);
});
// Interrupted before signIn: only journal metadata was persisted.
async function interrupted() {
 const f=fixture(),m=f.manager();await m.add('1','correct');
 const slot='ffffffff-ffff-4fff-8fff-ffffffffffff',other='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 const registry=m.list();delete registry.ok;registry.pending=[{slot,eno:'2'},{slot:other,eno:'3'}];f.disk.set(SESSION_REGISTRY_KEY,JSON.stringify(registry));
 let candidate;
 const n=f.manager({createClient:(url,key,opts)=>candidate=f.client(opts.auth.storageKey)});
 return {f,m,n,slot,other,registry,candidate:()=>candidate};
}
for(const missingError of [false,true])test('absent session cleans only requested pending, releases resources and allows later add: '+missingError,async()=>{
 const s=await interrupted();const {f,n,slot,other,registry}=s;
 const work=n.cleanupPending(slot);await tick(); // default null user/session path completes
 assert.equal((await work).ok,true);assert.equal(s.candidate().authEvent,null);assert.equal(s.candidate().stopped,true);assert.deepEqual(s.candidate().signouts,[]);
 if(missingError){
  // Restore a second interrupted slot and emulate SDK AuthSessionMissingError on reload.
  const r=n.list();delete r.ok;f.disk.set(SESSION_REGISTRY_KEY,JSON.stringify(r));
  const reload=f.manager({createClient:(url,key,opts)=>{const c=f.client(opts.auth.storageKey);c.auth.getUser=async()=>({data:{user:null},error:{name:'AuthSessionMissingError'}});return c;}});
  assert.equal((await reload.cleanupPending(other)).ok,true);
 }else assert.equal((await n.cleanupPending(other)).ok,true);
 assert.deepEqual(n.list().entries,registry.entries);assert.equal(n.list().active,registry.active);assert.equal(f.sessions.size,1);assert.equal(f.instances[0].stopped,undefined);
 assert.equal((await n.cleanupPending(slot)).code,'not-pending');assert.equal((await n.add('2','correct')).ok,true);
});
for(const mode of ['network','refresh','unknown-user','session-error','ambiguous-session','session-present','throw-session'])test('uncertain cleanup preserves journal and never signs out: '+mode,async()=>{
 const {f,slot}=await interrupted();const before=f.disk.get(SESSION_REGISTRY_KEY);let candidate;
 const m=f.manager({createClient:(url,key,opts)=>{
  const c=candidate=f.client(opts.auth.storageKey);
  c.auth.getUser=async()=> mode==='network'?{data:{user:null},error:{name:'AuthRetryableFetchError'}}:mode==='refresh'?{data:{user:null},error:{code:'refresh_token_not_found'}}:mode==='unknown-user'?{data:{}}:{data:{user:null},error:{name:'AuthSessionMissingError'}};
  c.auth.getSession=async()=>{if(mode==='throw-session')throw Error('offline');return mode==='session-error'?{data:{session:null},error:{}}:mode==='session-present'?{data:{session:{user:{id:'other'}}}}:mode==='ambiguous-session'?{data:{}}:{data:{session:null}};};return c;
 }});
 assert.equal((await m.cleanupPending(slot)).code,'verification-unavailable');assert.equal(f.disk.get(SESSION_REGISTRY_KEY),before);assert.deepEqual(candidate.signouts,[]);assert.equal(candidate.stopped,undefined);assert.equal(f.sessions.size,1);
});
test('live pending session with wrong ENo is never signed out',async()=>{
 const {f,slot}=await interrupted();const key='diesduck-auth-account-v1-'+slot;f.sessions.set(key,{id:'user-9',email:internalEmailForEno('9')});const before=f.disk.get(SESSION_REGISTRY_KEY);let c;
 const m=f.manager({createClient:(u,k,o)=>c=f.client(o.auth.storageKey)});assert.equal((await m.cleanupPending(slot)).code,'eno-mismatch');assert.deepEqual(c.signouts,[]);assert.equal(f.disk.get(SESSION_REGISTRY_KEY),before);assert.equal(f.sessions.size,2);
});
test('absence confirmation cannot commit over changed registry or failed storage write',async()=>{
 for(const conflict of [true,false]){
  const {f,slot}=await interrupted();const gate=defer();let c;
  const m=f.manager({createClient:(u,k,o)=>{c=f.client(o.auth.storageKey);c.auth.getSession=async()=>{await gate.promise;return {data:{session:null}};};return c;}});
  const work=m.cleanupPending(slot);await tick();if(conflict){const r=JSON.parse(f.disk.get(SESSION_REGISTRY_KEY));r.active=null;f.disk.set(SESSION_REGISTRY_KEY,JSON.stringify(r));}else f.storage.setItem=()=>{throw Error('quota');};
  const before=f.disk.get(SESSION_REGISTRY_KEY);gate.resolve();assert.equal((await work).code,conflict?'stale-operation':'storage-unavailable');assert.equal(f.disk.get(SESSION_REGISTRY_KEY),before);assert.deepEqual(c.signouts,[]);assert.equal(c.stopped,undefined);
 }
});
test('two tabs cleaning the same empty slot serialize and only one succeeds',async()=>{
 const {f,n,slot}=await interrupted();const other=f.manager();const results=await Promise.all([n.cleanupPending(slot),other.cleanupPending(slot)]);assert.equal(results[0].ok,true);assert.equal(results[1].code,'not-pending');assert.equal(f.sessions.size,1);
});
