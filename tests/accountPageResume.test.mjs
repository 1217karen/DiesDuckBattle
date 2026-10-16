import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './accountIntegrationFixture.mjs';
import {createAccountAuthController} from '../js/accountAuthController.js';
import {requireLoginPage} from '../js/authPageGuard.js';
import {menuModel} from '../js/commonMenuModel.js';
import {SESSION_REGISTRY_KEY} from '../js/accountSessionManager.js';
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
async function app(f=environment()){
 const page=f.page(),runtime=await page.get(),auth=createAccountAuthController({runtime,registrationService:{}});await auth.start();
 const redirects=[],classes=new Set(),guard=()=>requireLoginPage({getRuntime:async()=>auth,document:{body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}}},location:{replace:x=>redirects.push(x)}});
 return {f,page,runtime,auth,redirects,classes,guard};
}
const settled=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}assert.fail('did not settle');};
for(const reason of ['pagehide','pageshow','page-hidden'])test(`${reason} withdraws auth and automatically restores only with a fresh lease`,async()=>{
 const first=await app();await first.auth.login('1','valid');const s=await app(first.f);await s.guard();
 const old=s.auth.getClient(),lease=s.runtime.getCurrent(),disk=new Map(s.f.disk),gate=deferred();lease.client.wait=gate.promise;
 if(reason==='page-hidden'){s.page.document.visibilityState='hidden';s.page.document.fire('visibilitychange');}
 else s.page.events.fire(reason,{persisted:true});
 await tick();assert.ok(['suspended','busy'].includes(s.runtime.snapshot().phase));assert.equal(s.auth.snapshot().ready,false);assert.equal(s.auth.snapshot().sessionKnown,false);
 assert.equal(s.auth.snapshot().logoutSucceeded,false);assert.equal(s.auth.getClient(),null);assert.equal(lease.isCurrent(),false);
 assert.ok((await old.auth.getSession()).error);assert.ok((await old.rpc('save_online_player',{p_game_account_id:lease.account.gameAccountId})).error);
 assert.deepEqual(s.redirects,[]);assert.ok(s.classes.has('auth-required-pending'));assert.deepEqual(s.f.disk,disk);
 if(reason==='page-hidden'){s.page.document.visibilityState='visible';s.page.document.fire('visibilitychange');}
 else if(reason==='pagehide')s.page.events.fire('pageshow',{persisted:true});
 gate.resolve();await settled(()=>s.auth.snapshot().signedIn);
 assert.equal(s.auth.snapshot().enos[0],'1');assert.deepEqual(s.redirects,[]);assert.ok(!s.classes.has('auth-required-pending'));
 assert.equal(lease.isCurrent(),false);assert.equal(old.accountContext.isCurrent(),true);s.auth.stop();
});
test('delayed verification remains unknown; network errors fail closed without login/logout notices or clearing sessions',async()=>{
 const first=await app();await first.auth.login('1','valid');const s=await app(first.f);const raw=s.runtime.getCurrent().client,gate=deferred();raw.wait=gate.promise;
 const restore=s.runtime.restore();const pending=s.guard();await tick();assert.equal(s.auth.snapshot().sessionKnown,false);assert.equal(s.auth.snapshot().ready,false);assert.deepEqual(s.redirects,[]);
 gate.resolve();await restore;await pending;assert.equal(s.auth.snapshot().signedIn,true);
 const before=new Map(s.f.sessions);raw.offline=true;await s.runtime.restore();await tick();
 assert.equal(s.auth.snapshot().sessionKnown,false);assert.equal(s.auth.snapshot().ready,true);assert.equal(s.auth.snapshot().logoutSucceeded,false);
 assert.equal(menuModel(s.auth.snapshot()).identity,'ログイン状態を確認できません');assert.deepEqual(s.redirects,[]);assert.ok(s.classes.has('auth-required-pending'));assert.equal(s.auth.snapshot().retryable,true);assert.deepEqual(s.f.sessions,before);
 raw.offline=false;await s.auth.retry();assert.equal(s.auth.snapshot().enos[0],'1');assert.ok(!s.classes.has('auth-required-pending'));
});
test('expired session is known signed-out; guest and cross-tab logout remain denied',async()=>{
 const s=await app();await assert.rejects(s.guard(),/Login required/);assert.deepEqual(s.redirects,['index.html?notice=login-required']);s.redirects.length=0;
 await s.auth.login('1','valid');s.auth.stop();const resumed=await app(s.f);await resumed.guard();resumed.f.sessions.delete(resumed.runtime.getCurrent().client.key);await resumed.runtime.restore();
 assert.equal(resumed.auth.snapshot().sessionKnown,true);assert.equal(resumed.runtime.snapshot().phase,'reauthentication-required');assert.equal(resumed.auth.snapshot().logoutSucceeded,false);assert.deepEqual(resumed.redirects,['index.html']);
});
test('cross-tab selection withdraws old writes and cannot show the old page under B',async()=>{
 const s=await app();await s.auth.login('1','valid');await s.auth.login('2','valid');await s.auth.select('1');await s.guard();const old=s.auth.getClient();
 const other=await app(s.f);await other.auth.select('2');assert.ok(!old.accountContext.isCurrent());
 s.page.events.fire('storage',{key:SESSION_REGISTRY_KEY});await tick();assert.ok(s.classes.has('auth-required-pending'));assert.deepEqual(s.redirects,['index.html']);
 assert.equal(s.auth.snapshot().logoutSucceeded,false);assert.equal(s.auth.snapshot().sessionKnown,false);await s.runtime.restore();assert.equal(s.auth.snapshot().enos[0],'2');assert.ok(!old.accountContext.isCurrent());
});

test('token refresh and SDK storage updates suspend then reverify; unselected token writes do not affect A',async()=>{
 const first=await app();await first.auth.login('2','valid');await first.auth.login('1','valid');
 const count=first.f.clients.length,s=await app(first.f);await s.guard();assert.equal(s.f.clients.length,count+1);
 assert.equal(s.runtime.snapshot().entries.find(e=>e.eno==='2').status,'unchecked');
 const raw=s.runtime.getCurrent().client,old=s.auth.getClient(),lease=s.runtime.getCurrent();
 const gate=deferred();raw.wait=gate.promise;
 raw.event('TOKEN_REFRESHED',{user:s.f.sessions.get(raw.key)});await tick();
 assert.equal(s.auth.snapshot().sessionKnown,false);assert.ok(s.classes.has('auth-required-pending'));assert.equal(lease.isCurrent(),false);
 assert.ok((await old.auth.getSession()).error);assert.deepEqual(s.redirects,[]);
 gate.resolve();await settled(()=>s.auth.snapshot().signedIn);assert.equal(old.accountContext.isCurrent(),true);assert.equal(lease.isCurrent(),false);
 s.page.events.fire('storage',{key:raw.key});await settled(()=>s.auth.snapshot().signedIn);assert.deepEqual(s.redirects,[]);
 const active=s.runtime.getCurrent();const other=s.runtime.snapshot().entries.find(e=>e.eno==='2');
 s.f.sessions.delete('diesduck-auth-account-v1-'+other.slot);
 s.page.events.fire('storage',{key:'diesduck-auth-account-v1-'+other.slot});await tick();assert.equal(active.isCurrent(),true);
 s.auth.stop();
});
test('old RPC responses and leases stay rejected after same-account recovery; new requests work',async()=>{
 const first=await app();await first.auth.login('1','valid');const s=await app(first.f);await s.guard();
 const raw=s.runtime.getCurrent().client,gate=deferred(),old=s.auth.getClient(),lease=s.runtime.getCurrent();
 raw.rpc=async()=>{await gate.promise;return {data:{old:true}};};
 const read=old.rpc('load_online_player',{p_game_account_id:lease.account.gameAccountId});
 s.page.events.fire('pageshow',{persisted:true});await settled(()=>s.auth.snapshot().signedIn);
 gate.resolve();assert.ok((await read).error);assert.equal(lease.isCurrent(),false);
 raw.rpc=async()=>({data:{fresh:true}});assert.deepEqual((await old.rpc('load_online_player',{p_game_account_id:lease.account.gameAccountId})).data,{fresh:true});s.auth.stop();
});
test('cross-tab logout during a pending recovery cannot be overwritten by old verification',async()=>{
 const first=await app();await first.auth.login('1','valid');const s=await app(first.f);await s.guard();const old=s.auth.getClient(),gate=deferred();
 s.runtime.getCurrent().client.wait=gate.promise;s.page.events.fire('pageshow',{persisted:true});await tick();
 const registry=JSON.parse(s.f.disk.get(SESSION_REGISTRY_KEY));registry.active=null;s.f.disk.set(SESSION_REGISTRY_KEY,JSON.stringify(registry));s.page.events.fire('storage',{key:SESSION_REGISTRY_KEY});
 gate.resolve();await tick();await tick();assert.equal(s.auth.snapshot().signedIn,false);assert.equal(s.auth.getClient(),null);assert.ok(!old.accountContext.isCurrent());assert.deepEqual(s.redirects,['index.html']);s.auth.stop();
});
test('storage renewal during startup cancels stale startup and automatically completes verification',async()=>{
 const first=await app();await first.auth.login('1','valid');const page=first.f.page(),runtime=await page.get(),auth=createAccountAuthController({runtime,registrationService:{}});
 const gate=deferred(),key=first.runtime.getCurrent().client.key;first.f.userWaits.set(key,gate.promise);
 const starting=auth.start();await tick();assert.equal(auth.snapshot().ready,false);
 page.events.fire('storage',{key});const pending=runtime.revalidate();
 page.events.fire('storage',{key});gate.resolve();await starting;await pending;await settled(()=>auth.snapshot().signedIn);
 assert.equal(auth.snapshot().enos[0],'1');auth.stop();
});
