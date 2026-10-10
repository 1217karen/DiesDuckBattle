import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperatorLoginService} from '../js/operatorLoginService.js';
import {readFile} from 'node:fs/promises';
function fixture(moderator=true){
 let session=null,callback,delay;const calls=[];
 const client={auth:{onAuthStateChange(fn){callback=fn;return {data:{subscription:{unsubscribe(){}}}};},async signInWithPassword(input){calls.push(input);session={user:{id:'operator'},access_token:'token'};callback('SIGNED_IN');return {data:{session}};},async getSession(){return {data:{session}};},async signOut(args){calls.push(args);session=null;callback('SIGNED_OUT');return {error:null};}},async rpc(name,args){calls.push([name,args]);if(delay)await delay;return {data:{threads:[],canPost:false,isModerator:moderator}};}};
 return {client,calls,service:createOperatorLoginService(client),get session(){return session;},switch(){session={user:{id:'other'},access_token:'other'};callback('SIGNED_IN');},delay(p){delay=p;}};
}
test('operator login uses email/password then DB moderator check; local logout clears session',async()=>{
 const f=fixture();assert.equal((await f.service.login(' operator@example.test ','password')).ok,true);
 assert.deepEqual(f.calls[0],{email:'operator@example.test',password:'password'});assert.deepEqual(f.calls[1],['list_feedback_threads',{p_eno:null}]);
 assert.equal((await f.service.logout()).ok,true);assert.equal(f.session,null);assert.deepEqual(f.calls.at(-1),{scope:'local'});
});
test('nonmoderator or failed authorization never succeeds and removes session',async()=>{
 for(const failure of ['nonmoderator','rpc','invalid']){
  const f=fixture(false);if(failure==='rpc')f.client.rpc=async()=>({error:{}});if(failure==='invalid')f.client.rpc=async()=>({data:{isModerator:true}});
  const result=await f.service.login('person@example.test','password');assert.equal(result.ok,false);assert.equal(result.message,'運営権限を確認できません。');assert.equal(f.session,null);
 }
});
test('session change while checking operator permission rejects old response',async()=>{
 const f=fixture();let resolve;f.delay(new Promise(r=>resolve=r));const result=f.service.login('operator@example.test','password');
 await new Promise(r=>setImmediate(r));f.switch();resolve();assert.equal((await result).ok,false);assert.equal(f.session,null);
});
test('operator login is unlinked, has no signup, and routes only verified success',async()=>{
 const html=await readFile(new URL('../operator-login.html',import.meta.url),'utf8');assert.match(html,/type="email"/);assert.match(html,/type="password"/);assert.doesNotMatch(html,/signUp|新規登録|アカウントを作成/);
 for(const file of ['index.html','js/commonMenuModel.js'])assert.ok(!(await readFile(new URL('../'+file,import.meta.url),'utf8')).includes('operator-login'));
 const page=await readFile(new URL('../js/operatorLoginPage.js',import.meta.url),'utf8');assert.match(page,/if\(result.ok\)\{location.replace\('notice.html\?tab=reports'\)/);
});
