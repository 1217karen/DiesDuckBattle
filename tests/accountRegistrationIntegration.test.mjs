import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './accountIntegrationFixture.mjs';
import {createAccountAuthController} from '../js/accountAuthController.js';
const input={characterName:'New',password:'valid',confirmation:'valid'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
async function setup(register=async()=>({ok:true,eno:'3'}),signedIn=true){
 const f=environment(),runtime=await f.page().get(),paths=[],notifications=[];let calls=0;
 const auth=createAccountAuthController({runtime,chooseLogout:async()=>'game',registrationService:{register:async value=>{calls++;return register(value);}},navigate:p=>paths.push(p),notify:m=>notifications.push(m)});
 await auth.start();
 if(signedIn){await auth.login('1','valid');await auth.login('2','valid');await auth.select('1');}
 paths.length=0;notifications.length=0;
 return {f,runtime,auth,paths,notifications,calls:()=>calls};
}
test('signed-in registration is refused before API and preserves both A/B sessions and selection',async()=>{
 const s=await setup(),before=new Map(s.f.sessions),entries=s.auth.snapshot().savedAccounts;
 assert.equal((await s.auth.register(input)).code,'already-added');assert.equal(s.calls(),0);
 assert.equal(s.auth.snapshot().enos[0],'1');assert.deepEqual(s.f.sessions,before);assert.deepEqual(s.auth.snapshot().savedAccounts,entries);
 assert.deepEqual(s.paths,[]);assert.deepEqual(s.notifications,[]);assert.ok(s.f.clients.every(c=>c.signouts.length===0));
 assert.equal((await s.auth.select('2')).ok,true);assert.equal((await s.auth.select('1')).ok,true);
});
test('signed-in registration remains refused with an unsaved guard; normal account-change guard remains',async()=>{
 const s=await setup();s.auth.beforeLogout(()=>false);
 assert.equal((await s.auth.register(input)).code,'already-added');assert.equal(s.calls(),0);
 assert.equal((await s.auth.select('2')).code,'cancelled');assert.equal(s.auth.snapshot().enos[0],'1');
});
test('write in flight still blocks switching and registration never reaches API while signed in',async()=>{
 const s=await setup(),gate=deferred();const writing=s.auth.coordinator.write(()=>gate.promise);
 assert.equal((await s.auth.register(input)).code,'already-added');assert.equal(s.calls(),0);
 assert.equal((await s.auth.select('2')).code,'operation-in-progress');gate.resolve();await writing;
});
test('ordinary guest registration uses the issued ENo and signs in successfully',async()=>{
 const s=await setup(undefined,false);
 assert.deepEqual(await s.auth.register(input),{ok:true,signedIn:true,eno:'3'});
 assert.equal(s.auth.snapshot().enos[0],'3');assert.equal(s.f.sessions.size,1);assert.equal(s.calls(),1);
 assert.deepEqual(s.paths,['index.html']);assert.equal(s.notifications.length,1);
});
test('unselected registration keeps other saved ENo without logging it out',async()=>{
 const s=await setup();await s.auth.logout();const before=new Map(s.f.sessions);s.paths.length=0;
 assert.equal(s.auth.snapshot().signedIn,false);assert.deepEqual(s.auth.snapshot().savedAccounts,[]);assert.deepEqual(s.runtime.snapshot().entries.map(e=>e.eno),['1','2']);
 assert.equal((await s.auth.register(input)).signedIn,true);assert.equal(s.auth.snapshot().enos[0],'3');
 for(const [key,user] of before)assert.deepEqual(s.f.sessions.get(key),user);
 assert.deepEqual(s.auth.snapshot().savedAccounts.map(e=>e.eno),['1','2','3']);
 assert.equal((await s.auth.select('2')).ok,true);
});
test('guest duplicate submit during pending registration is rejected without retry',async()=>{
 const gate=deferred(),s=await setup(()=>gate.promise,false),pending=s.auth.register(input);
 assert.equal((await s.auth.register(input)).code,'operation-in-progress');assert.equal(s.calls(),1);
 gate.resolve({ok:true,eno:'3'});assert.equal((await pending).signedIn,true);assert.equal(s.calls(),1);
});
test('successful registration with failed login retains issued ENo and previously saved sessions',async()=>{
 let issued=2;const s=await setup(async()=>({ok:true,eno:String(++issued)}));await s.auth.logout();const before=new Map(s.f.sessions);s.paths.length=0;s.notifications.length=0;
 assert.deepEqual(await s.auth.register({...input,password:'bad'}),{ok:true,signedIn:false,eno:'3'});
 assert.equal(s.auth.snapshot().registeredEno,'3');assert.match(s.auth.snapshot().message,/登録は完了.*ENo.3/);
 assert.equal(s.auth.snapshot().signedIn,false);assert.deepEqual(s.f.sessions,before);assert.deepEqual(s.paths,[]);assert.deepEqual(s.notifications,[]);assert.equal(s.calls(),1);
 for(let i=0;i<2;i++){
  assert.equal((await s.auth.register(input)).code,'already-registered');assert.equal(s.calls(),1);
  assert.equal(s.auth.snapshot().registeredEno,'3');assert.match(s.auth.snapshot().message,/登録済み.*ENo.3.*やり直す必要はありません/);
  assert.deepEqual(s.f.sessions,before);assert.deepEqual(s.paths,[]);assert.deepEqual(s.notifications,[]);
 }
 assert.equal((await s.auth.login('3','bad')).ok,false);assert.equal(s.auth.snapshot().registeredEno,'3');
 assert.equal((await s.auth.register(input)).code,'already-registered');assert.equal(s.calls(),1);
 assert.equal((await s.auth.login('3','valid')).ok,true);assert.equal(s.f.sessions.size,3);assert.equal(s.auth.snapshot().registeredEno,'');
});
for(const kind of ['failed','unknown','throw'])test('unselected registration '+kind+' preserves saved B without auto-retry',async()=>{
 const s=await setup(async()=>{if(kind==='throw')throw Error();return {ok:false,message:kind==='unknown'?'結果不明。自動再送しません':'登録できません'};});
 await s.auth.logout();s.paths.length=0;s.notifications.length=0;const before=new Map(s.f.sessions);
 assert.equal((await s.auth.register(input)).ok,false);assert.equal(s.calls(),1);assert.equal(s.auth.snapshot().signedIn,false);assert.deepEqual(s.f.sessions,before);assert.deepEqual(s.paths,[]);assert.deepEqual(s.notifications,[]);
});
test('registration-specific coordinator entry is removed; existing account addition still works',async()=>{
 const s=await setup();assert.equal(s.auth.coordinator.register,undefined);
 assert.equal((await s.auth.login('4','valid')).ok,true);assert.equal(s.f.sessions.size,3);assert.equal((await s.auth.select('1')).ok,true);
});

test('explicit registration failure without issued ENo permits a later user retry',async()=>{
 let succeed=false;const s=await setup(async()=>succeed?{ok:true,eno:'3'}:{ok:false,message:'登録できませんでした。'},false);
 assert.equal((await s.auth.register(input)).ok,false);assert.equal(s.auth.snapshot().registeredEno,'');assert.equal(s.calls(),1);
 succeed=true;assert.equal((await s.auth.register(input)).signedIn,true);assert.equal(s.calls(),2);
});
