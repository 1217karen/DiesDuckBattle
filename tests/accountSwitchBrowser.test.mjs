import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
let chromium;
if(process.env.PLAYWRIGHT_MODULE)({chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)));
const root=new URL('../',import.meta.url);
const runtimeSource=`
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
test('browser: account menu/add/select/logout/deletion, keyboard and responsive dialogs (isolated SDK)',
 {skip:!chromium&&'Set PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE'},async()=>{
 const setting=await readFile(new URL('setting.html',root),'utf8');
 const header=setting.match(/<header id="common-menu"[\s\S]*?<\/header>/)[0];
 const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/common-menu.css"><body>${header}<main id="home">模擬ホーム</main><script type="module" src="/fixture.js"></script></body></html>`;
 const server=createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;let body,type='text/javascript';
  if(['/index.html','/fixture.html'].includes(pathname)){body=html;type='text/html';}
  else if(pathname==='/auth.html'){body=await readFile(new URL('auth.html',root));type='text/html';}
  else if(pathname==='/fixture.js')body=`import '/js/commonMenu.js';import {getAuthRuntime} from '/js/authRuntime.js';const auth=await getAuthRuntime();auth.subscribe(s=>document.getElementById('home').textContent=s.enos[0]?'ホーム ENo.'+s.enos[0]:'未選択');window.ready=true;`;
  else if(pathname==='/js/authRuntime.js')body=runtimeSource;
  else if(pathname==='/js/accountSwitchingConfig.js')body='export const ACCOUNT_SWITCHING_ENABLED=true;';
  else if(/^\/(js|css|supabase\/functions\/_shared)\/[\w./-]+$/.test(pathname)&&!pathname.includes('..')){body=await readFile(new URL(pathname.slice(1),root));if(pathname.endsWith('.css'))type='text/css';}
  else {res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'"});res.end(body);
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  for(const width of [320,390,430,1280]){
   const context=await browser.newContext({viewport:{width,height:900}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/fixture.html');await page.waitForFunction(()=>window.ready);
   const navigateAction=async action=>{await Promise.all([page.waitForEvent('framenavigated'),action()]);await page.waitForFunction(()=>window.ready);};
   const menu=async()=>{if(!await page.locator('.common-menu__account').evaluate(n=>n.open))await page.locator('.common-menu__account > summary').click();};
   const add=async(eno,password)=>{await menu();await page.getByRole('button',{name:'＋ 別のアカウントを追加',exact:true}).click();await page.getByLabel('ENo',{exact:true}).fill(eno);await page.getByLabel('パスワード',{exact:true}).fill(password);if(password==='valid'){await Promise.all([page.waitForEvent('framenavigated'),page.getByRole('button',{name:'ログインする',exact:true}).click()]);await page.waitForFunction(()=>window.ready);}else await page.getByRole('button',{name:'ログインする',exact:true}).click();};
   await menu();await page.getByRole('button',{name:'＋ 別のアカウントを追加',exact:true}).click();
   for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const rect=await page.locator('dialog').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width+1);
   }
   await page.getByLabel('パスワード',{exact:true}).fill('secret');await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});assert.equal(await page.locator('dialog').count(),0);
   assert.match(await page.evaluate(()=>document.activeElement.textContent),/別のアカウント/);
   await add('1','valid');await page.waitForFunction(()=>document.getElementById('home')?.textContent==='ホーム ENo.1');
   await add('2','bad');await page.getByText('ENoまたはパスワードを確認してください。',{exact:true}).last().waitFor();assert.equal(await page.getByLabel('パスワード',{exact:true}).inputValue(),'');
   await page.getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(await page.locator('#home').textContent(),'ホーム ENo.1');
   await add('2','valid');await page.waitForFunction(()=>document.getElementById('home')?.textContent==='ホーム ENo.2');
   await menu();await navigateAction(()=>page.getByRole('button',{name:'ENo.1｜バトラー1',exact:true}).click());await page.waitForFunction(()=>document.getElementById('home')?.textContent==='ホーム ENo.1');
   await menu();
   assert.equal(await page.locator('[data-account-menu] > :first-child').textContent(),'自分のプロフィールを確認する');
   assert.equal(await page.locator('.account-switch-choice[data-current="true"]').evaluate(n=>getComputedStyle(n).opacity),'1');
   const colors=await page.evaluate(()=>['.account-switch-add','.account-switch-logout','.common-menu__delete-account'].map(selector=>getComputedStyle(document.querySelector(selector)).backgroundColor));
   assert.equal(new Set(colors).size,3);
   if(process.env.ACCOUNT_SWITCH_ARTIFACT_DIR){await mkdir(process.env.ACCOUNT_SWITCH_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:process.env.ACCOUNT_SWITCH_ARTIFACT_DIR+'/menu-'+width+'.png'});}
   const menuRect=await page.locator('.common-menu__account-dropdown').boundingBox();assert.ok(menuRect.x>=0&&menuRect.x+menuRect.width<=width+1);
   await page.getByRole('button',{name:'＋ 別のアカウントを追加',exact:true}).click();
   await page.getByLabel('パスワード',{exact:true}).fill('not-persisted');
   await Promise.all([page.waitForURL('**/auth.html?mode=register'),page.getByRole('link',{name:'新規登録へ',exact:true}).click()]);
   await page.locator('#register-form').waitFor({state:'visible'});
   await page.locator('#character-name').fill('新しいバトラー');
   await page.locator('#register-password').fill('valid123');await page.locator('#confirm-password').fill('valid123');
   await page.locator('#terms-consent').check();
   const registrationNavigations=[];const recordNavigation=frame=>{if(frame===page.mainFrame()&&frame.url().includes('/index.html'))registrationNavigations.push(frame.url());};page.on('framenavigated',recordNavigation);
   await Promise.all([page.waitForURL('**/index.html?notice=registered&eno=3'),page.locator('#register-form button[type="submit"]').click()]);
   await page.waitForFunction(()=>window.ready&&document.getElementById('home')?.textContent==='ホーム ENo.3');
   assert.equal(await page.evaluate(()=>localStorage.getItem('mock-registration-count')),'1');
   page.off('framenavigated',recordNavigation);assert.equal(registrationNavigations.length,1);
   await menu();assert.equal(await page.getByRole('button',{name:'ENo.1｜バトラー1',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'ENo.2｜バトラー2',exact:true}).count(),1);
   await navigateAction(()=>page.getByRole('button',{name:'ENo.1｜バトラー1',exact:true}).click());
   await menu();await navigateAction(()=>page.getByRole('button',{name:'ENo.2｜バトラー2',exact:true}).click());await page.waitForFunction(()=>document.getElementById('home')?.textContent==='ホーム ENo.2');
   await menu();await navigateAction(()=>page.getByRole('button',{name:'ログアウト',exact:true}).click());await page.waitForFunction(()=>document.getElementById('home')?.textContent==='未選択');
   await menu();await navigateAction(()=>page.getByRole('button',{name:'ENo.1｜バトラー1',exact:true}).click());await page.waitForFunction(()=>document.getElementById('home')?.textContent==='ホーム ENo.1');
   await add('2','valid');await page.waitForFunction(()=>document.getElementById('home')?.textContent==='ホーム ENo.2');
   await menu();await page.getByRole('button',{name:'アカウントを削除',exact:true}).click();await page.locator('dialog').waitFor({state:'visible'});
   assert.equal(await page.getByRole('button',{name:'削除する',exact:true}).isEnabled(),false);
   await page.getByRole('checkbox').check();await page.getByRole('button',{name:'削除する',exact:true}).click();
   assert.equal(await page.evaluate(()=>rpcCalls.filter(c=>c.name==='delete_own_account').length),0);
   await navigateAction(()=>page.getByRole('button',{name:'削除を実行',exact:true}).click());await page.waitForFunction(()=>document.getElementById('home')?.textContent==='未選択');
   await menu();assert.equal(await page.getByRole('button',{name:'ENo.1｜バトラー1',exact:true}).count(),1);
   assert.equal(await page.getByRole('button',{name:/ENo.2｜/}).count(),0);assert.deepEqual(errors,[]);
   // An acknowledged RPC followed by reload must expose local recovery, with no new delete.
   await add('2','valid');await page.waitForFunction(()=>document.getElementById('home')?.textContent==='ホーム ENo.2');
   assert.equal(await page.evaluate(async()=>{const target=auth.runtime.getCurrent().account;return (await auth.runtime.deleteCurrent(target)).ok;}),true);
   const deleteCount=await page.evaluate(()=>localStorage.getItem('mock-delete-count'));
   await page.reload();await page.waitForFunction(()=>window.ready);await menu();
   await page.getByRole('button',{name:'端末側の処理を完了する',exact:true}).click();
   await page.waitForFunction(()=>auth.snapshot().deletionRecoveries.length===0);
   assert.equal(await page.evaluate(()=>localStorage.getItem('mock-delete-count')),deleteCount);
   assert.equal(await page.getByRole('button',{name:'ENo.1｜バトラー1',exact:true}).count(),1);
   assert.equal(await page.locator('#home').textContent(),'未選択');
   if(width===1280){
    await add('2','valid');await page.waitForFunction(()=>document.getElementById('home')?.textContent==='ホーム ENo.2');
    // Fail only the confirmed journal write, after the mock server has deleted B.
    assert.equal(await page.evaluate(async()=>{
      const original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){if(k==='diesduck-account-deletions-v1'&&v.includes('deletion-confirmed'))throw Error('disk full');return original.call(this,k,v);};
      try{return (await auth.runtime.deleteCurrent(auth.runtime.getCurrent().account)).ok;}finally{Storage.prototype.setItem=original;}
    }),false);
    const count=await page.evaluate(()=>localStorage.getItem('mock-delete-count'));
    await page.reload();await page.waitForFunction(()=>window.ready);await menu();
    await page.getByText('ENo.2の削除結果は不明です。削除要求は再送しません。通信状況とサーバー側の状態の確認が必要です。',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'端末側の処理を完了する',exact:true}).count(),0);
    assert.equal(await page.evaluate(async()=>{const record=auth.snapshot().deletionRecoveries[0];return (await auth.runtime.deleteCurrent(record)).ok;}),false);
    assert.equal(await page.evaluate(()=>localStorage.getItem('mock-delete-count')),count);
    await menu();await navigateAction(()=>page.getByRole('button',{name:'ENo.1｜バトラー1',exact:true}).click());
    await page.waitForFunction(()=>document.getElementById('home')?.textContent==='ホーム ENo.1');
   }
   assert.deepEqual(errors,[]);await context.close();
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
