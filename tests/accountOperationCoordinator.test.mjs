import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountOperationCoordinator} from '../js/accountOperationCoordinator.js';
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup() {
 const calls=[];let version=0,current;
 function choose(eno){const revision=++version;current=eno?{client:{name:'client-'+eno},account:{eno,gameAccountId:'game-'+eno,authUserId:'user-'+eno},isCurrent:()=>revision===version}:null;}
 choose('A');
 const runtime={getCurrent:()=>current,async select(eno){calls.push(['select',eno]);choose(eno);return {ok:true};},async add(eno,password){calls.push(['add',eno]);if(password==='bad')return {ok:false,code:'login-failed'};choose(eno);return {ok:true};},async logoutCurrent(){calls.push(['logout']);choose(null);return {ok:true};}};
 return {gate:createAccountOperationCoordinator(runtime),runtime,calls,choose};
}
test('all operations receive the same verified client/ENo/game account/auth user pair',async()=>{
 const s=setup();const a=await s.gate.read(scope=>{assert.equal(scope.client.name,'client-A');assert.deepEqual(scope.account,{eno:'A',gameAccountId:'game-A',authUserId:'user-A'});assert.ok(Object.isFrozen(scope.account));return 'A-data';});assert.equal(a.value,'A-data');
 await s.gate.select('B');assert.equal((await s.gate.write(scope=>({target:scope.account.gameAccountId,client:scope.client.name}))).value.target,'game-B');
 await s.gate.logoutCurrent();let sent=false;assert.equal((await s.gate.write(()=>{sent=true;})).code,'account-unverified');assert.equal(sent,false);
});
test('write in progress blocks add, select and logout, without changing its captured target',async()=>{
 const s=setup(),wait=defer();let captured;
 const writing=s.gate.write(async scope=>{captured=scope;await wait.promise;return true;});
 for(const result of [await s.gate.add('B','password'),await s.gate.select('B'),await s.gate.logoutCurrent()])assert.equal(result.code,'operation-in-progress');
 assert.deepEqual(s.calls,[]);assert.equal(captured.account.gameAccountId,'game-A');wait.resolve();assert.equal((await writing).ok,true);assert.equal(s.gate.snapshot().writes,0);
});
test('unsaved cancellation never invokes any authentication mutation',async()=>{
 for(const action of ['add','select','logoutCurrent']){
  const s=setup();let asked;const stop=s.gate.beforeAccountChange(({action})=>{asked=action;return false;});
  assert.equal((await s.gate[action]('B','password')).code,'cancelled');assert.equal(asked,action);assert.deepEqual(s.calls,[]);assert.equal(s.runtime.getCurrent().account.eno,'A');stop();
  assert.equal((await s.gate[action]('B','password')).ok,true);
 }
});
test('writes and duplicate transitions are blocked while unsaved confirmation is pending',async()=>{
 const s=setup(),wait=defer();s.gate.beforeAccountChange(()=>wait.promise);const change=s.gate.select('B');
 assert.equal((await s.gate.write(()=>assert.fail('must not send'))).code,'account-change-in-progress');assert.equal((await s.gate.logoutCurrent()).code,'operation-in-progress');wait.resolve(true);assert.equal((await change).ok,true);
});
test('account changes from another tab during confirmation cancel the old intent',async()=>{
 const s=setup(),wait=defer();s.gate.beforeAccountChange(()=>wait.promise);const change=s.gate.select('B');s.choose('C');wait.resolve(true);assert.equal((await change).code,'stale-operation');assert.deepEqual(s.calls,[]);
});
test('late read results are discarded; already sent writes return unknown rather than success',async()=>{
 for(const kind of ['read','write']){
  const s=setup(),wait=defer();let target;const operation=s.gate[kind](async scope=>{target=scope.account.gameAccountId;await wait.promise;return 'old-result';});s.choose('B');wait.resolve();assert.equal((await operation).code,kind==='write'?'write-unknown':'stale-operation');assert.equal(target,'game-A');
 }
});
test('failed addition preserves current account; no credentials are included in snapshots',async()=>{
 const s=setup();assert.equal((await s.gate.add('B','bad')).code,'login-failed');assert.equal(s.runtime.getCurrent().account.eno,'A');assert.deepEqual(s.gate.snapshot(),{changing:false,writes:0,closed:false});assert.doesNotMatch(JSON.stringify(s.calls),/bad/);
});
test('exceptions release write lock; closing coordinator prevents pending results from succeeding',async()=>{
 const s=setup();assert.equal((await s.gate.write(()=>{throw Error('network');})).code,'write-unknown');assert.equal(s.gate.snapshot().writes,0);
 const wait=defer(),reading=s.gate.read(()=>wait.promise);s.gate.dispose();wait.resolve('late');assert.equal((await reading).code,'stale-operation');assert.equal((await s.gate.select('B')).code,'closed');
});
