import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthController } from '../js/authController.js';
import { consumeIndexNotice } from '../js/indexNotice.js';

const input={characterName:'登録名',password:'local-only-secret1',confirmation:'local-only-secret1'};
const session={user:{id:'auth-user'}};
async function fixture({registerResult={ok:true,eno:'00012'},loginResult={ok:true,session},throws=false,event=false}={}){
 let watch,state,registerCalls=0,loginCalls=0,accountCalls=0,finish;
 const states=[],notifications=[];
 const controller=createAuthController({session:async()=>null,watch(fn){watch=fn;return()=>{};},
  register:async()=>{registerCalls++;return registerResult;},
  login:async(eno,password)=>{loginCalls++;assert.equal(eno,'12');assert.equal(password===input.password,true);if(throws)throw Error('private SDK error');if(event)watch(session,'SIGNED_IN');if(finish)await new Promise(resolve=>finish.resolve=resolve);return loginResult;},
  accounts:async()=>{accountCalls++;return [{eno:'12',name:'登録名'}];},logout:async()=>{},
 },s=>{state=s;states.push(s);},message=>notifications.push(message));
 await controller.start();return {controller,states,notifications,state:()=>state,counts:()=>[registerCalls,loginCalls,accountCalls],pause(){finish={};return finish;}};
}
test('registration performs one automatic login with canonical ENo, awaits accounts, and never retains credentials',async t=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),writes=[];
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>null,setItem:(key,value)=>writes.push(value),removeItem(){}}});
 t.after(()=>{if(old)Object.defineProperty(globalThis,'sessionStorage',old);else delete globalThis.sessionStorage;});
 const f=await fixture({event:true});const result=await f.controller.register(input);
 assert.deepEqual(result,{ok:true,signedIn:true,eno:'12'});assert.deepEqual(f.counts(),[1,1,1]);
 assert.equal(f.state().accountsResolved,true);assert.deepEqual(f.state().enos,['12']);
 assert.equal(f.state().registeredEno,'');assert.equal(f.state().busy,'');
 assert.deepEqual(f.notifications,['新規登録しました。あなたはENo.12です。']);
 assert.equal(JSON.stringify([f.states,writes,result]).includes(input.password),false);
 assert.equal(JSON.stringify(f.states).includes('auth-user'),false);
});
test('busy registration rejects duplicate submit during automatic login; no retry',async()=>{
 const f=await fixture(),gate=f.pause(),pending=f.controller.register(input);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.state().busy,'register');
 await f.controller.register(input);assert.deepEqual(f.counts(),[1,1,0]);gate.resolve();await pending;
 assert.deepEqual(f.counts(),[1,1,1]);
});
for(const throws of [false,true])test('automatic login failure retains issued ENo and registration success: '+throws,async()=>{
 const f=await fixture({loginResult:{ok:false},throws});
 assert.deepEqual(await f.controller.register(input),{ok:true,signedIn:false,eno:'12'});
 assert.deepEqual(f.counts(),[1,1,0]);assert.equal(f.state().registeredEno,'12');
 assert.equal(f.state().message,'登録は完了しました。ENo.12でログインしてください。');
 assert.equal(f.state().signedIn,false);assert.deepEqual(f.notifications,[]);
});
test('failed registration never logs in, and standalone success may defer notification',async()=>{
 const fail=await fixture({registerResult:{ok:false,message:'既存登録エラー'}});
 assert.deepEqual(await fail.controller.register(input),{ok:false});assert.deepEqual(fail.counts(),[1,0,0]);assert.equal(fail.state().message,'既存登録エラー');
 const f=await fixture();await f.controller.register(input,{notify:false});assert.deepEqual(f.notifications,[]);assert.equal(f.state().signedIn,true);
});
for(const eno of ['00012','9223372036854775807','0','bad','9223372036854775808'])test('registered notice validates ENo and consumes once: '+eno,()=>{
 const location={href:'https://example.test/index.html?keep=yes&notice=registered&eno='+eno+'#tail'},messages=[],urls=[];
 const history={state:{keep:1},replaceState(state,title,url){assert.deepEqual(state,{keep:1});urls.push(url);location.href=new URL(url,location.href).href;}};
 consumeIndexNotice({location,history,toast:message=>messages.push(message)});consumeIndexNotice({location,history,toast:message=>messages.push(message)});
 assert.deepEqual(urls,['/index.html?keep=yes#tail']);
 assert.deepEqual(messages,eno==='00012'||eno==='9223372036854775807'?[{kind:'success',message:`新規登録しました。あなたはENo.${eno==='00012'?'12':eno}です。`}]:[]);
});
