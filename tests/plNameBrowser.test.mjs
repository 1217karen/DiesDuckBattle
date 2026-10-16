import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {runtimeSource} from './accountBrowserFixture.mjs';
import {profileFixture} from './onlineProfileFixture.mjs';
let chromium;if(process.env.PLAYWRIGHT_MODULE)({chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)));
const root=new URL('../',import.meta.url);
const fixture=profileFixture();fixture.isOwner=false;
const mocked=`import {encodeOnlinePlayer} from '/js/onlinePlayerDto.js';
import {createEmptyPlayerBuild} from '/js/playerBuildModel.js';
import {createEmptyPlayerPresentation} from '/js/playerPresentationModel.js';
${runtimeSource}`.replace('window.rpcCalls.push({name,args});',`window.rpcCalls.push({name,args});
 if(name==='get_online_profile')return {data:{...${JSON.stringify(fixture)},plName:JSON.parse(localStorage.getItem('pl-row')||'null')?.battler.presentation.plName??''}};
 if(name==='load_online_player'){
  if(localStorage.getItem('pl-fail-load'))return {error:{code:'offline'}};
  return {data:JSON.parse(localStorage.getItem('pl-row')||'null')??{...encodeOnlinePlayer({build:createEmptyPlayerBuild(),presentation:createEmptyPlayerPresentation(),publicSettings:{schemaVersion:1,publicDuckId:null},battlerName:'テスト'}),gameAccountId:uuid(101),eno:'1',revision:'0'}};
 }
 if(name==='save_online_player'){
  if(window.failSave)return {error:{code:'offline'}};
  localStorage.setItem('pl-row',JSON.stringify({...args.p_payload,gameAccountId:args.p_game_account_id,eno:'1',revision:'1'}));return {data:{revision:'1'}};
 }
`);
const publicClient=`export async function getPublicSupabaseClient(){return {auth:{getSession:async()=>({data:{session:null}})},rpc:async(name)=>{
 const plName=JSON.parse(localStorage.getItem('pl-row')||'null')?.battler.presentation.plName??'';
 if(name==='get_online_profile')return {data:{...${JSON.stringify(fixture)},plName}};
 if(name==='list_online_characters')return {data:[1,2,3].map(n=>({eno:String(n),plName:n===3?'':plName,battlerName:'テスト'+n,battlerIconUrl:'',accent:'#4F91B3',background:'#DCEEF3',panel:'#FFFFFF',text:'#20282C',duck:null,bestStreak:0}))};
 return {error:{}};
 }}};`;
test('browser PL editor persistence and failures; profile link/list on desktop and narrow mobile', {skip:!chromium&&'Set PLAYWRIGHT_MODULE'},async()=>{
 const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname;let body,type='text/javascript';
  if(path==='/js/authRuntime.js')body=mocked;
  else if(path==='/js/supabaseClients.js')body=publicClient;
  else if(/^\/[\w./-]+$/.test(path)&&!path.includes('..')){body=await readFile(new URL(path.slice(1),root));type=path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':path.endsWith('.json')?'application/json':type;}
  else throw Error();res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(body);
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  for(const width of [1280,320,390,430]){
   const context=await browser.newContext({viewport:{width,height:900}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
   await context.addInitScript(()=>{
    if(localStorage.getItem('diesduck-account-sessions-v1'))return;
    const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    localStorage.setItem('diesduck-account-sessions-v1',JSON.stringify({version:1,entries:[{slot:uuid(1),eno:'1',name:'テスト'}],pending:[],active:uuid(1)}));
    localStorage.setItem('mock-diesduck-auth-account-v1-'+uuid(1),JSON.stringify({id:uuid(1),email:'eno-1@auth.diesduck.invalid'}));
   });
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const ready=()=>page.waitForFunction(()=>document.querySelector('#editor')?.hidden===false&&!document.querySelector('#save')?.disabled);
   const saved=()=>page.waitForFunction(()=>document.querySelector('#save-message').textContent==='変更はありません');
   const fit=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.goto(origin+'/character.html');await ready();assert.equal(await page.locator('#pl-name').inputValue(),'');
   const name='雪 & PL😀';await page.locator('#pl-name').fill('  '+name+'　');assert.equal(await page.locator('#save-message').textContent(),'未保存の変更があります');
   await page.locator('#save').click();await saved();await page.reload();await ready();assert.equal(await page.locator('#pl-name').inputValue(),name);
   await page.locator('#pl-name').fill('😀'.repeat(31));assert.equal(await page.locator('#save').isDisabled(),true);await page.locator('#pl-name').fill(name);
   if(width===1280){
    await page.locator('#pl-name').fill('失敗時も保持');await page.evaluate(()=>window.failSave=true);await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#pl-name').disabled);
    assert.equal(await page.locator('#pl-name').inputValue(),'失敗時も保持');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pl-row')).battler.presentation.plName),name);
    await page.evaluate(()=>localStorage.setItem('pl-fail-load','yes'));
    page.once('dialog',d=>d.accept());await page.reload();await page.waitForFunction(()=>document.querySelector('#load-message').hidden);
    assert.equal(await page.locator('#editor').isHidden(),true);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pl-row')).battler.presentation.plName),name);
    await page.evaluate(()=>localStorage.removeItem('pl-fail-load'));await page.reload();await ready();assert.equal(await page.locator('#pl-name').inputValue(),name);
   }else{await page.locator('#save').click();await saved();}
   await page.locator('#pl-name').scrollIntoViewIfNeeded();await fit();
   if(process.env.PL_SCREENSHOT_DIR){await mkdir(process.env.PL_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.PL_SCREENSHOT_DIR+'/character-'+width+'.png'});}
   await page.goto(origin+'/profile.html?eno=1');await page.locator('.profile-pl-name a').waitFor({timeout:10000});assert.equal(await page.locator('.profile-pl-name').innerText(),'PL：'+name);
   assert.equal(await page.locator('.profile-pl-name').evaluate(n=>getComputedStyle(n).color),await page.locator('.profile-header h1').evaluate(n=>getComputedStyle(n).color));
   await page.locator('.profile-pl-name').scrollIntoViewIfNeeded();await fit();
   if(process.env.PL_SCREENSHOT_DIR)await page.screenshot({path:process.env.PL_SCREENSHOT_DIR+'/profile-'+width+'.png'});
   await page.locator('.profile-pl-name a').click();await page.locator('.character-card').first().waitFor();assert.equal(await page.locator('#pl-name-filter').inputValue(),name);assert.equal(await page.locator('.character-card').count(),2);await fit();
   await page.locator('#pl-name-filter').fill('匿名');assert.equal(await page.locator('.character-card').count(),0);await page.locator('#pl-name-filter').fill('');assert.equal(await page.locator('.character-card').count(),3);
   if(process.env.PL_SCREENSHOT_DIR)await page.screenshot({path:process.env.PL_SCREENSHOT_DIR+'/list-'+width+'.png'});
   await page.goto(origin+'/character.html');await ready();await page.locator('#pl-name').fill('');await page.locator('#save').click();await saved();await page.reload();await ready();assert.equal(await page.locator('#pl-name').inputValue(),'');
   await page.goto(origin+'/profile.html?eno=1');await page.locator('.profile-pl-name').waitFor();assert.equal(await page.locator('.profile-pl-name').innerText(),'PL：匿名');assert.equal(await page.locator('.profile-pl-name a').count(),0);
   assert.deepEqual(errors,[]);await context.close();
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
