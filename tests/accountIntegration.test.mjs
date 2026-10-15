import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './accountIntegrationFixture.mjs';
import {createAccountAuthController} from '../js/accountAuthController.js';
import {createOnlinePlayerStorage} from '../js/onlinePlayerStorage.js';
import {createBattleResultStorage} from '../js/battleResultStorage.js';
import {createSkillVaultStorage} from '../js/skillVaultStorage.js';
import {LEGACY_SESSION_KEY, SESSION_REGISTRY_KEY} from '../js/accountSessionManager.js';
import {internalEmailForEno} from '../supabase/functions/_shared/internal-email.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
async function app(f=environment()) {
 const page=f.page(),runtime=await page.get(),paths=[];
 const auth=createAccountAuthController({runtime,registrationService:{register:async()=>({ok:true,eno:'3'})},navigate:path=>paths.push(path)});
 await auth.start(); return {f,page,runtime,auth,paths};
}
test('first visit adopts a verified legacy session once; subsequent unselected pages do not adopt it',async()=>{
 const f=environment();f.sessions.set(LEGACY_SESSION_KEY,{id:'auth-7',email:internalEmailForEno('7')});
 const a=await app(f);assert.equal(a.auth.snapshot().enos[0],'7');assert.equal(f.clients.length,1);
 await a.auth.login('2','valid');await a.auth.logout();
 const b=await app(f);assert.equal(b.auth.getClient(),null);assert.equal(b.auth.snapshot().savedAccounts[0].eno,'7');assert.ok(f.sessions.has(LEGACY_SESSION_KEY));
});
test('A adds B, home navigation, reload restores B, password-free selection restores A',async()=>{
 const a=await app();assert.equal((await a.auth.login('1','valid')).ok,true);const clientA=a.auth.getClient();
 assert.equal((await a.auth.login('2','valid')).ok,true);assert.equal(a.auth.snapshot().enos[0],'2');assert.equal(a.paths.at(-1),'index.html');
 assert.equal((await clientA.auth.getSession()).data,null);
 const b=await app(a.f);assert.equal(b.auth.getClient().accountContext.account.eno,'2');
 assert.equal((await b.auth.select('1')).ok,true);assert.equal(b.auth.snapshot().enos[0],'1');assert.equal(b.paths.at(-1),'index.html');
});
test('failed B login and duplicate A do not destroy the original scoped client/session',async()=>{
 const a=await app();await a.auth.login('1','valid');const client=a.auth.getClient();
 assert.equal((await a.auth.login('2','bad')).ok,false);assert.equal(a.auth.snapshot().enos[0],'1');
 assert.equal((await client.auth.getSession()).error,undefined);assert.equal((await a.auth.login('1','valid')).code,'already-added');assert.equal(a.f.sessions.size,1);
});
test('logout B retains A without automatic selection; unselected menu entries can select A',async()=>{
 const a=await app();await a.auth.login('1','valid');await a.auth.login('2','valid');assert.equal((await a.auth.logout()).ok,true);
 assert.equal(a.auth.getClient(),null);assert.deepEqual(a.auth.snapshot().savedAccounts.map(e=>e.eno),['1']);assert.equal(a.f.sessions.size,1);
 await a.auth.select('1');assert.equal(a.auth.snapshot().enos[0],'1');await a.auth.logout();assert.equal(a.f.sessions.size,0);assert.equal(a.auth.snapshot().savedAccounts.length,0);
});
test('expired slot can reauthenticate only that ENo; network failures cannot overwrite a healthy session',async()=>{
 const a=await app();await a.auth.login('1','valid');await a.auth.login('2','valid');const b=a.runtime.getCurrent().client;a.f.sessions.delete(b.key);
 assert.equal((await a.auth.select('2')).code,'reauthentication-required');
 assert.equal((await a.auth.login('2','valid')).ok,true);assert.equal(a.f.sessions.size,2);assert.equal(a.auth.snapshot().savedAccounts.length,2);
 b.offline=true;assert.equal((await a.auth.login('2','valid')).ok,false);assert.equal(a.f.sessions.size,2);
});
test('unsaved guard applies to add, select, logout and prevents requests',async()=>{
 const a=await app();await a.auth.login('1','valid');const stop=a.auth.beforeLogout(()=>false);
 for(const work of [()=>a.auth.login('2','valid'),()=>a.auth.select('1'),()=>a.auth.logout()])assert.equal((await work()).code,'cancelled');
 assert.equal(a.f.sessions.size,1);stop();assert.equal((await a.auth.login('2','valid')).ok,true);
});
test('actual RPC write blocks account changes, rejects mismatched IDs and releases the guard',async()=>{
 const a=await app();await a.auth.login('1','valid');const c=a.auth.getClient(),raw=a.runtime.getCurrent().client,wait=deferred();let calls=0;
 raw.rpc=async()=>{calls++;return wait.promise;};
 assert.equal((await c.rpc('save_online_player',{p_game_account_id:'other'})).error.code,'42501');assert.equal(calls,0);
 const pending=c.rpc('save_online_player',{p_game_account_id:c.accountContext.account.gameAccountId});
 assert.equal((await a.auth.login('2','valid')).code,'operation-in-progress');assert.equal((await a.auth.logout()).code,'operation-in-progress');
 wait.resolve({data:{revision:'2'}});assert.equal((await pending).data.revision,'2');assert.equal((await a.auth.login('2','valid')).ok,true);
});
test('saved battle and favorites use fixed A client and reject B account IDs',async()=>{
 const a=await app();await a.auth.login('1','valid');const c=a.auth.getClient(),id=c.accountContext.account.gameAccountId,calls=[];
 a.runtime.getCurrent().client.rpc=async(name,args)=>{calls.push([name,args]);return {data:{battleId:'b',battleNo:'1',dateISO:'now',favorite:true}};};
 const service=createBattleResultStorage(c);
 assert.equal((await service.save({p1:{battlerId:id},p2:{battlerId:'opponent'}})).ok,true);
 assert.equal((await service.setFavorite({gameAccountId:id,battleId:'b',favorite:true})).ok,true);
 assert.equal((await service.setFavorite({gameAccountId:'B',battleId:'b',favorite:true})).ok,false);assert.equal(calls.length,2);
 await a.auth.login('2','valid');assert.equal((await service.setFavorite({gameAccountId:id,battleId:'b',favorite:true})).ok,false);assert.equal(calls.length,2);
});
test('feedback and home message writes require the verified ENo, without falling back to old client',async()=>{
 const a=await app();await a.auth.login('1','valid');const c=a.auth.getClient();let calls=0;
 a.runtime.getCurrent().client.rpc=async()=>{calls++;return {data:true};};
 for(const name of ['set_index_message','create_feedback_thread','create_feedback_reply','toggle_feedback_reaction','withdraw_feedback_thread']){
  assert.equal((await c.rpc(name,{p_eno:'2'})).error.code,'42501');assert.equal((await c.rpc(name,{p_eno:'1'})).data,true);
 }
 assert.equal(calls,5);await a.auth.logout();assert.equal((await c.rpc('set_index_message',{p_eno:'1'})).error.code,'PGRST301');
});
test('player storage resolves from the verified context and rejects another gameAccountId',async()=>{
 const a=await app();await a.auth.login('1','valid');const c=a.auth.getClient(),service=createOnlinePlayerStorage(c);
 assert.deepEqual((await service.resolveAccount()).account,{id:c.accountContext.account.gameAccountId,eno:'1'});
 assert.equal((await service.load({gameAccountId:'wrong'})).status,'forbidden');
});
test('vault rejects mixed Auth user/account contexts before sending',async()=>{
 const a=await app();await a.auth.login('1','valid');const c=a.auth.getClient();let calls=0;a.runtime.getCurrent().client.rpc=async()=>{calls++;return {data:[]};};
 const vault=createSkillVaultStorage(c),scope=c.accountContext.account;
 assert.equal((await vault.list(scope)).ok,true);
 assert.equal((await vault.list({...scope,authUserId:'other'})).ok,false);
 assert.equal((await vault.list({...scope,gameAccountId:'00000000-0000-4000-8000-000000000002'})).ok,false);assert.equal(calls,1);
});
test('late external selection invalidates reads and marks sent write result unknown',async()=>{
 for(const name of ['get_index_messages','set_index_message']){
  const a=await app();await a.auth.login('1','valid');const c=a.auth.getClient(),wait=deferred();a.runtime.getCurrent().client.rpc=()=>wait.promise;
  const pending=c.rpc(name,{p_eno:'1'});const r=JSON.parse(a.f.disk.get(SESSION_REGISTRY_KEY));r.active=null;a.f.disk.set(SESSION_REGISTRY_KEY,JSON.stringify(r));a.page.events.fire('storage',{key:SESSION_REGISTRY_KEY});
  wait.resolve({data:true});assert.ok((await pending).error);assert.equal(a.auth.getClient(),null);
 }
});
test('confirmed deletion clears only B, preserving A; receipt does not require post-delete authentication',async()=>{
 const a=await app();await a.auth.login('1','valid');await a.auth.login('2','valid');const target=a.runtime.getCurrent().account,raw=a.runtime.getCurrent().client;
 raw.rpc=async(name,args)=>{assert.equal(name,'delete_own_account');assert.equal(args.p_game_account_id,target.gameAccountId);a.f.sessions.delete(raw.key);return {data:{deleted:true,...target}};};
 const service=a.auth.createDeletionService();a.auth.beginAccountDeletion();assert.equal((await service.remove(target)).ok,true);
 assert.equal((await service.cleanup(target)).ok,true);a.auth.accountDeleted();
 assert.equal(a.auth.getClient(),null);assert.deepEqual(a.auth.snapshot().savedAccounts.map(e=>e.eno),['1']);assert.equal(a.f.sessions.size,1);
});
test('unknown deletion is not retried or reported as success',async()=>{
 const a=await app();await a.auth.login('1','valid');const target=a.runtime.getCurrent().account;let calls=0;a.runtime.getCurrent().client.rpc=async()=>{calls++;throw Error('offline');};
 const service=a.auth.createDeletionService();a.auth.beginAccountDeletion();assert.equal((await service.remove(target)).ok,false);assert.equal(calls,1);assert.equal(a.f.sessions.size,1);
});
test('registration uses the existing endpoint contract and independent account login',async()=>{
 const a=await app();const result=await a.auth.register({characterName:'name',password:'valid',confirmation:'valid'});
 assert.equal(result.signedIn,true);assert.equal(a.auth.snapshot().enos[0],'3');assert.equal(a.paths.at(-1),'index.html');
});
test('public/unselected mode returns no account client and exposes saved choices without credentials',async()=>{
 const a=await app();assert.equal(a.auth.getClient(),null);assert.equal(a.auth.snapshot().signedIn,false);
 await a.auth.login('1','valid');await a.auth.login('2','valid');await a.auth.logout();
 assert.equal(a.auth.getClient(),null);assert.doesNotMatch(JSON.stringify(a.auth.snapshot()),/valid|access_token|password/);
});
test('initial pageshow preserves verification; BFCache pageshow invalidates the captured client',async()=>{
 const a=await app();await a.auth.login('1','valid');const client=a.auth.getClient();
 a.page.events.fire('pageshow',{persisted:false});assert.equal((await client.auth.getSession()).error,undefined);
 a.page.events.fire('pageshow',{persisted:true});assert.ok((await client.auth.getSession()).error);assert.equal(a.auth.getClient(),null);
});
test('deletion cleanup storage failure remains pending and never signs out A',async()=>{
 const a=await app();await a.auth.login('1','valid');await a.auth.login('2','valid');
 const raw=a.runtime.getCurrent().client,target=a.runtime.getCurrent().account;
 raw.rpc=async()=>({data:{deleted:true,...target}});const service=a.auth.createDeletionService();
 a.auth.beginAccountDeletion();assert.equal((await service.remove(target)).ok,true);
 const set=a.f.disk.set;a.f.disk.set=()=>{throw Error('quota');};
 assert.equal((await service.cleanup(target)).ok,false);assert.equal(a.f.sessions.size,1);
 a.f.disk.set=set;assert.equal((await service.cleanup(target)).ok,true);assert.equal(a.f.sessions.size,1);
});
