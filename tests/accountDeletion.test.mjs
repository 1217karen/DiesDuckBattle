import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountDeletionService } from '../js/accountDeletionService.js';
import { createAccountDeletionView,deletionAccount } from '../js/accountDeletionView.js';
import { createAuthController } from '../js/authController.js';
import { requireLoginPage } from '../js/authPageGuard.js';
const target={authUserId:'00000000-0000-4000-8000-000000000001',gameAccountId:'00000000-0000-4000-8000-000000000002',eno:'1',name:'バトラー'};
const signed={ready:true,sessionKnown:true,signedIn:true,accountsResolved:true,accounts:[{eno:'1',name:'バトラー'}],busy:''};
const tick=()=>new Promise(r=>setTimeout(r,0));
function serviceFixture(){
  let user=target.authUserId,mode='ok',calls=[],logouts=0;
  const client={auth:{getSession:async()=>({data:{session:user?{user:{id:user}}:null}}),signOut:async()=>{logouts++;if(mode==='cleanup')return {error:{}};user=null;return {};}},
    rpc:async(name,args)=>{calls.push([name,args]);if(mode==='throw')throw Error('secret');if(mode==='switch')user='new-user';
      if(mode==='reject')return {error:{code:'42501'}};if(mode==='failure')return {error:{code:'P0001'}};
      if(mode==='malformed')return {data:{deleted:true}};
      return {data:name==='prepare_account_deletion'?target:{deleted:true,...target}};}};
  return {client,service:createAccountDeletionService(client),calls,get logouts(){return logouts;},user:v=>user=v,mode:v=>mode=v};
}
test('service binds prepared target to identity, ENo, UUID and name; exactly one final RPC',async()=>{
  const f=serviceFixture();assert.deepEqual(await f.service.prepare(signed.accounts[0]),{ok:true,target});
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'prepare_account_deletion');
  assert.equal((await f.service.remove(target)).ok,true);assert.deepEqual(f.calls[1],['delete_own_account',{
    p_game_account_id:target.gameAccountId,p_auth_user_id:target.authUserId,p_eno:'1',p_name:'バトラー'}]);
  assert.equal((await f.service.cleanup(target)).ok,true);assert.equal(f.logouts,1);
});
test('service rejects changed/unknown targets and reports uncertain transport without retry or signout',async()=>{
  for(const mode of ['throw','malformed','reject','failure']){
    const f=serviceFixture();f.mode(mode);const result=await f.service.remove(target);
    assert.equal(result.ok,false);assert.equal(f.calls.length,1);assert.equal(f.logouts,0);
    assert.ok(!result.message.includes('secret'));
    if(mode==='throw'||mode==='malformed')assert.equal(result.status,'unknown');
  }
  const f=serviceFixture();f.user(null);assert.equal((await f.service.remove(target)).ok,false);assert.equal(f.calls.length,0);
  f.user('other');assert.equal((await f.service.cleanup(target)).status,'changed');assert.equal(f.logouts,0);
  f.user(target.authUserId);assert.equal((await f.service.prepare({eno:'1',name:'stale'})).status,'changed');
  f.mode('cleanup');assert.equal((await f.service.cleanup(target)).status,'cleanup');
});

test('matching deletion receipt survives post-delete Auth loss; cleanup never signs out a new user',async()=>{
  const f=serviceFixture();f.mode('switch');assert.equal((await f.service.remove(target)).ok,true);
  assert.equal((await f.service.cleanup(target)).status,'changed');assert.equal(f.logouts,0);
  const g=serviceFixture();let calls=0;g.client.auth.getSession=async()=>{if(++calls>1)throw Error('Auth deleted');return {data:{session:{user:{id:target.authUserId}}}};};
  assert.equal((await g.service.remove(target)).ok,true);assert.equal(calls,1);
});
test('only confirmed single ENo with a known name enables deletion',()=>{
  assert.deepEqual(deletionAccount(signed),signed.accounts[0]);
  for(const patch of [{ready:false},{signedIn:false},{sessionKnown:false},{accountsResolved:false},{busy:'logout'},
    {accounts:[]},{accounts:[...signed.accounts,...signed.accounts]},{accounts:[{eno:'1',name:''}]},{accounts:[{eno:'uuid',name:'x'}]}])
    assert.equal(deletionAccount({...signed,...patch}),null);
});
function ui({failure=false,prepareFailure=false,cleanupFailure=false,switching=false}={}){
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.attributes={};this.classList={add(){}};this.disabled=false;}
    append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
    setAttribute(k,v){this.attributes[k]=v;}
    addEventListener(k,fn){this.handlers[k]=fn;}
    remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}
    showModal(){this.open=true;}focus(){}
    close(){this.open=false;this.handlers.close?.();}
    querySelectorAll(selector){return walk(this).filter(n=>selector==='button, input'&&['button','input'].includes(n.tagName));}
    querySelector(){return walk(this).find(n=>n.attributes.role==='status');}
    set textContent(v){this.text=v;this.children=[];}get textContent(){return (this.text??'')+this.children.map(n=>n.textContent).join('');}
  }
  const walk=n=>[n,...n.children.flatMap(walk)],body=new Element('body');
  globalThis.document={body,createElement:tag=>new Element(tag)};
  let calls=0,cleanups=0,clears=0,navigations=0,forgotten=0,ended=0,gate=null,prepareGate=null;
  const service={prepare:async()=>{if(prepareGate)await prepareGate;return prepareFailure?{ok:false,message:'拒否'}:{ok:true,target};},
    remove:async()=>{calls++;if(gate)await gate;return failure?{ok:false,message:'結果不明'}:{ok:true};},
    cleanup:async()=>{cleanups++;return cleanupFailure&&cleanups===1?{ok:false,status:'cleanup',message:'cleanup failed'}:{ok:true};}};
  const view=createAccountDeletionView({controller:{snapshot:()=>({accountSwitching:switching}),endAccountDeletion(){ended++;},accountDeleted(){forgotten++;}},getService:()=>service,clearCache(){clears++;},navigate(){navigations++;}});
  view.update(signed);body.append(view.launch);
  const dialog=()=>walk(body).find(n=>n.tagName==='dialog');
  const button=text=>walk(dialog()).find(n=>n.tagName==='button'&&n.textContent===text);
  const click=node=>node.handlers.click();
  return {view,dialog,button,click,counts:()=>({calls,cleanups,clears,navigations,forgotten,ended}),gate:v=>gate=v,prepareGate:v=>prepareGate=v,
    async open(){click(view.launch);await tick();},
    consent(){const input=walk(dialog()).find(n=>n.tagName==='input');input.checked=true;input.handlers.change();},
    async final(){await this.open();this.consent();click(button('削除する'));},
  };
}
test('UI consent and second confirmation are mandatory; cancellation and native close never delete',async()=>{
  for(const stop of ['unchecked','first-cancel','escape','native-close','final-cancel']){
    const f=ui();await f.open();assert.equal(f.button('削除する').disabled,true);assert.match(f.dialog().textContent,/過去の戦闘履歴は削除されません/);
    if(stop==='unchecked')f.click(f.button('削除する'));
    if(stop==='first-cancel')f.click(f.button('キャンセル'));
    if(stop==='escape')f.dialog().handlers.cancel({preventDefault(){}});
    if(stop==='native-close')f.dialog().close();
    if(stop==='final-cancel'){f.consent();f.click(f.button('削除する'));assert.match(f.dialog().textContent,/本当に削除しますか/);f.click(f.button('キャンセル'));}
    assert.equal(f.counts().calls,0);assert.equal(f.counts().navigations,0);
  }
});
test('UI final execution locks buttons and Escape, rejects double-click, clears auth only on success',async()=>{
  const f=ui();await f.final();let done;f.gate(new Promise(r=>done=r));const submit=f.button('削除を実行');
  f.click(submit);f.click(submit);await tick();assert.equal(f.counts().calls,1);assert.equal(f.view.busy,true);
  assert.ok(f.dialog().querySelectorAll('button, input').every(n=>n.disabled));
  f.dialog().handlers.cancel({preventDefault(){}});assert.ok(f.dialog());done();await tick();
  assert.equal(f.counts().cleanups,1);assert.equal(f.counts().navigations,1);assert.equal(f.counts().forgotten,1);assert.ok(f.counts().clears>0);
});
test('UI failed/unknown requests show visible errors without success cleanup or retry',async()=>{
  const f=ui({failure:true});await f.final();f.click(f.button('削除を実行'));await tick();
  assert.equal(f.counts().calls,1);assert.equal(f.counts().cleanups,0);assert.equal(f.counts().navigations,0);
  assert.match(f.dialog().textContent,/結果不明/);assert.equal(f.view.busy,false);
  const rejected=ui({prepareFailure:true});await rejected.open();assert.match(rejected.dialog().textContent,/拒否/);assert.equal(rejected.counts().calls,0);
});
test('UI changed scope invalidates both preparation and final dialog; stale response never signs out new user',async()=>{
  const f=ui();await f.final();f.view.update({...signed,accounts:[{eno:'2',name:'別人'}]});assert.equal(f.dialog(),undefined);assert.equal(f.counts().calls,0);
  const q=ui();let done;q.prepareGate(new Promise(r=>done=r));q.click(q.view.launch);q.view.update({...signed,signedIn:false});done();await tick();assert.equal(q.dialog(),undefined);
  const r=ui();await r.final();let finish;r.gate(new Promise(resolve=>finish=resolve));r.click(r.button('削除を実行'));await tick();
  r.view.update({...signed,signedIn:false});finish();await tick();assert.equal(r.counts().cleanups,0);assert.equal(r.counts().navigations,0);
});
test('cleanup failure can retry local signout without a second deletion',async()=>{
  const f=ui({cleanupFailure:true});await f.final();f.click(f.button('削除を実行'));await tick();
  assert.equal(f.counts().calls,1);assert.equal(f.counts().navigations,0);f.click(f.button('ログアウトを完了'));await tick();
  assert.equal(f.counts().calls,1);assert.equal(f.counts().cleanups,2);assert.equal(f.counts().navigations,1);
});
test('protected page waits for deletion cleanup then redirects with deletion notice; pending reads cannot restore cache',async()=>{
  let watch,latest;const redirects=[];
  const auth=createAuthController({watch(fn){watch=fn;return ()=>{};},session:async()=>({user:{id:'user'}}),accounts:async()=>signed.accounts},state=>latest=state);
  await auth.start();await requireLoginPage({getRuntime:async()=>auth,document:{body:{classList:{add(){},remove(){}}}},location:{replace:url=>redirects.push(url)}});
  auth.beginAccountDeletion();watch(null);await tick();assert.deepEqual(redirects,[]);
  await auth.accountDeleted();assert.deepEqual(redirects,['index.html?notice=account-deleted']);assert.equal(latest.signedIn,false);assert.deepEqual(latest.accounts,[]);
});

test('switching-mode cleanup failure releases the account-change guard and offers local recovery only',async()=>{
 const f=ui({cleanupFailure:true,switching:true});await f.final();const endedBefore=f.counts().ended;f.click(f.button('削除を実行'));await tick();
 assert.equal(f.counts().ended,endedBefore+1);assert.equal(f.view.busy,false);assert.equal(f.counts().calls,1);
 f.click(f.button('端末側の処理を完了する'));await tick();assert.equal(f.counts().calls,1);assert.equal(f.counts().cleanups,2);assert.equal(f.counts().navigations,1);
});
