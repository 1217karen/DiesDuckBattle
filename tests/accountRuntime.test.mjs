import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAccountRuntimeProvider} from '../js/accountRuntime.js';
import {SESSION_REGISTRY_KEY,LEGACY_SESSION_KEY} from '../js/accountSessionManager.js';
import {internalEmailForEno} from '../supabase/functions/_shared/internal-email.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function environment(){
 const disk=new Map(),sessions=new Map(),clients=[];let seq=0,tail=Promise.resolve(),sdkLoads=0,legacyCalls=0;
 const storage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)};
 const locks={request(name,options,fn){assert.equal(name,SESSION_REGISTRY_KEY);const result=tail.then(fn);tail=result.catch(()=>{});return result;}};
 function bus(){const handlers=new Map();return {visibilityState:'visible',addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(fn);},removeEventListener(name,fn){handlers.get(name)?.delete(fn);},fire(name,event={}){for(const fn of handlers.get(name)??[])fn(event);}};}
 function client(key){
  const callbacks=new Set();const c={key,signouts:[],auth:{
   onAuthStateChange(fn){callbacks.add(fn);return {data:{subscription:{unsubscribe:()=>callbacks.delete(fn)}}};},
   async signInWithPassword({email,password}){if(password!=='valid')return {error:{}};sessions.set(key,{id:'auth-'+email,email});return {data:{session:{user:sessions.get(key)}}};},
   async getUser(){if(c.wait)await c.wait;if(c.offline)throw Error('offline');return {data:{user:sessions.get(key)??null}};},
   async getSession(){return {data:{session:sessions.has(key)?{user:sessions.get(key)}:null}};},
   async signOut(options){c.signouts.push(options);sessions.delete(key);c.event('SIGNED_OUT',null);return {error:null};},stopAutoRefresh(){c.stopped=true;}
  },event(event,session){for(const fn of callbacks)fn(event,session);},from(table){assert.equal(table,'game_account_access');return {select(){return {async eq(field,id){assert.equal(field,'auth_user_id');assert.equal(id,sessions.get(key)?.id);const eno=sessions.get(key)?.email.match(/eno-(\d+)@/)[1];return {data:c.rows??[{game_account_id:'00000000-0000-4000-8000-'+eno.padStart(12,'0'),game_accounts:{eno,battlers:{presentation:{name:'Name'+eno}}}}]};}};}};}};
  clients.push(c);return c;
 }
 let legacy;
 function page(){const events=bus(),document=bus();const get=createAccountRuntimeProvider({
  loadSDK:async()=>{sdkLoads++;return {createClient:(url,key,options)=>{assert.equal(options.auth.persistSession,true);assert.equal(options.auth.autoRefreshToken,true);assert.equal(options.auth.detectSessionInUrl,false);return client(options.auth.storageKey);}};},
  getLegacyClient:()=>{legacyCalls++;return legacy??=client(LEGACY_SESSION_KEY);},config:{url:'https://example.invalid',publishableKey:'public'},
  managerOptions:{storage:()=>storage,locks,events,document,randomUUID:()=>`00000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`},
 });return {get,events,document};}
 return {page,clients,disk,sessions,client,legacy:()=>legacy??=client(LEGACY_SESSION_KEY),sdkLoads:()=>sdkLoads,legacyCalls:()=>legacyCalls};
}
test('page provider shares one lazy runtime and manager; clients/account identifiers come only from leases',async()=>{
 const f=environment(),p=f.page();assert.equal(f.sdkLoads(),0);const [r,s]=await Promise.all([p.get(),p.get()]);assert.equal(r,s);assert.equal(f.sdkLoads(),1);assert.equal(f.clients.length,0);
 assert.equal((await r.add('1','valid')).ok,true);const a=r.getCurrent();assert.equal((await r.add('2','valid')).ok,true);const b=r.getCurrent();
 assert.notEqual(a.client,b.client);assert.equal(a.isCurrent(),false);assert.equal(b.account.eno,'2');assert.equal(b.account.gameAccountId,'00000000-0000-4000-8000-000000000002');assert.equal(b.account.authUserId,'auth-'+internalEmailForEno('2'));assert.equal(Object.isFrozen(b.account),true);assert.equal(f.sessions.size,2);assert.equal(f.legacyCalls(),0);
});
test('selected B restores on next page without creating or returning the legacy client',async()=>{
 const f=environment(),r=await f.page().get();await r.add('1','valid');await r.add('2','valid');r.dispose();
 const next=await f.page().get();assert.equal(next.getCurrent(),null);assert.equal((await next.restore()).ok,true);assert.equal(next.getCurrent().account.eno,'2');assert.equal(f.legacyCalls(),0);
});
test('logout removes B only, stays unselected across reload, and never adopts A automatically',async()=>{
 const f=environment(),r=await f.page().get();await r.add('1','valid');const a=r.getCurrent().client;await r.add('2','valid');const b=r.getCurrent().client;
 assert.equal((await r.logoutCurrent()).ok,true);assert.deepEqual(b.signouts,[{scope:'local'}]);assert.deepEqual(a.signouts,[]);assert.equal(r.getCurrent(),null);assert.equal(r.snapshot().phase,'unselected');
 const next=await f.page().get();assert.equal((await next.restore()).ok,true);assert.equal(next.getCurrent(),null);assert.equal(next.snapshot().entries.length,1);assert.equal(f.legacyCalls(),0);
});
test('legacy handoff is explicit, verifies one account, and reuses the exact legacy client',async()=>{
 const f=environment();f.sessions.set(LEGACY_SESSION_KEY,{id:'old',email:internalEmailForEno('7')});const r=await f.page().get();await r.restore();assert.equal(r.getCurrent(),null);assert.equal(f.legacyCalls(),0);
 assert.equal((await r.adoptLegacy()).ok,true);assert.equal(r.getCurrent().client,f.clients[0]);assert.equal(f.clients.filter(c=>c.key===LEGACY_SESSION_KEY).length,1);
 await r.restore();assert.equal(f.legacyCalls(),1);await r.add('2','valid');assert.notEqual(r.getCurrent().client.key,LEGACY_SESSION_KEY);assert.ok(f.sessions.has(LEGACY_SESSION_KEY));
});
test('legacy multiple access is refused without automatic selection',async()=>{
 const f=environment();f.sessions.set(LEGACY_SESSION_KEY,{id:'old',email:internalEmailForEno('7')});const r=await f.page().get();
 f.legacy().rows=[{game_accounts:{eno:'7'}},{game_accounts:{eno:'8'}}];
 assert.equal((await r.adoptLegacy()).code,'ambiguous-account');assert.equal(r.getCurrent(),null);assert.deepEqual(f.clients[0].signouts,[]);
});
test('expired selected session and temporary network error have distinct results and no old-client fallback',async()=>{
 for(const offline of [false,true]){
  const f=environment(),r=await f.page().get();await r.add('1','valid');await r.add('2','valid');const c=r.getCurrent().client,old=r.getCurrent();if(offline)c.offline=true;else f.sessions.delete(c.key);
  const result=await r.restore();assert.equal(result.code,offline?'verification-unavailable':'reauthentication-required');assert.equal(r.getCurrent(),null);assert.equal(old.isCurrent(),false);assert.equal(r.snapshot().current,null);assert.ok(f.sessions.has(f.clients[0].key));
 }
});
test('storage, pagehide, pageshow and visibility suspend old leases until revalidation',async()=>{
 const f=environment(),p=f.page(),r=await p.get();await r.add('1','valid');
 for(const fire of [()=>p.events.fire('storage',{key:SESSION_REGISTRY_KEY}),()=>p.events.fire('pagehide'),()=>p.events.fire('pageshow',{persisted:true}),()=>{p.document.visibilityState='hidden';p.document.fire('visibilitychange');}]){
  const old=r.getCurrent();fire();assert.equal(old.isCurrent(),false);assert.equal(r.getCurrent(),null);assert.equal((await r.restore()).ok,true);
 }
});
test('different tab selection makes old context invalid even before storage event delivery',async()=>{
 const f=environment(),a=await f.page().get();await a.add('1','valid');await a.add('2','valid');const old=a.getCurrent();const p=f.page(),b=await p.get();await b.restore();await b.select('1');assert.equal(old.isCurrent(),false);assert.equal(a.getCurrent(),null);await a.restore();assert.equal(a.getCurrent().account.eno,'1');
});
test('slow selection result cannot supersede later selection or storage invalidation',async()=>{
 const f=environment(),p=f.page(),r=await p.get();await r.add('1','valid');await r.add('2','valid');const gate=deferred();f.clients[0].wait=gate.promise;
 const first=r.select('1');await tick();assert.equal(r.getCurrent(),null);const second=r.select('2');gate.resolve();assert.equal((await first).code,'stale-operation');assert.equal((await second).ok,true);assert.equal(r.getCurrent().account.eno,'2');
 const gate2=deferred();f.clients[0].wait=gate2.promise;const third=r.select('1');await tick();p.events.fire('storage',{key:SESSION_REGISTRY_KEY});gate2.resolve();assert.equal((await third).code,'stale-operation');assert.equal(r.getCurrent(),null);
});
test('SDK signout invalidates context and notifies UI without issuing SDK calls inside callbacks',async()=>{
 const f=environment(),r=await f.page().get();await r.add('1','valid');const old=r.getCurrent(),seen=[];r.subscribe(s=>seen.push(s));old.client.event('SIGNED_OUT',null);assert.equal(r.getCurrent(),null);await tick();assert.equal(seen.at(-1).current,null);assert.equal(old.isCurrent(),false);
});
test('pending cleanup is delegated and successful action revalidates existing active account',async()=>{
 const f=environment(),r=await f.page().get();await r.add('1','valid');const reg=JSON.parse(f.disk.get(SESSION_REGISTRY_KEY)),slot='ffffffff-ffff-4fff-8fff-ffffffffffff';reg.pending.push({slot,eno:'2'});f.disk.set(SESSION_REGISTRY_KEY,JSON.stringify(reg));
 await r.restore();assert.equal(r.snapshot().pending.length,1);const result=await r.cleanupPending(slot);assert.equal(result.ok,true);assert.equal(result.completed,'cleanup');assert.equal(r.getCurrent().account.eno,'1');assert.equal(r.snapshot().pending.length,0);assert.equal(f.sessions.size,1);
});
test('failed add preserves active account; subscriber cannot convert old result into success after selecting anew',async()=>{
 const f=environment(),r=await f.page().get();await r.add('1','valid');assert.equal((await r.add('2','bad')).code,'login-failed');assert.equal(r.getCurrent().account.eno,'1');
 let triggered=false,next;const stop=r.subscribe(s=>{if(!triggered&&s.current?.eno==='2'){triggered=true;next=r.select('1');}});
 assert.equal((await r.add('2','valid')).code,'stale-operation');assert.equal((await next).ok,true);assert.equal(r.getCurrent().account.eno,'1');stop();
});
test('runtime and legacy use the same pinned SDK; legacy handoff cannot recurse through selected-client lookup',async()=>{
 const clients=await readFile(new URL('../js/supabaseClients.js',import.meta.url),'utf8'),next=await readFile(new URL('../js/accountRuntime.js',import.meta.url),'utf8');
 assert.equal(next.match(/supabase-js@([\d.]+)/)[1],clients.match(/supabase-js@([\d.]+)/)[1]);
 assert.match(clients,/client\("diesduck-auth-session"\)/);assert.match(next,/getLegacySupabaseClient/);assert.doesNotMatch(next,/import\("\.\/authRuntime.js"\)/);
});

test('new intent from a busy subscriber prevents the superseded operation from starting',async()=>{
 const f=environment(),r=await f.page().get();await r.add('1','valid');let next,once=false;
 const stop=r.subscribe(s=>{if(s.busy==='add'&&!once){once=true;next=r.select('1');}});
 assert.equal((await r.add('2','valid')).code,'stale-operation');assert.equal((await next).ok,true);assert.equal(f.clients.length,1);assert.equal(r.getCurrent().account.eno,'1');stop();
});
test('provider retries SDK loading failure, and disposal invalidates previously issued contexts',async()=>{
 let attempts=0;const getter=createAccountRuntimeProvider({loadSDK:async()=>{attempts++;throw Error('load failure');}});
 await assert.rejects(getter());await assert.rejects(getter());assert.equal(attempts,2);
 const f=environment(),r=await f.page().get();await r.add('1','valid');const lease=r.getCurrent();r.dispose();assert.equal(lease.isCurrent(),false);assert.equal(r.getCurrent(),null);assert.equal((await r.restore()).code,'closed');assert.equal(f.sessions.size,1);
});
