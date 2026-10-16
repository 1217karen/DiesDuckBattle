export const runtimeSource=`
import {createAccountRuntimeProvider} from '/js/accountRuntime.js';
import {createAccountAuthController} from '/js/accountAuthController.js';
import {createAuthService} from '/js/authService.js';
import {internalEmailForEno} from '/supabase/functions/_shared/internal-email.mjs';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const read=key=>JSON.parse(localStorage.getItem('mock-'+key)||'null');
function client(key){
 const listeners=new Set();const current=()=>read(key);
 return {auth:{onAuthStateChange(fn){listeners.add(fn);return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};},
 async getSession(){return {data:{session:current()?{user:current()}:null}};},
 async getUser(){return {data:{user:current()}};},
 async signInWithPassword({email,password}){await new Promise(r=>setTimeout(r,60));if(!['valid','valid123'].includes(password))return {error:{}};const eno=email.match(/eno-(\\d+)@/)[1];const user={id:uuid(eno),email};localStorage.setItem('mock-'+key,JSON.stringify(user));return {data:{session:{user}}};},
 async signOut(){localStorage.removeItem('mock-'+key);for(const fn of listeners)fn('SIGNED_OUT',null);return {};},stopAutoRefresh(){}},
 from(){return {select(){return {async eq(){const user=current(),eno=user.email.match(/eno-(\\d+)@/)[1];return {data:[{game_account_id:uuid(100+Number(eno)),game_accounts:{eno,battlers:{presentation:{name:'バトラー'+eno}}}}]};}};}};},
 async rpc(name,args){window.rpcCalls.push({name,args});if(name==='prepare_account_deletion')return {data:{eno:args.p_eno,name:'バトラー'+args.p_eno,gameAccountId:uuid(100+Number(args.p_eno)),authUserId:uuid(args.p_eno)}};
 if(name==='delete_own_account'){localStorage.setItem('mock-delete-count',String(Number(localStorage.getItem('mock-delete-count')||0)+1));localStorage.removeItem('mock-'+key);return {data:{deleted:true,eno:args.p_eno,gameAccountId:args.p_game_account_id,authUserId:args.p_auth_user_id}};}
 return {data:{owner:current()?.id}};}
 };
}
window.rpcCalls=[];
let legacy;const get=createAccountRuntimeProvider({loadSDK:async()=>({createClient:(_u,_k,o)=>client(o.auth.storageKey)}),getLegacyClient:()=>legacy??=client('diesduck-auth-session'),config:{url:'https://example.invalid',publishableKey:'mock'},managerOptions:{suspendOnHidden:false}});
const runtime=await get();
const auth=createAccountAuthController({runtime,registrationService:createAuthService({config:{url:'https://example.invalid',publishableKey:'mock'},fetchImpl:async()=>{localStorage.setItem('mock-registration-count',String(Number(localStorage.getItem('mock-registration-count')||0)+1));return {status:201,ok:true,json:async()=>({ok:true,eno:'3'})};}}),navigate:url=>location.assign(url)});
await auth.start();window.auth=auth;
export async function getAuthRuntime(){return auth;}
export async function getSupabaseClient(){return auth.getClient();}
`;
