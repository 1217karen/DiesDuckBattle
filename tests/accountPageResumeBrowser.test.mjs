import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {runtimeSource} from './accountBrowserFixture.mjs';
import {player,da,db} from './onlineSelectFixture.mjs';
let chromium;if(process.env.PLAYWRIGHT_MODULE)({chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)));
const root=new URL('../',import.meta.url),uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('browser: real auth runtime, select battle/result back-forward, restored pages, visibility and cross-tab invalidation',
 {skip:!chromium&&'Set PLAYWRIGHT_MODULE',timeout:90000},async()=>{
 const self=await player(uuid(101),'1',da),opponent=await player(uuid(102),'2',db);
 let sdk=runtimeSource.slice(runtimeSource.indexOf('const uuid='),runtimeSource.indexOf('window.rpcCalls=[];'));
 sdk=sdk.replace('const listeners=new Set();const current=()=>read(key);', `const listeners=new Set();const current=()=>read(key);window.sdkEvents??={};window.sdkEvents[key]=(event)=>{for(const fn of listeners)fn(event,{user:current()});};`);
 sdk=sdk.replace('async getUser(){return {data:{user:current()}};}',`async getUser(){
  window.verifyCalls=(window.verifyCalls||0)+1;
  if(sessionStorage.getItem('verify-gate'))await new Promise(r=>window.releaseVerification=r);
  if(sessionStorage.getItem('verify-offline'))throw Error('offline');
  if(sessionStorage.getItem('verify-expired'))return {error:{status:401}};
  return {data:{user:current()}};
 }`).replace('window.rpcCalls.push({name,args});',`window.rpcCalls.push({name,args});
 const self=${JSON.stringify(self.snapshot)},opponent=${JSON.stringify(opponent.snapshot)};
 if(name==='load_online_player')return {data:self};
 if(name==='get_online_random_win_streak')return {data:0};
 if(name==='list_online_opponents')return {data:[{id:opponent.gameAccountId,eno:'2',name:'相手',publicDuckId:opponent.publicDuckId,defaultIconUrl:'',battleBuild:${JSON.stringify(opponent.data.build)}}]};
 if(name==='get_online_opponent')return {data:opponent};
 if(name==='prepare_online_battle')return {data:{self,opponent}};
 if(name==='save_online_battle_result'){
  const result={...args.p_record,id:'battle',battleId:'battle',battleNo:'1',dateISO:'2026-10-16T00:00:00Z',p1Eno:'1',p2Eno:'2'};
  localStorage.setItem('mock-battle',JSON.stringify(result));return {data:result};
 }
 if(name==='get_online_battle_result')return {data:JSON.parse(localStorage.getItem('mock-battle')||'null')};
 if(name==='get_index_messages')return {data:{eno:'1',ownMessage:'hello',others:[]}};
 `)+`window.rpcCalls=[];export function createClient(_url,_key,options){return client(options.auth.storageKey);}`;
 const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname;let body,type='text/javascript';
  if(path==='/mock-sdk.js')body=sdk;
  else if(/^\/[\w./-]+$/.test(path)&&!path.includes('..')){
   body=await readFile(new URL(path.slice(1),root));type=path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':path.endsWith('.json')?'application/json':type;
   if(['/js/accountRuntime.js','/js/supabaseClients.js'].includes(path))body=body.toString().replaceAll('https://esm.sh/@supabase/supabase-js@2.117.2?bundle','/mock-sdk.js');
  }else throw Error();
  res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"});res.end(body);
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let browser;
 try{
  browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--disable-back-forward-cache'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const context=await browser.newContext();
  const init=()=>{
   const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
   if(!localStorage.getItem('seeded')){
    localStorage.setItem('seeded','yes');localStorage.setItem('diesduck-account-sessions-v1',JSON.stringify({version:1,entries:[1,2].map(n=>({slot:uuid(n),eno:String(n),name:'バトラー'+n})),pending:[],active:uuid(1)}));
    for(const n of [1,2])localStorage.setItem('mock-diesduck-auth-account-v1-'+uuid(n),JSON.stringify({id:uuid(n),email:'eno-'+n+'@auth.diesduck.invalid'}));
   }
   const log=(kind,extra={})=>{const list=JSON.parse(sessionStorage.getItem('lifecycle')||'[]');list.push({kind,path:location.pathname,...extra});sessionStorage.setItem('lifecycle',JSON.stringify(list));};
   addEventListener('pageshow',e=>log('pageshow',{persisted:e.persisted}));addEventListener('pagehide',e=>log('pagehide',{persisted:e.persisted}));
   window.authStates=[];window.documentId=Math.random();
  };
  await context.addInitScript(init);
  let page=await context.newPage();const errors=[];page.on('pageerror',e=>{if(!/Login required|Auth state could not be confirmed/.test(e.message))errors.push(e.message);});
  const auth=()=>page.evaluate(async()=>{const a=await (await import('/js/authRuntime.js')).getAuthRuntime();return a.snapshot();});
  const ready=async()=>{await page.waitForFunction(()=>document.querySelector('#random-opponent')?.disabled===false,{},{timeout:10000});assert.match(page.url(),/select.html$/);assert.equal((await auth()).enos[0],'1');assert.equal(await page.locator('body').evaluate(n=>n.classList.contains('auth-required-pending')),false);};
  await page.goto(origin+'/select.html');await ready();
  const firstDocument=await page.evaluate(()=>window.documentId);
  await page.locator('#random-opponent').click();await page.waitForFunction(()=>!document.querySelector('#vsButton').disabled);
  await page.locator('#vsButton').click();await page.waitForURL(/result.html\?battleId=battle/);await page.waitForFunction(()=>!document.querySelector('#btnAll').disabled);
  await page.goBack({waitUntil:'commit'});await ready();
  let lifecycle=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('lifecycle')));
  // Real BFCache restore must occur without replacing the document.
  assert.ok(lifecycle.some(e=>e.path==='/select.html'&&e.kind==='pageshow'&&e.persisted),JSON.stringify(lifecycle));assert.equal(await page.evaluate(()=>window.documentId),firstDocument);
  await page.goForward({waitUntil:'commit'});await page.waitForURL(/result.html/,{waitUntil:'commit'});await page.waitForFunction(()=>!document.querySelector('#btnAll').disabled);await page.waitForFunction(async()=>(await (await import('/js/authRuntime.js')).getAuthRuntime()).snapshot().signedIn);await page.goBack({waitUntil:'commit'});await ready();
  // Explicit reload path validates again, never retains the old document's scoped client.
  await page.reload();await ready();assert.ok(await page.evaluate(()=>window.verifyCalls>=2));
  // Same-owner renewal must not recreate menus, images or discard a home draft.
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>document.querySelector('#home-standing').style.visibility==='visible'&&!document.querySelector('#home-message-edit').disabled);
  await page.locator('#home-message-edit').click();await page.locator('#home-message-input').fill('unsaved home draft');
  const layout=await page.locator('#common-menu').boundingBox();
  await page.evaluate(()=>{
    window.menuLink=document.querySelector('.common-menu__links a');window.accountButton=document.querySelector('.account-switch-choice');
    window.standingImage=document.querySelector('#home-standing');window.imageSource=standingImage.src;
    window.rpcBefore=window.rpcCalls.filter(c=>c.name==='load_online_player').length;
    sessionStorage.setItem('verify-gate','yes');const key=Object.keys(window.sdkEvents).find(k=>k.includes('account'));window.sdkEvents[key]('TOKEN_REFRESHED');
  });
  await page.waitForFunction(()=>!!window.releaseVerification);
  assert.equal(await page.locator('#home-game').evaluate(n=>n.inert),true);assert.equal(await page.locator('#home-standing').evaluate(n=>n.style.visibility),'hidden');
  assert.equal(await page.evaluate(()=>menuLink===document.querySelector('.common-menu__links a')&&accountButton===document.querySelector('.account-switch-choice')),true);
  assert.deepEqual(await page.locator('#common-menu').boundingBox(),layout);
  await page.evaluate(()=>{sessionStorage.removeItem('verify-gate');window.releaseVerification();});await page.waitForFunction(()=>!document.querySelector('#home-game').inert);
  assert.equal(await page.locator('#home-message-input').inputValue(),'unsaved home draft');
  assert.equal(await page.evaluate(()=>standingImage===document.querySelector('#home-standing')&&standingImage.src===imageSource&&window.rpcCalls.filter(c=>c.name==='load_online_player').length===rpcBefore),true);
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.goto(origin+'/select.html');await ready();
  const other=await context.newPage();await other.goto(origin+'/result.html?battleId=battle');await other.bringToFront();
  // Headless tabs do not reliably change visibility; exercise the native listener with its observable state.
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal((await auth()).signedIn,true);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});await page.bringToFront();await ready();
  // Actual SDK callback and storage notification for a healthy token renewal.
  const beforeRefresh=await page.evaluate(()=>({id:window.documentId,calls:window.verifyCalls}));
  await page.evaluate(()=>{const key=Object.keys(window.sdkEvents).find(k=>k.includes('account'));window.sdkEvents[key]('TOKEN_REFRESHED');});await ready();
  assert.equal(await page.evaluate(()=>window.documentId),beforeRefresh.id);assert.ok(await page.evaluate(n=>window.verifyCalls>n,beforeRefresh.calls));
  await other.evaluate(()=>{const registry=JSON.parse(localStorage.getItem('diesduck-account-sessions-v1'));localStorage.setItem('diesduck-auth-account-v1-'+registry.active,JSON.stringify({renewal:Date.now()}));});
  await page.waitForFunction(n=>window.verifyCalls>n,beforeRefresh.calls+2);await ready();
  // Suspended snapshot conceals the page and blocks writes until automatic verification completes.
  await page.evaluate(async()=>{const a=await (await import('/js/authRuntime.js')).getAuthRuntime();window.oldClient=a.getClient();window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));});
  assert.equal((await auth()).sessionKnown,false);assert.equal(await page.locator('body').evaluate(n=>n.classList.contains('auth-required-pending')),true);
  assert.equal(await page.evaluate(async()=>!!(await oldClient.rpc('save_online_player',{p_game_account_id:oldClient.accountContext.account.gameAccountId})).error),true);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await ready();
  // Delayed startup and offline getUser must not emit a confirmed guest or logout-success notice.
  await page.evaluate(()=>sessionStorage.setItem('verify-gate','yes'));await page.reload();await page.waitForFunction(()=>!!window.releaseVerification);
  assert.equal((await auth()).sessionKnown,false);assert.equal((await auth()).ready,false);assert.match(page.url(),/select.html$/);
  await page.evaluate(()=>{sessionStorage.removeItem('verify-gate');window.releaseVerification();});await ready();
  await page.evaluate(()=>sessionStorage.setItem('verify-offline','yes'));await page.reload();
  await page.getByRole('button',{name:'ログイン状態を再確認'}).waitFor();
  assert.match(page.url(),/select.html$/);assert.equal((await auth()).sessionKnown,false);assert.equal((await auth()).logoutSucceeded,false);
  const failedDocument=await page.evaluate(()=>window.documentId);
  await page.evaluate(()=>sessionStorage.removeItem('verify-offline'));await page.getByRole('button',{name:'ログイン状態を再確認'}).click();await ready();assert.equal(await page.evaluate(()=>window.documentId),failedDocument);
  await page.evaluate(()=>sessionStorage.setItem('verify-expired','yes'));await page.reload();await page.waitForURL(/index.html/,{waitUntil:'commit'});
  await page.waitForFunction(async()=> (await (await import('/js/authRuntime.js')).getAuthRuntime()).snapshot().sessionKnown);
  assert.equal((await auth()).signedIn,false);assert.equal((await auth()).logoutSucceeded,false);
  await page.evaluate(()=>sessionStorage.removeItem('verify-expired'));await page.goto(origin+'/select.html');await ready();
  // Selection changes in a different tab must eject A, not re-admit its old page as B.
  await other.reload();
  // getAuthRuntime exposes the controller before startup finishes. Await the
  // same initialized-client boundary used by page services before acting on it.
  await other.evaluate(async()=>{await (await import('/js/authRuntime.js')).getSupabaseClient();});
  await other.waitForFunction(async()=>{const a=await (await import('/js/authRuntime.js')).getAuthRuntime(),s=a.snapshot();return s.ready&&s.sessionKnown&&s.signedIn&&!s.busy;});
  const selectTwo=await other.evaluate(async()=>{const a=await (await import('/js/authRuntime.js')).getAuthRuntime();return a.runtime.select('2');});
  assert.equal(selectTwo.ok,true,JSON.stringify(selectTwo));
  await page.waitForURL(origin+'/index.html',{waitUntil:'commit'});await page.waitForFunction(async()=> (await (await import('/js/authRuntime.js')).getAuthRuntime()).snapshot().enos[0]==='2');
  const selectOne=await other.evaluate(async()=>{const a=await (await import('/js/authRuntime.js')).getAuthRuntime();return a.runtime.select('1');});
  assert.equal(selectOne.ok,true,JSON.stringify(selectOne));
  await page.goto(origin+'/select.html');await ready();
  // Another tab's real runtime logout invalidates captured writes and ejects this protected page.
  await page.evaluate(async()=>window.captured=(await (await import('/js/authRuntime.js')).getAuthRuntime()).getClient());
  await other.reload();
  await other.evaluate(async()=>{await (await import('/js/authRuntime.js')).getSupabaseClient();});
  await other.waitForFunction(async()=>{const a=await (await import('/js/authRuntime.js')).getAuthRuntime(),s=a.snapshot();return s.ready&&s.sessionKnown&&s.signedIn&&!s.busy;});
  const logoutNavigation=page.waitForURL(/index.html/,{waitUntil:'commit',timeout:10000}).catch(e=>{throw new Error(e.message+' actual URL: '+page.url());});
  const logout=await other.evaluate(async()=>{const a=await (await import('/js/authRuntime.js')).getAuthRuntime();return a.runtime.logoutGame();});assert.equal(logout.ok,true);
  await logoutNavigation;assert.equal((await auth()).signedIn,false);
  await page.goto(origin+'/select.html');await page.waitForURL(/index.html/,{waitUntil:'commit'});
  assert.deepEqual(errors,[]);await context.close();await browser.close();
  // Chromium's default Playwright launch disables BFCache: Back creates a fresh document.
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const freshContext=await browser.newContext();await freshContext.addInitScript(init);page=await freshContext.newPage();
  await page.goto(origin+'/select.html');await ready();
  await page.locator('#random-opponent').click();await page.waitForFunction(()=>!document.querySelector('#vsButton').disabled);
  await page.locator('#vsButton').click();await page.waitForURL(/result.html\?battleId=battle/);
  await page.goBack({waitUntil:'commit'});await ready();
  lifecycle=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('lifecycle')));
  assert.ok(!lifecycle.some(e=>e.kind==='pageshow'&&e.persisted));
  assert.ok(await page.evaluate(()=>window.verifyCalls>=2));await freshContext.close();
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
