import test from 'node:test';
import assert from 'node:assert/strict';
import {requireLoginPage} from '../js/authPageGuard.js';
import {environment} from './accountIntegrationFixture.mjs';
import {createAccountAuthController} from '../js/accountAuthController.js';
import {SESSION_REGISTRY_KEY,LEGACY_SESSION_KEY} from '../js/accountSessionManager.js';
import {internalEmailForEno} from '../supabase/functions/_shared/internal-email.mjs';
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
async function setup(f=environment(),chooseLogout=async()=> 'game'){
 const page=f.page(),runtime=await page.get(),paths=[];
 const auth=createAccountAuthController({runtime,chooseLogout,navigate:p=>paths.push(p),registrationService:{register:async()=>({ok:true,eno:'3'})}});
 await auth.start();return {f,page,runtime,auth,paths};
}
async function pair(choose){const s=await setup(undefined,choose);await s.auth.login('1','valid');await s.auth.login('2','valid');await s.auth.select('1');s.paths.length=0;return s;}
test('game logout keeps A/B tokens, denies saved selection, client, reads and writes, and survives restart',async()=>{
 const s=await pair(),before=new Map(s.f.sessions),client=s.auth.getClient();
 assert.equal((await s.auth.logout()).ok,true);assert.deepEqual(s.f.sessions,before);
 assert.ok(s.f.clients.every(c=>c.signouts.length===0));assert.equal(JSON.parse(s.f.disk.get(SESSION_REGISTRY_KEY)).active,null);
 assert.equal(s.runtime.getCurrent(),null);assert.equal(s.auth.getClient(),null);assert.deepEqual(s.auth.snapshot().savedAccounts,[]);assert.deepEqual(s.paths,['index.html']);
 assert.equal((await s.auth.select('2')).code,'login-required');assert.equal((await s.runtime.select('1')).code,'login-required');
 assert.equal((await s.auth.coordinator.read(()=>assert.fail())).code,'account-unverified');assert.equal((await s.auth.coordinator.write(()=>assert.fail())).code,'account-unverified');assert.equal(client.accountContext.isCurrent(),false);
 s.auth.stop();const next=await setup(s.f);assert.equal(next.auth.getClient(),null);assert.deepEqual(next.runtime.snapshot().entries.map(e=>e.eno),['1','2']);
 assert.equal((await next.runtime.adoptLegacy()).code,'login-required');assert.deepEqual(s.f.sessions,before);
});
for(const eno of ['1','2'])test('guest actually checks password for healthy saved ENo '+eno+' and preserves other session',async()=>{
 const s=await pair();await s.auth.logout();const before=new Map(s.f.sessions);let calls=0;
 for(const c of s.f.clients){const original=c.auth.signInWithPassword;c.auth.signInWithPassword=async input=>{calls++;return original(input);};}
 assert.equal((await s.auth.login(eno,'wrong')).code,'login-failed');assert.equal(calls,1);assert.equal(s.auth.getClient(),null);assert.deepEqual(s.f.sessions,before);
 assert.equal((await s.auth.login(eno,'valid')).ok,true);assert.equal(calls,2);assert.equal(s.auth.snapshot().enos[0],eno);assert.deepEqual(s.f.sessions,before);
 assert.equal((await s.auth.select(eno==='1'?'2':'1')).ok,true);assert.equal(calls,2);
});
test('unlink clears only active A through SDK local signout; retained B does not auto-login',async()=>{
 const s=await pair(async()=> 'unlink'),a=s.runtime.getCurrent().client;assert.equal((await s.auth.logout()).ok,true);
 assert.deepEqual(a.signouts,[{scope:'local'}]);assert.equal(s.f.sessions.has(a.key),false);assert.equal(s.f.sessions.size,1);
 assert.deepEqual(s.runtime.snapshot().entries.map(e=>e.eno),['2']);assert.equal(s.auth.getClient(),null);assert.equal((await s.auth.select('2')).code,'login-required');
 const next=await setup(s.f);assert.equal(next.auth.getClient(),null);assert.equal((await next.auth.login('2','valid')).ok,true);
});
test('another tab loses pinned access immediately and storage/BFCache cannot restore guest credentials',async()=>{
 const s=await pair(),other=await setup(s.f),stale=other.auth.getClient();await s.auth.logout();
 assert.equal(other.auth.getClient(),null);assert.ok(!stale.accountContext.isCurrent());
 other.page.events.fire('storage',{key:SESSION_REGISTRY_KEY});assert.equal(other.auth.snapshot().signedIn,false);
 other.page.events.fire('pageshow',{persisted:true});await other.runtime.restore();assert.equal(other.auth.getClient(),null);
 assert.equal((await other.auth.select('1')).code,'login-required');
});
for(const choice of ['game','unlink'])test(choice+' respects unsaved cancellation and ongoing saves',async()=>{
 const s=await pair(async()=>choice),before=new Map(s.f.sessions),remove=s.auth.beforeLogout(()=>false);
 assert.equal((await s.auth.logout()).code,'cancelled');assert.equal(s.auth.snapshot().enos[0],'1');assert.deepEqual(s.f.sessions,before);remove();
 const g=gate(),writing=s.auth.coordinator.write(()=>g.promise);assert.equal((await s.auth.logout()).code,'operation-in-progress');g.resolve();await writing;
 assert.equal(s.auth.snapshot().enos[0],'1');assert.deepEqual(s.f.sessions,before);
});
test('cancelled chooser, duplicate click, and selection in another tab never log out the wrong account',async()=>{
 const g=gate(),s=await pair(()=>g.promise),before=new Map(s.f.sessions),pending=s.auth.logout();
 assert.equal((await s.auth.logout()).code,'operation-in-progress');g.resolve(null);assert.equal((await pending).code,'cancelled');assert.deepEqual(s.f.sessions,before);assert.equal(s.auth.snapshot().enos[0],'1');
 const h=gate(),a=await setup(s.f,()=>h.promise),waiting=a.auth.logout(),b=await setup(s.f);await b.auth.select('2');h.resolve('unlink');
 assert.equal((await waiting).code,'stale-operation');assert.deepEqual(s.f.sessions,before);assert.equal(b.auth.snapshot().enos[0],'2');
});
test('legacy game logout retains original token and never adopts it again on reload',async()=>{
 const f=environment();f.sessions.set(LEGACY_SESSION_KEY,{id:'legacy-user',email:internalEmailForEno('7')});const s=await setup(f);assert.equal(s.auth.snapshot().enos[0],'7');
 await s.auth.logout();assert.ok(f.sessions.has(LEGACY_SESSION_KEY));const b=await setup(f);assert.equal(b.auth.getClient(),null);assert.equal((await b.runtime.adoptLegacy()).code,'login-required');
 assert.equal((await b.auth.login('7','wrong')).ok,false);assert.equal((await b.auth.login('7','valid')).ok,true);
});

test('guest with saved sessions cannot pass private-page guard; cross-tab logout ejects an admitted page',async()=>{
 const s=await pair(),redirects=[],classes=new Set(),options={getRuntime:async()=>s.auth,document:{body:{classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}}},location:{replace:p=>redirects.push(p)}};
 await requireLoginPage(options);assert.deepEqual(redirects,[]);
 const other=await setup(s.f);await other.auth.logout();s.page.events.fire('storage',{key:SESSION_REGISTRY_KEY});await new Promise(r=>setImmediate(r));
 assert.equal(redirects.length,1);assert.ok(classes.has('auth-required-pending'));
 await assert.rejects(requireLoginPage(options),/Login required/);assert.equal(redirects.at(-1),'index.html?notice=login-required');
});
test('failed game-logout persistence does not erase tokens or report success',async()=>{
 const s=await pair(),before=new Map(s.f.sessions),raw=s.f.disk.get(SESSION_REGISTRY_KEY),original=s.f.disk.set.bind(s.f.disk);
 s.f.disk.set=(key,value)=>{if(key===SESSION_REGISTRY_KEY)throw Error('disk full');return original(key,value);};
 assert.equal((await s.auth.logout()).ok,false);assert.deepEqual(s.f.sessions,before);assert.equal(s.f.disk.get(SESSION_REGISTRY_KEY),raw);assert.deepEqual(s.paths,[]);
});
test('guest password success still requires ENo/Auth access mapping before admitting the account',async()=>{
 const s=await pair(),client=s.runtime.getCurrent().client;await s.auth.logout();const before=new Map(s.f.sessions);
 client.rows=[{game_account_id:'00000000-0000-4000-8000-000000000009',game_accounts:{eno:'9'}}];
 assert.equal((await s.auth.login('1','valid')).code,'eno-mismatch');assert.equal(s.auth.getClient(),null);assert.deepEqual(s.f.sessions,before);assert.equal((await s.auth.select('2')).code,'login-required');
});
