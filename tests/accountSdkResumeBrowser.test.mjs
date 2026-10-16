import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
let chromium;if(process.env.PLAYWRIGHT_MODULE)({chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)));
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
// Example (scratch directory outside the repository):
// npm install --prefix /tmp/auth-sdk @supabase/supabase-js@2.117.2 esbuild@0.25.12
// /tmp/auth-sdk/node_modules/.bin/esbuild /tmp/auth-sdk/node_modules/@supabase/supabase-js/dist/index.mjs --bundle --format=esm --platform=browser --outfile=/tmp/auth-sdk/sdk.js
// SUPABASE_SDK_BUNDLE=/tmp/auth-sdk/sdk.js PLAYWRIGHT_MODULE=... BROWSER_EXECUTABLE=... node --test tests/accountSdkResumeBrowser.test.mjs
// Only HTTP responses are mocked: SDK storage, refresh, auth locks and broadcasts are real.
test('real Supabase SDK: refresh, cross-tab storage, BFCache and stale request isolation',
 {skip:(!chromium||!process.env.SUPABASE_SDK_BUNDLE)&&'Set PLAYWRIGHT_MODULE and SUPABASE_SDK_BUNDLE',timeout:60000},async()=>{
 const root=new URL('../',import.meta.url),calls=[];let refresh=0,offline=false,origin,browser;
 const user=n=>({id:uuid(n),email:`eno-${n}@auth.diesduck.invalid`,aud:'authenticated',role:'authenticated',created_at:'2026-01-01T00:00:00Z'});
 const session=n=>{
  const exp=Math.floor(Date.now()/1000)+3600;
  const jwt=[{alg:'HS256',typ:'JWT'},{sub:uuid(n),exp,role:'authenticated',nonce:refresh}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.signature';
  return {access_token:jwt,refresh_token:`refresh-${n}-${refresh}`,expires_in:3600,expires_at:exp,token_type:'bearer',user:user(n)};
 };
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost'),path=url.pathname;let body,type='text/javascript';
  if(path.startsWith('/auth/')||path.startsWith('/rest/')){
   const token=req.headers.authorization?.slice(7),id=token?.includes('.')&&JSON.parse(Buffer.from(token.split('.')[1],'base64url')).sub;
   const n=typeof id==='string'?Number(id.slice(-12)):1;calls.push({path,n});type='application/json';
   if(path==='/auth/v1/user'){
    if(offline){res.writeHead(503,{'Content-Type':type});res.end(JSON.stringify({msg:'offline'}));return;}
    body=JSON.stringify(user(n));
   }else if(path==='/auth/v1/token'){refresh++;body=JSON.stringify(session(n));}
   else if(path==='/rest/v1/game_account_access')body=JSON.stringify([{game_account_id:uuid(100+n),game_accounts:{eno:String(n),battlers:{presentation:{name:'Owner'+n}}}}]);
   else body=JSON.stringify({ok:true});
  }else if(path==='/sdk.js')body=await readFile(process.env.SUPABASE_SDK_BUNDLE);
  else if(path==='/js/supabasePublicConfig.js')body=`export const supabasePublicConfig={url:${JSON.stringify(origin)},publishableKey:'local-test-key'};`;
  else if(path==='/protected.html'){
   type='text/html';body='<html><head><link rel="stylesheet" href="/css/common-menu.css"></head><body class="auth-required-pending"><main>Private page</main><script type="module" src="/probe.js"></script></body></html>';
  }else if(path==='/probe.js')body=`import {getAuthRuntime} from '/js/authRuntime.js';import {requireLoginPage} from '/js/authPageGuard.js';window.documentId=Math.random();window.auth=await getAuthRuntime();window.states=[];auth.subscribe(s=>states.push({known:s.sessionKnown,signedIn:s.signedIn,phase:s.authPhase}));await requireLoginPage();window.admitted=true;`;
  else if(path==='/away.html'||path==='/index.html'){type='text/html';body='<html><body>Public page</body></html>';}
  else if(/^\/[\w./-]+$/.test(path)&&!path.includes('..')){
   body=await readFile(new URL(path.slice(1),root));type=path.endsWith('.css')?'text/css':'text/javascript';
   if(['/js/accountRuntime.js','/js/supabaseClients.js'].includes(path))body=body.toString().replaceAll('https://esm.sh/@supabase/supabase-js@2.117.2?bundle','/sdk.js');
  }else throw Error();
  res.writeHead(200,{'Content-Type':type,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'"});res.end(body);
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--disable-back-forward-cache'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const context=await browser.newContext();await context.addInitScript(({sessions,entries})=>{
   if(!localStorage.getItem('seeded')){
    localStorage.setItem('seeded','1');localStorage.setItem('diesduck-account-sessions-v1',JSON.stringify({version:1,entries,active:entries[0].slot,pending:[]}));
    entries.forEach((entry,i)=>localStorage.setItem('diesduck-auth-account-v1-'+entry.slot,JSON.stringify(sessions[i])));
   }
   addEventListener('pageshow',e=>{if(e.persisted)window.wasCached=true;});
  },{sessions:[session(1),session(2)],entries:[1,2].map(n=>({slot:uuid(n),eno:String(n),name:'Owner'+n}))});
  const page=await context.newPage(),ready=()=>page.waitForFunction(()=>window.admitted&&window.auth?.snapshot().signedIn&&!document.body.classList.contains('auth-required-pending'));
  await page.goto(origin+'/protected.html');await ready();assert.ok(calls.length>0);assert.ok(calls.every(c=>c.n===1));
  const documentId=await page.evaluate(()=>window.documentId);
  await page.goto(origin+'/away.html');await page.goBack({waitUntil:'commit'});await ready();
  assert.equal(await page.evaluate(()=>window.wasCached),true);assert.equal(await page.evaluate(()=>window.documentId),documentId);
  await page.evaluate(async()=>{window.oldLease=auth.runtime.getCurrent();window.scoped=auth.getClient();const result=await oldLease.client.auth.refreshSession();if(result.error)throw result.error;});await ready();
  assert.equal(await page.evaluate(()=>oldLease.isCurrent()),false);assert.equal(await page.evaluate(()=>scoped.accountContext.isCurrent()),true);assert.equal(refresh,1);
  const other=await context.newPage();await other.goto(origin+'/protected.html');await other.waitForFunction(()=>window.auth?.snapshot().signedIn);
  const before=calls.length;
  await other.evaluate(async()=>{const result=await auth.runtime.getCurrent().client.auth.refreshSession();if(result.error)throw result.error;});
  await page.waitForFunction(()=>states.some(s=>s.phase==='suspended'));await ready();assert.ok(calls.length>before);assert.equal(refresh,2);
  assert.equal(await page.evaluate(()=>window.documentId),documentId);assert.ok(calls.every(c=>c.n===1));
  offline=true;await page.evaluate(()=>auth.retry());assert.equal(await page.evaluate(()=>auth.snapshot().sessionKnown),false);assert.equal(await page.evaluate(()=>auth.snapshot().retryable),true);assert.match(page.url(),/protected.html$/);
  offline=false;await page.evaluate(()=>auth.retry());await ready();
  await other.evaluate(()=>auth.runtime.logoutGame());await page.waitForURL(/index.html/,{waitUntil:'commit'});
  await context.close();
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
