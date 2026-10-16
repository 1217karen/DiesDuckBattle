import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { player, a, b, da } from './onlineSelectFixture.mjs';
import { encodeOnlinePlayer } from '../js/onlinePlayerDto.js';
import { profileFixture } from './onlineProfileFixture.mjs';
let chromium; if(process.env.PLAYWRIGHT_MODULE)({chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)));
const root=new URL('../',import.meta.url);
test('browser introductions: keyboard confirmation, edit/delete/cancel, icons, images, colors, safe text and account guards',
 {skip:!chromium&&'Set PLAYWRIGHT_MODULE',timeout:90000},async()=>{
 const data=(await player(a,'1',da)).data;data.presentation.battler.defaultIconUrl='/img/B00_icon.png';data.presentation.battler.iconSlots[0]='/img/D00.png';
 const dto={...encodeOnlinePlayer(data),gameAccountId:a,eno:'1',revision:'1'};
 const profile=profileFixture();profile.accountId=b;profile.eno='2';profile.isOwner=false;
 const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/common-fonts.css"><link rel="stylesheet" href="/css/profile.css"><body><main id="profile" class="profile-page"></main>
 <script type="module">
 import {mountProfileIntroductions} from '/js/profileIntroductions.js'; import {renderProfile} from '/js/profileView.js';
 const a=${JSON.stringify(a)},b=${JSON.stringify(b)},dto=${JSON.stringify(dto)},profile=${JSON.stringify(profile)};
 const mode=new URLSearchParams(location.search).get('mode');if(mode==='self')profile.accountId=a;
 let user=mode==='guest'?null:'user', rows=[], listener;window.writes=[];window.notices=[];
 const author={accountId:a,eno:'1',name:'作者<script>',iconUrl:'/img/B00_icon.png',defaultIconUrl:'/img/B00_icon.png',theme:{background:'#010203',panel:'#040506',text:'#ffffff',accent:'#abcdef'}};
 window.client={accountContext:{account:{gameAccountId:a,eno:'1',authUserId:'user'}},auth:{getSession:async()=>user?{data:{session:{user:{id:user}}}}:{data:{session:null}},onAuthStateChange:fn=>{listener=fn;return{data:{subscription:{unsubscribe(){}}}};}},beforeAccountChange:fn=>{window.guard=fn;return()=>{};},
 rpc:async(name,p)=>{
  if(name==='list_profile_introductions'){if(mode==='fail')return{error:{code:'network'}};return{data:structuredClone(rows)};}
  if(name==='load_online_player')return{data:structuredClone(dto)};
  if(name==='save_profile_introduction'){
   window.writes.push(p);const deleted=p.p_body.replace(/<\\/?(?:b|i|u|rb|rt|small|big)>/gi,'').trim()==='';
   if(deleted)rows=[];else rows=[{id:a,revision:String(window.writes.length),body:p.p_body,iconSlot:p.p_icon_slot,imageUrl:p.p_image_url,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',author:structuredClone(author)}];
   return{data:{id:a,revision:String(window.writes.length),deleted}};
  }throw Error('unexpected RPC '+name);
 }};
 if(mode==='guest')delete window.client.accountContext;
 window.switchIdentity=()=>{user='other';listener('SIGNED_OUT',null);};
 window.rows=()=>rows;
 const main=document.getElementById('profile');main.append(renderProfile(document,profile));
 window.editor=mountProfileIntroductions({document,main,profile,client:window.client,notify:n=>window.notices.push(n)});await window.editor.ready;window.ready=true;
 </script>`;
 const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://local').pathname;
  if(path==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
  if(path==='/image.svg'){const large=new URL(req.url,'http://local').searchParams.has('large');res.setHeader('content-type','image/svg+xml');res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${large?481:480}" height="480"><rect width="100%" height="100%" fill="blue"/></svg>`);return;}
  const file=await readFile(new URL('.'+path,root));res.setHeader('content-type',path.endsWith('.js')||path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'text/plain');res.end(file);
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.waitForFunction(()=>window.ready);
 assert.equal(await page.locator('.profile-introductions').evaluate(n=>n.open),false);
 await page.locator('.profile-introductions summary').click();await page.getByText('まだ紹介文はありません。').waitFor();
 await page.getByRole('button',{name:'紹介文を書く',exact:true}).click();await page.locator('#introduction-body').waitFor();
 // Same structure as the profile text editor: label-wrapped textarea -> character count -> toolbar.
 assert.equal(await page.locator('#introduction-body').evaluate(input => {
   const label = input.parentElement, count = label?.nextElementSibling, toolbar = count?.nextElementSibling;
   return label?.matches('label.introduction-body-label') && count?.id === 'introduction-count'
     && toolbar?.classList.contains('quote-toolbar') && getComputedStyle(toolbar).marginTop === '5px';
 }), true);
 assert.equal(await page.locator('.introduction-editor button').filter({hasText:'保存'}).isEnabled(),false);
 await page.locator('#introduction-body').fill('😀'.repeat(501));assert.match(await page.locator('#introduction-count').textContent(),/501.*500文字以内/);
 await page.locator('#introduction-body').fill('hello\n<b>bold</b><script>window.INJECTED=true</script>');
 await page.getByRole('button',{name:'アイコンを選択'}).click();assert.equal(await page.locator('.icon-choice').count(),11);
 await page.locator('.icon-choice[data-slot="1"]').click();
 await page.locator('#introduction-image-url').fill(origin+'/image.svg?large');await page.waitForFunction(()=>document.querySelector('#introduction-image-status').textContent.includes('大きすぎ'));
 assert.equal(await page.getByRole('button',{name:'保存',exact:true}).isEnabled(),false);
 await page.locator('#introduction-image-url').fill(origin+'/missing.png');await page.waitForFunction(()=>document.querySelector('#introduction-image-status').textContent.includes('読み込めない'));
 await page.locator('#introduction-image-url').fill(origin+'/image.svg');await page.waitForFunction(()=>document.querySelector('#introduction-image-status').textContent.includes('480×480'));
 assert.equal(await page.evaluate(()=>window.guard({action:'select'}).code),'unsaved-changes');
 assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),true);
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('.introduction-confirm[open]').waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.textContent),'キャンセル');await page.keyboard.press('Escape');assert.equal(await page.locator('.introduction-confirm').evaluate(n=>n.open),false);
 assert.equal(await page.evaluate(()=>window.writes.length),0);assert.equal(await page.locator('#introduction-body').inputValue(),'hello\n<b>bold</b><script>window.INJECTED=true</script>');
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('button',{name:'保存する',exact:true}).click();
 await page.locator('.profile-introduction').waitFor();assert.equal(await page.evaluate(()=>window.writes.length),1);
 assert.equal(await page.locator('.introduction-body b').textContent(),'bold');assert.equal(await page.locator('.introduction-body script').count(),0);assert.equal(await page.evaluate(()=>window.INJECTED),undefined);
 assert.equal(await page.locator('.introduction-author a').getAttribute('href'),'profile.html?eno=1');
 assert.equal(await page.locator('.profile-introduction').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(1, 2, 3)');
 assert.equal(await page.locator('.introduction-body').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(4, 5, 6)');
 assert.notEqual(await page.locator('body').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(1, 2, 3)');
 assert.deepEqual(await page.locator('.introduction-author img').evaluate(n=>[n.width,n.height]),[60,60]);
 await page.getByRole('button',{name:'紹介文を編集する',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.introduction-editor fieldset').disabled);
 await page.getByRole('button',{name:'アイコンを選択'}).click();assert.equal(await page.locator('.icon-choice[aria-current="true"]').getAttribute('data-slot'),'1');await page.getByRole('button',{name:'閉じる',exact:true}).click();
 await page.locator('#introduction-body').fill('<b> \n</b>');await page.locator('#introduction-image-url').fill(origin+'/missing.png');
 await page.getByRole('button',{name:'保存',exact:true}).click();assert.match(await page.locator('.introduction-confirm h2').textContent(),/本文が白紙/);
 await page.getByRole('button',{name:'キャンセル',exact:true}).last().click();assert.equal(await page.locator('.profile-introduction').count(),1);assert.equal(await page.locator('#introduction-body').inputValue(),'<b> \n</b>');
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('button',{name:'削除する',exact:true}).click();await page.getByText('まだ紹介文はありません。').waitFor();assert.equal(await page.evaluate(()=>window.writes.length),2);
 await page.getByRole('button',{name:'紹介文を書く',exact:true}).click();await page.locator('#introduction-body').fill('new');
 await page.evaluate(()=>window.switchIdentity());assert.equal(await page.getByRole('button',{name:'保存',exact:true}).isEnabled(),false);assert.equal(await page.evaluate(()=>window.writes.length),2);
 // Leave no dirty draft for navigation. Account invalidation keeps it available until explicit cancel.
 await page.getByRole('button',{name:'キャンセル',exact:true}).first().click();
 for(const mode of ['self','guest','fail']){
  await page.goto(origin+'/?mode='+mode);await page.waitForFunction(()=>window.ready);await page.locator('.profile-introductions summary').click();
  assert.equal(await page.getByRole('button',{name:/紹介文を書く|紹介文を編集する/}).count(),0);
  assert.ok(await page.locator('.battler-card').isVisible());
  if(mode==='guest')await page.getByText('まだ紹介文はありません。').waitFor();
 }
 await page.goto(origin);await page.waitForFunction(()=>window.ready);await page.locator('.profile-introductions summary').click();await page.getByRole('button',{name:'紹介文を書く',exact:true}).click();
 await page.locator('#introduction-body').fill('長い紹介文'.repeat(90));await page.locator('#introduction-image-url').fill(origin+'/image.svg');await page.waitForFunction(()=>document.querySelector('#introduction-image-status').textContent.includes('480×480'));
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('button',{name:'保存する',exact:true}).click();await page.locator('.profile-introduction').waitFor();
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow at ${width}`);
  assert.ok(await page.locator('.profile-introduction .introduction-image').evaluate(n=>n.getBoundingClientRect().width<=480&&n.getBoundingClientRect().right<=innerWidth));
  if(process.env.INTRO_SCREENSHOT_DIR)await page.screenshot({path:process.env.INTRO_SCREENSHOT_DIR+'/introduction-'+width+'.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
