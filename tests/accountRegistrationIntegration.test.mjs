import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './accountIntegrationFixture.mjs';
import {createAccountAuthController} from '../js/accountAuthController.js';
const input={characterName:'New',password:'valid',confirmation:'valid'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
async function setup(register=async()=>({ok:true,eno:'3'})){
 const f=environment(),runtime=await f.page().get(),paths=[],notifications=[];let calls=0;
 const auth=createAccountAuthController({runtime,registrationService:{register:async value=>{calls++;return register(value);}},navigate:p=>paths.push(p),notify:m=>notifications.push(m)});
 await auth.start();await auth.login('1','valid');await auth.login('2','valid');await auth.select('1');paths.length=0;notifications.length=0;
 return {f,runtime,auth,paths,notifications,calls:()=>calls};
}
test('register C while A selected preserves A/B sessions, selects C and returns to A without password',async()=>{
 const s=await setup(),before=new Map(s.f.sessions);
 const result=await s.auth.register(input);assert.deepEqual(result,{ok:true,signedIn:true,eno:'3'});
 assert.equal(s.auth.snapshot().enos[0],'3');assert.equal(s.f.sessions.size,3);
 for(const [key,user] of before)assert.deepEqual(s.f.sessions.get(key),user);
 assert.equal(new Set(s.f.clients.map(c=>c.key)).size,s.f.clients.length);
 assert.deepEqual(s.paths,['index.html']);assert.equal(s.calls(),1);assert.equal(s.notifications.length,1);
 assert.equal((await s.auth.select('1')).ok,true);assert.equal(s.auth.snapshot().enos[0],'1');assert.ok(s.f.clients.every(c=>c.signouts.length===0));
});
test('cancelled unsaved guard sends no registration and preserves current A',async()=>{
 const s=await setup();s.auth.beforeLogout(()=>false);
 assert.equal((await s.auth.register(input)).code,'cancelled');assert.equal(s.calls(),0);assert.equal(s.auth.snapshot().enos[0],'1');assert.equal(s.f.sessions.size,2);assert.deepEqual(s.paths,[]);
});
test('write in flight blocks registration before API',async()=>{
 const s=await setup(),gate=deferred();const writing=s.auth.coordinator.write(()=>gate.promise);
 assert.equal((await s.auth.register(input)).code,'operation-in-progress');assert.equal(s.calls(),0);gate.resolve();await writing;
});
test('registration and login are one exclusive operation; duplicate submit and writes are refused',async()=>{
 const gate=deferred(),s=await setup(()=>gate.promise);const pending=s.auth.register(input);
 await new Promise(r=>setImmediate(r));assert.equal(s.calls(),1);
 assert.equal((await s.auth.register(input)).code,'operation-in-progress');
 for(const work of [()=>s.auth.select('2'),()=>s.auth.logout(),()=>s.auth.login('2','valid'),()=>s.auth.coordinator.add('4','valid'),()=>s.auth.coordinator.write(()=>assert.fail('write'))])assert.equal((await work()).ok,false);
 gate.resolve({ok:true,eno:'3'});assert.equal((await pending).signedIn,true);assert.equal(s.calls(),1);
});
test('registration success with login failure displays issued ENo and keeps A/B without second registration',async()=>{
 const s=await setup(),before=new Map(s.f.sessions);
 assert.deepEqual(await s.auth.register({...input,password:'bad'}),{ok:true,signedIn:false,eno:'3'});
 assert.equal(s.auth.snapshot().registeredEno,'3');assert.match(s.auth.snapshot().message,/登録は完了.*追加ログインは未完了/);
 assert.equal(s.auth.snapshot().enos[0],'1');assert.deepEqual(s.f.sessions,before);assert.deepEqual(s.paths,[]);assert.deepEqual(s.notifications,[]);
 await s.auth.register(input);assert.equal(s.calls(),1);
 assert.equal((await s.auth.login('3','valid')).ok,true);assert.equal(s.auth.snapshot().registeredEno,'');assert.equal(s.f.sessions.size,3);
});
for(const kind of ['failed','unknown','throw'])test('registration '+kind+' keeps A and never auto-retries',async()=>{
 const s=await setup(async()=>{if(kind==='throw')throw Error();return {ok:false,message:kind==='unknown'?'結果不明。自動再送しません':'登録できません'};});
 assert.equal((await s.auth.register(input)).ok,false);assert.equal(s.calls(),1);assert.equal(s.auth.snapshot().enos[0],'1');assert.equal(s.f.sessions.size,2);assert.deepEqual(s.paths,[]);assert.deepEqual(s.notifications,[]);
});
test('auth page owns registration redirect when disabled on controller',async()=>{
 const s=await setup();assert.equal((await s.auth.register(input,{notify:false,redirect:false})).signedIn,true);assert.deepEqual(s.paths,[]);assert.deepEqual(s.notifications,[]);
});
test('external invalidation after API send preserves issued ENo but does not select over changed session',async()=>{
 const gate=deferred(),s=await setup(()=>gate.promise);const pending=s.auth.register(input);await new Promise(r=>setImmediate(r));s.runtime.invalidate();gate.resolve({ok:true,eno:'3'});
 const result=await pending;assert.equal(result.signedIn,false);assert.equal(result.eno,'3');assert.equal(s.f.sessions.size,2);assert.equal(s.calls(),1);assert.deepEqual(s.paths,[]);
});
test('registration barrier remains held while the new session is being verified',async()=>{
 const s=await setup(),gate=deferred(),push=s.f.clients.push.bind(s.f.clients);
 s.f.clients.push=c=>{c.wait=gate.promise;return push(c);};
 const pending=s.auth.register(input);await new Promise(r=>setImmediate(r));
 assert.equal(s.auth.coordinator.snapshot().changing,true);
 assert.equal((await s.auth.coordinator.select('2')).code,'operation-in-progress');
 assert.equal((await s.auth.coordinator.write(()=>assert.fail('write'))).code,'account-change-in-progress');
 assert.equal((await s.auth.register(input)).code,'operation-in-progress');assert.equal(s.calls(),1);
 gate.resolve();assert.equal((await pending).signedIn,true);assert.equal(s.auth.coordinator.snapshot().changing,false);
});
