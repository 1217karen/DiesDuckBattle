import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './accountIntegrationFixture.mjs';
import {createAccountAuthController} from '../js/accountAuthController.js';
import {createOnlineEditController} from '../js/onlineEditController.js';
import {requireLoginPage} from '../js/authPageGuard.js';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
const tick=()=>new Promise(r=>setImmediate(r));
async function setup(section='build'){
 const f=environment(),page=f.page(),runtime=await page.get(),paths=[],redirects=[],classes=new Set();
 const auth=createAccountAuthController({runtime,registrationService:{},navigate:url=>paths.push(url),chooseLogout:async()=> 'game'});
 await auth.start();await auth.login('1','valid');await auth.login('2','valid');await auth.select('1');
 // A new page owns a fresh controller after the normal login navigation.
 const next=f.page(),r=await next.get(),controller=createAccountAuthController({runtime:r,registrationService:{},navigate:url=>paths.push(url),chooseLogout:async()=> 'game'});await controller.start();paths.length=0;
 await requireLoginPage({getRuntime:async()=>controller,document:{body:{classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}}},location:{replace:url=>redirects.push(url)}});
 let row={ok:true,account:{id:r.getCurrent().account.gameAccountId,eno:'1'},authUserId:r.getCurrent().account.authUserId,revision:'0',data:{build:{ducks:[]},presentation:{name:'original'},battlerName:'A'}};
 let saving,confirmCalls=0;
 const editor=createOnlineEditController({sections:[section],storage:{load:async()=>structuredClone(row),save:async(_base,data)=>{if(saving)await saving;row={...row,data:structuredClone(data),revision:'1'};return structuredClone(row);}},confirm:()=>{confirmCalls++;return true;}});
 await editor.load();controller.beforeLogout(context=>editor.canLeave(context));
 return {f,page:next,r,auth:controller,editor,paths,redirects,classes,section,confirmCalls:()=>confirmCalls,deferSave:p=>saving=p};
}
for(const section of ['build','presentation'])test(section+': dirty switch/add/reauthentication rejects without discard; save permits one home navigation',async()=>{
 const s=await setup(section),value=section==='build'?{ducks:[],draftValue:'unsaved'}:{name:'unsaved'};s.editor.edit({[section]:value});
 const before=s.editor.snapshot();
 for(const run of [()=>s.auth.select('2'),()=>s.auth.login('3','valid'),()=>s.auth.login('2','valid')]){
  const result=await run();assert.equal(result.ok,false);assert.equal(result.message,'未保存の変更があります。保存してからアカウントを切り替えてください。');
  assert.equal(s.auth.snapshot().enos[0],'1');assert.deepEqual(s.editor.snapshot().draft,before.draft);assert.equal(s.confirmCalls(),0);assert.deepEqual(s.paths,[]);assert.deepEqual(s.redirects,[]);assert.equal(s.classes.has('auth-required-pending'),false);
 }
 await s.editor.save();assert.equal((await s.auth.select('2')).ok,true);assert.equal(s.auth.snapshot().enos[0],'2');assert.deepEqual(s.paths,['index.html']);assert.deepEqual(s.redirects,[]);assert.equal(s.classes.has('auth-required-pending'),true);
});
test('saving and coordinator writes refuse switch with specific message; logout still asks to discard',async()=>{
 const s=await setup();s.editor.edit({build:{ducks:[]}});const gate=deferred();s.deferSave(gate.promise);const save=s.editor.save();
 assert.equal((await s.auth.select('2')).message,'処理中です。完了してからアカウントを切り替えてください。');assert.equal(s.auth.snapshot().enos[0],'1');gate.resolve();await save;
 const writeGate=deferred(),writing=s.auth.coordinator.write(()=>writeGate.promise);assert.equal((await s.auth.select('2')).message,'処理中です。完了してからアカウントを切り替えてください。');writeGate.resolve();await writing;
 s.editor.edit({build:{ducks:[]}});assert.equal((await s.auth.logout()).ok,true);assert.equal(s.confirmCalls(),1);assert.deepEqual(s.paths,['index.html']);assert.deepEqual(s.redirects,[]);
});
for(const failure of ['offline','expired'])test('failed '+failure+' switch restores verified A on same protected page',async()=>{
 const s=await setup(),old=s.auth.getClient(),client=s.f.clients.findLast(c=>s.f.sessions.get(c.key)?.email.includes('eno-2@'));
 if(failure==='offline')s.f.offlineKeys.add(client.key);else s.f.sessions.delete(client.key);
 // B is lazily created on selection; inject the failure for current and future clients.
 for(const c of s.f.clients.filter(c=>c.key===client.key))if(failure==='offline')c.offline=true;
 const pending=s.auth.select('2');assert.equal(s.classes.has('auth-required-pending'),true);assert.deepEqual(s.redirects,[]);
 assert.equal((await pending).ok,false);assert.equal(s.auth.snapshot().enos[0],'1');assert.ok(s.auth.snapshot().message);assert.deepEqual(s.paths,[]);assert.deepEqual(s.redirects,[]);assert.equal(s.classes.has('auth-required-pending'),false);assert.ok(old.accountContext.isCurrent());
});
test('unverifiable A after failed switch stays hidden and exits; external logout still invalidates the page',async()=>{
 for(const external of [false,true]){
  const s=await setup();
  if(external){const p=s.f.page(),r=await p.get();await r.initialize();await r.logoutGame();s.page.events.fire('storage',{key:'diesduck-account-sessions-v1'});await tick();}
  else {for(const c of s.f.clients)s.f.offlineKeys.add(c.key);assert.equal((await s.auth.select('2')).ok,false);}
  assert.equal(s.auth.getClient(),null);assert.equal(s.classes.has('auth-required-pending'),true);assert.equal(s.redirects.length,1);
 }
});
test('external selection invalidates old content and cannot be mistaken for a local successful switch',async()=>{
 const s=await setup(),old=s.auth.getClient(),p=s.f.page(),r=await p.get();await r.initialize();await r.select('2');
 s.page.events.fire('storage',{key:'diesduck-account-sessions-v1'});await tick();
 assert.ok(!old.accountContext.isCurrent());assert.equal(s.classes.has('auth-required-pending'),true);assert.deepEqual(s.redirects,['index.html']);assert.deepEqual(s.paths,[]);
});
