import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
let chromium;if(process.env.PLAYWRIGHT_MODULE)({chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)));
const root=new URL('../',import.meta.url);
const mockRuntime=`
import { createAuthController } from '/js/authController.js';
const target={authUserId:'00000000-0000-4000-8000-000000000001',gameAccountId:'00000000-0000-4000-8000-000000000002',eno:'12',name:'テスト用バトラーの長い名前です'};
let session={user:{id:target.authUserId}},watch;
window.mock={calls:[],mode:'normal'};
sessionStorage.removeItem('deletion-mock-result');
const client={auth:{getSession:async()=>({data:{session}}),signOut:async()=>{session=null;watch(null,'SIGNED_OUT');sessionStorage.setItem('deletion-mock-result','signed-out');return {}; }},
 rpc:async(name,args)=>{window.mock.calls.push(name);await new Promise(r=>setTimeout(r,80));
  if(name==='prepare_account_deletion')return {data:target};
  if(window.mock.mode==='offline')throw Error('mock offline');
  return {data:{deleted:true,...target}};
 }};
const controller=createAuthController({watch(fn){watch=fn;return ()=>{};},session:async()=>session,accounts:async()=>[{eno:target.eno,name:target.name}],logout:async()=>client.auth.signOut()},()=>{});
void controller.start();
export async function getAuthRuntime(){return controller;}
export async function getSupabaseClient(){return client;}
`;
test('real browser desktop/mobile: menu, both confirmations, cancellation, errors and local cleanup (mock only)',
  {skip:!chromium&&'Set PLAYWRIGHT_MODULE and optionally BROWSER_EXECUTABLE'},async()=>{
  const setting=await readFile(new URL('setting.html',root),'utf8');
  const header=setting.match(/<header id="common-menu"[\s\S]*?<\/header>/)[0];
  const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/common-menu.css"><body class="has-common-menu">${header}<main>隔離された削除モック</main><script type="module" src="/fixture.js"></script></body></html>`;
  const server=createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    try {
      let content,type='text/javascript';
      if(pathname==='/fixture.html'){content=html;type='text/html';}
      else if(pathname==='/index.html'){content='<h1>モックのトップページ</h1>';type='text/html';}
      else if(pathname==='/fixture.js')content=`import '/js/commonMenu.js';import {requireLoginPage} from '/js/authPageGuard.js';await requireLoginPage();window.ready=true;`;
      else if(pathname==='/js/authRuntime.js')content=mockRuntime;
      else if(pathname==='/js/accountSwitchingConfig.js')content='export const ACCOUNT_SWITCHING_ENABLED=false;';
      else if(/^\/(js|css|supabase\/functions\/_shared)\/[\w./-]+$/.test(pathname)&&!pathname.includes('..')){
        content=await readFile(new URL(pathname.slice(1),root));if(pathname.endsWith('.css'))type='text/css';
      } else {res.writeHead(404);res.end();return;}
      res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'"});res.end(content);
    }catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
    for(const [label,viewport] of [['desktop',{width:1280,height:900}],['mobile',{width:390,height:844}]]){
      const context=await browser.newContext({viewport,isMobile:label==='mobile',hasTouch:label==='mobile'});
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+'/fixture.html');await page.waitForFunction(()=>window.ready);
      const open=async()=>{
        if(!await page.locator('.common-menu__account').evaluate(n=>n.open))await page.locator('.common-menu__account > summary').click();
        await page.getByRole('button',{name:'アカウントを削除',exact:true}).click();await page.locator('dialog[open]').waitFor({state:'visible'});
      };
      const final=async()=>{await open();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'削除する',exact:true}).click();};
      const checkBounds=async()=>{
        const rect=await page.locator('dialog[open]').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=viewport.width+1);
        assert.ok(rect.y>=0&&rect.y+rect.height<=viewport.height+1);
        assert.equal(await page.locator('dialog[open]').evaluate(n=>n.scrollWidth<=n.clientWidth),true);
      };
      await open();assert.equal(await page.getByRole('button',{name:'削除する',exact:true}).isEnabled(),false);await checkBounds();
      if(process.env.ACCOUNT_DELETION_ARTIFACT_DIR){await mkdir(process.env.ACCOUNT_DELETION_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.ACCOUNT_DELETION_ARTIFACT_DIR,`deletion-${label}-consent.png`)});}
      await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});assert.equal(await page.locator('dialog').count(),0);
      await final();await checkBounds();assert.equal(await page.evaluate(()=>window.mock.calls.filter(n=>n==='delete_own_account').length),0);
      if(process.env.ACCOUNT_DELETION_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.ACCOUNT_DELETION_ARTIFACT_DIR,`deletion-${label}-final.png`)});
      await page.getByRole('button',{name:'キャンセル',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});assert.equal(await page.locator('dialog').count(),0);
      await final();await page.evaluate(()=>window.mock.mode='offline');
      await page.getByRole('button',{name:'削除を実行'}).evaluate(n=>{n.click();n.click();});
      await page.getByRole('heading',{name:'削除結果の確認'}).waitFor();assert.equal(await page.evaluate(()=>window.mock.calls.filter(n=>n==='delete_own_account').length),1);
      assert.match(await page.locator('dialog[open]').innerText(),/削除結果を確認できません/);assert.ok(page.url().endsWith('fixture.html'));
      await page.getByRole('button',{name:'閉じる',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});await page.evaluate(()=>window.mock.mode='normal');
      await final();await page.getByRole('button',{name:'削除を実行'}).click();
      await page.getByRole('heading',{name:'モックのトップページ',exact:true}).waitFor();assert.ok(page.url().endsWith('/index.html?notice=account-deleted')); assert.equal(await page.evaluate(()=>sessionStorage.getItem('deletion-mock-result')),'signed-out');
      assert.deepEqual(errors,[]);await context.close();
    }
  }finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
