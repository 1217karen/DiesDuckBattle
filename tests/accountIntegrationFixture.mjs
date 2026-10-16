import assert from 'node:assert/strict';
import {createAccountRuntimeProvider} from '../js/accountRuntime.js';
import {SESSION_REGISTRY_KEY,LEGACY_SESSION_KEY} from '../js/accountSessionManager.js';
export function environment(){
 const disk=new Map(),sessions=new Map(),clients=[],offlineKeys=new Set(),userWaits=new Map();let seq=0,tail=Promise.resolve(),sdkLoads=0,legacyCalls=0;
 const storage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)};
 const locks={request(name,options,fn){assert.equal(name,SESSION_REGISTRY_KEY);const result=tail.then(fn);tail=result.catch(()=>{});return result;}};
 function bus(){const handlers=new Map();return {visibilityState:'visible',addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(fn);},removeEventListener(name,fn){handlers.get(name)?.delete(fn);},fire(name,event={}){for(const fn of handlers.get(name)??[])fn(event);}};}
 function client(key){
  const callbacks=new Set();const c={key,signouts:[],auth:{
   onAuthStateChange(fn){callbacks.add(fn);return {data:{subscription:{unsubscribe:()=>callbacks.delete(fn)}}};},
   async signInWithPassword({email,password}){if(password!=='valid')return {error:{}};sessions.set(key,{id:'auth-'+email,email});return {data:{session:{user:sessions.get(key)}}};},
   async getUser(){if(userWaits.has(key))await userWaits.get(key);if(c.wait)await c.wait;if(c.offline||offlineKeys.has(key))throw Error('offline');return {data:{user:sessions.get(key)??null}};},
   async getSession(){return {data:{session:sessions.has(key)?{user:sessions.get(key)}:null}};},
   async signOut(options){c.signouts.push(options);sessions.delete(key);c.event('SIGNED_OUT',null);return {error:null};},stopAutoRefresh(){c.stopped=true;}
  },event(event,session){for(const fn of callbacks)fn(event,session);},from(table){assert.equal(table,'game_account_access');return {select(){return {async eq(field,id){assert.equal(field,'auth_user_id');assert.equal(id,sessions.get(key)?.id);const eno=sessions.get(key)?.email.match(/eno-(\d+)@/)[1];return {data:c.rows??[{game_account_id:'00000000-0000-4000-8000-'+eno.padStart(12,'0'),game_accounts:{eno,battlers:{presentation:{name:'Name'+eno}}}}]};}};}};}};
  clients.push(c);return c;
 }
 let legacy;
 function page(){const events=bus(),document=bus();const get=createAccountRuntimeProvider({
  loadSDK:async()=>{sdkLoads++;return {createClient:(url,key,options)=>{assert.equal(options.auth.persistSession,true);assert.equal(options.auth.autoRefreshToken,true);assert.equal(options.auth.detectSessionInUrl,false);return client(options.auth.storageKey);}};},
  getLegacyClient:()=>{legacyCalls++;return legacy??=client(LEGACY_SESSION_KEY);},config:{url:'https://example.invalid',publishableKey:'public'},
  managerOptions:{storage:()=>storage,locks,events,document,randomUUID:()=>`00000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`},
 });return {get,events,document};}
 return {page,clients,disk,sessions,client,offlineKeys,userWaits,legacy:()=>legacy??=client(LEGACY_SESSION_KEY),sdkLoads:()=>sdkLoads,legacyCalls:()=>legacyCalls};
}