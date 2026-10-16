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
for(const reason of ['pagehide','pageshow','page-hidden'])test(`${reason} withdraws auth without confirming logout or racing page guard`,async()=>{
 const s=await app();await s.auth.login('1','valid');await s.guard();const old=s.auth.getClient(),lease=s.runtime.getCurrent(),disk=new Map(s.f.disk);
 if(reason==='page-hidden'){s.page.document.visibilityState='hidden';s.page.document.fire('visibilitychange');}
 else s.page.events.fire(reason,{persisted:true});
 await tick();assert.equal(s.runtime.snapshot().phase,'suspended');assert.equal(s.auth.snapshot().ready,false);assert.equal(s.auth.snapshot().sessionKnown,false);
 assert.equal(s.auth.snapshot().logoutSucceeded,false);assert.equal(s.auth.getClient(),null);assert.equal(lease.isCurrent(),false);
 assert.ok((await old.auth.getSession()).error);assert.ok((await old.rpc('save_online_player',{p_game_account_id:lease.account.gameAccountId})).error);
 assert.deepEqual(s.redirects,[]);assert.ok(s.classes.has('auth-required-pending'));assert.deepEqual(s.f.disk,disk);
 // The resumed document creates fresh page-bound clients and performs a new getUser/access check.
 assert.equal(s.runtime.getCurrent(),null);
 const restored=await app(s.f);assert.equal(restored.auth.snapshot().enos[0],'1');await restored.guard();assert.deepEqual(restored.redirects,[]);
 assert.ok(!old.accountContext.isCurrent());assert.equal(restored.auth.getClient().accountContext.isCurrent(),true);
});
test('delayed verification remains unknown; network errors fail closed without login/logout notices or clearing sessions',async()=>{
 const first=await app();await first.auth.login('1','valid');const s=await app(first.f);const raw=s.runtime.getCurrent().client,gate=deferred();raw.wait=gate.promise;
 const restore=s.runtime.restore();const pending=s.guard();await tick();assert.equal(s.auth.snapshot().sessionKnown,false);assert.equal(s.auth.snapshot().ready,false);assert.deepEqual(s.redirects,[]);
 gate.resolve();await restore;await pending;assert.equal(s.auth.snapshot().signedIn,true);
 const before=new Map(s.f.sessions);raw.offline=true;await s.runtime.restore();await tick();
 assert.equal(s.auth.snapshot().sessionKnown,false);assert.equal(s.auth.snapshot().ready,true);assert.equal(s.auth.snapshot().logoutSucceeded,false);
 assert.equal(menuModel(s.auth.snapshot()).identity,'ログイン状態を確認できません');assert.deepEqual(s.redirects,['index.html']);assert.deepEqual(s.f.sessions,before);
 raw.offline=false;await s.runtime.restore();assert.equal(s.auth.snapshot().enos[0],'1');
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
