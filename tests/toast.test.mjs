import test from "node:test";
import assert from "node:assert/strict";
import { createToastStore } from "../js/toastStore.js";
import { createAuthController } from "../js/authController.js";
function setup(){let current;const timers=[];const cancelled=[];const store=createToastStore({render:v=>{current=v;},setTimer:fn=>{timers.push(fn);return timers.length-1;},clearTimer:id=>cancelled.push(id)});return{store,timers,cancelled,current:()=>current};}
test("success expires, duplicate is coalesced, obsolete timers cannot dismiss newer notice",()=>{
 const f=setup();f.store.show({kind:"success",message:"saved"});f.store.show({kind:"success",message:"saved"});assert.equal(f.timers.length,1);
 f.store.show({kind:"success",message:"logged out"});f.timers[0]();assert.equal(f.current().message,"logged out");f.timers[1]();assert.equal(f.current(),null);
});
test("actionable error does not expire or get replaced by success, dismissal releases only latest success",()=>{
 const f=setup();f.store.show({kind:"error",message:"conflict"});assert.equal(f.timers.length,0);
 f.store.show({kind:"success",message:"old"});f.store.show({kind:"success",message:"new"});assert.equal(f.current().message,"conflict");
 f.store.dismiss();assert.equal(f.current().message,"new");f.store.destroy();f.timers[0]();assert.equal(f.current(),null);
});
test("auth success is an event once, not persistent menu text; restore emits no success; failure remains in form",async()=>{
 const notices=[];let state,ok=false;const session={user:{id:"auth"}};
 const controller=createAuthController({watch:()=>()=>{},session:async()=>null,accounts:async()=>[{eno:"77",name:"DB"}],
 login:async()=>ok?{ok:true,session}:{ok:false,message:"入力を確認"},logout:async()=>{}},s=>{state=s;},m=>notices.push(m));
 await controller.start();assert.deepEqual(notices,[]);await controller.login("77","bad");assert.equal(state.message,"入力を確認");assert.deepEqual(notices,[]);
 ok=true;await controller.login("77","good");assert.equal(state.message,"");assert.deepEqual(notices,["ログインしました。"]);
 await controller.logout();assert.equal(state.message,"");assert.deepEqual(notices,["ログインしました。","ログアウトしました。"]);
});

test("focused/hovered toast pauses expiry and resumes for a full reading interval",()=>{
 const f=setup();f.store.show({kind:"success",message:"saved"});f.store.pause();f.timers[0]();assert.equal(f.current().message,"saved");
 f.store.resume();f.timers[1]();assert.equal(f.current(),null);
});
