import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {runtimeSource} from './accountBrowserFixture.mjs';
let chromium;
if(process.env.PLAYWRIGHT_MODULE)({chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)));
const root=new URL('../',import.meta.url);
const mocked=`import {encodeOnlinePlayer} from '/js/onlinePlayerDto.js';
import {createEmptyPlayerBuild} from '/js/playerBuildModel.js';
import {createEmptyPlayerPresentation} from '/js/playerPresentationModel.js';
${runtimeSource}`.replace('async getUser(){return {data:{user:current()}};}',`async getUser(){
 if(current()?.email.includes('eno-2@') && window.delaySwitch)await new Promise(r=>window.releaseSwitch=()=>{window.delaySwitch=false;r();});
 if(current()?.email.includes('eno-2@') && window.failSwitch)throw Error('offline');
 return {data:{user:current()}};
}`).replace('window.rpcCalls.push({name,args});',`window.rpcCalls.push({name,args});
 if(name==='load_online_player'){
  const eno=current().email.match(/eno-(\\d+)@/)[1];
  return {data:JSON.parse(localStorage.getItem('row-'+eno)||'null')??{...encodeOnlinePlayer({build:createEmptyPlayerBuild(),presentation:createEmptyPlayerPresentation(),publicSettings:{schemaVersion:1,publicDuckId:null},battlerName:'バトラー'+eno}),gameAccountId:uuid(100+Number(eno)),eno,revision:'0'}};
 }
 if(name==='save_online_player'){
  if(window.delaySave)await new Promise(r=>window.releaseSave=r);
  const eno=current().email.match(/eno-(\\d+)@/)[1];localStorage.setItem('row-'+eno,JSON.stringify({...args.p_payload,gameAccountId:args.p_game_account_id,eno,revision:'1'}));return {data:{revision:'1'}};
 }
`).replace('navigate:url=>location.assign(url)',`navigate:url=>{localStorage.setItem('controller-navigations',String(Number(localStorage.getItem('controller-navigations')||0)+1));location.assign(url);}`);
test('browser: actual battle/character editors reject dirty and saving switches, recover failed A, and navigate once to B',
 {skip:!chromium&&'Set PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE'},async()=>{
 const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname;let body,type='text/javascript';
  if(path==='/js/authRuntime.js')body=mocked;
  else if(path==='/index.html'){body='<html><body><p id="home"></p><script type="module" src="/home.js"></script></body></html>';type='text/html';}
  else if(path==='/home.js')body="import {getAuthRuntime} from '/js/authRuntime.js';const auth=await getAuthRuntime();document.getElementById('home').textContent=auth.snapshot().enos[0];";
  else if(/^\/[\w./-]+$/.test(path)&&!path.includes('..')){body=await readFile(new URL(path.slice(1),root));type=path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':path.endsWith('.json')?'application/json':type;}
  else throw Error('path');
  res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(body);
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  for(const file of ['setting','character'])for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:900}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
   await context.addInitScript(()=>{
    if(localStorage.getItem('diesduck-account-sessions-v1'))return;
    const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    localStorage.setItem('diesduck-account-sessions-v1',JSON.stringify({version:1,entries:[1,2].map(n=>({slot:uuid(n),eno:String(n),name:'バトラー'+n})),pending:[],active:uuid(1)}));
    for(const n of [1,2])localStorage.setItem('mock-diesduck-auth-account-v1-'+uuid(n),JSON.stringify({id:uuid(n),email:'eno-'+n+'@auth.diesduck.invalid'}));
   });
   const page=await context.newPage(),errors=[],navigations=[];page.on('pageerror',e=>errors.push(e.message));page.on('framenavigated',f=>{if(f===page.mainFrame())navigations.push(f.url());});
   await page.goto(origin+'/'+file+'.html');await page.waitForFunction(()=>document.querySelector('#editor')?.hidden===false&&document.querySelector('#save')?.disabled===false,{},{timeout:10000}).catch(async error=>{error.message+=' '+file+' '+width+' errors='+JSON.stringify(errors)+' text='+await page.locator('body').innerText();throw error;});
   const menu=async()=>{if(!await page.locator('.common-menu__account').evaluate(n=>n.open))await page.locator('.common-menu__account > summary').click();};
   const switchB=async()=>{await menu();await page.getByRole('button',{name:'ENo.2｜バトラー2',exact:true}).click();};
   if(file==='setting')await page.locator('#add-duck').click();
   const input=page.locator(file==='setting'?'#duck-name':'#battler-name');await input.fill('編集中の値');
   await switchB();await page.getByText('未保存の変更があります。保存してからアカウントを切り替えてください。',{exact:true}).first().waitFor();
   assert.equal(await input.inputValue(),'編集中の値');assert.equal(await page.evaluate(()=>auth.snapshot().enos[0]),'1');assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(navigations.length,1);assert.equal(await page.locator('body').evaluate(n=>n.classList.contains('auth-required-pending')),false);
   await page.keyboard.press('Escape');await page.evaluate(()=>window.delaySave=true);await page.locator('#save').click();if(file==='setting')await page.getByRole('button',{name:'このまま保存',exact:true}).click();await page.waitForFunction(()=>!!window.releaseSave);
   await switchB();await page.getByText('処理中です。完了してからアカウントを切り替えてください。',{exact:true}).first().waitFor();assert.equal(await input.inputValue(),'編集中の値');
   await page.evaluate(()=>{window.delaySave=false;window.releaseSave();});await page.waitForFunction(()=>document.querySelector('#save-message').textContent==='変更はありません');
   await page.evaluate(()=>{window.delaySwitch=true;window.failSwitch=true;});await switchB();await page.waitForFunction(()=>!!window.releaseSwitch);
   assert.equal(navigations.length,1);assert.equal(await page.locator('#editor').evaluate(n=>getComputedStyle(n).visibility),'hidden');
   await page.evaluate(()=>window.releaseSwitch());await page.waitForFunction(()=>!auth.snapshot().busy);assert.equal(await page.evaluate(()=>auth.snapshot().enos[0]),'1');assert.equal(await page.locator('#editor').evaluate(n=>getComputedStyle(n).visibility),'visible');assert.ok(await page.evaluate(()=>auth.snapshot().message));assert.equal(navigations.length,1);
   await page.evaluate(()=>window.failSwitch=false);await switchB();await page.waitForURL(origin+'/index.html');await page.waitForFunction(()=>document.querySelector('#home').textContent==='2');
   assert.equal(navigations.length,2);assert.equal(await page.evaluate(()=>localStorage.getItem('controller-navigations')),'1');assert.deepEqual(errors,[]);await context.close();
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
