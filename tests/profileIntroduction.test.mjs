import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileIntroductionController } from '../js/profileIntroductionController.js';
import { createProfileIntroductionService, introductionIsBlank } from '../js/profileIntroductionService.js';
import { THEME_PRESETS } from '../js/profileThemeController.js';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
export const introductionRow = () => ({id:a,revision:'1',body:'初回',iconSlot:2,imageUrl:'',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',
  author:{accountId:a,eno:'1',name:'作者',iconUrl:'',defaultIconUrl:'',theme:{...THEME_PRESETS.light}}});
function fixture({records=[introductionRow()],self=false,guest=false}={}) {
 let state,mode='',writes=[],rows=structuredClone(records);
 const writer={ok:true,account:{id:a},authUserId:'user'};
 const service={list:async()=>({ok:true,records:rows}),resolveWriter:async()=>guest?{ok:false}:writer,
  loadWriter:async()=>({...writer,data:{presentation:{battler:{defaultIconUrl:'default',iconSlots:Array(10).fill('')}}}}),
  save:async(...args)=>{writes.push(args);return mode?{ok:false,status:mode,message:mode}:{ok:true,deleted:introductionIsBlank(args[3].body)};}};
 const controller=createProfileIntroductionController({service,targetId:self?a:b,changed:s=>state=s});
 return {controller,service,writes,state:()=>state,mode:v=>mode=v,rows:v=>rows=v};
}
test('self and anonymous are read only; writer opens saved text/slot and new drafts use default',async()=>{
 for(const opts of [{self:true},{guest:true}]){const f=fixture(opts);await f.controller.load();assert.equal(f.state().canWrite,false);await f.controller.open();assert.equal(f.state().active,false);}
 const f=fixture();await f.controller.load();assert.equal(f.state().hasOwn,true);await f.controller.open();assert.equal(f.state().draft.iconSlot,2);assert.equal(f.state().draft.body,'初回');
 const n=fixture({records:[]});await n.controller.load();await n.controller.open();assert.equal(n.state().draft.iconSlot,null);assert.equal(n.state().canSave,false);n.controller.requestSave();assert.equal(n.state().confirmation,'');
});
test('Unicode/tag length and image validation; blank edit is deletion even with invalid image',async()=>{
 const f=fixture();await f.controller.load();await f.controller.open();
 f.controller.change('body','😀'.repeat(501));assert.equal(f.state().canSave,false);f.controller.change('body','😀'.repeat(500));assert.equal(f.state().canSave,true);
 f.controller.imageChanged({status:'loading'});assert.equal(f.state().canSave,false);f.controller.imageChanged({status:'invalid'});assert.equal(f.state().canSave,false);
 f.controller.change('body','<b> \n</b>');f.controller.change('imageUrl','broken');assert.equal(f.state().canSave,true);
 f.controller.requestSave();assert.equal(f.state().confirmation,'delete');f.controller.cancelConfirmation();assert.equal(f.state().confirmation,'');assert.equal(f.state().draft.body,'<b> \n</b>');assert.equal(f.writes.length,0);
 f.controller.requestSave();await f.controller.confirm();assert.equal(f.writes.length,1);assert.equal(f.state().active,false);
});
test('confirmation preserves unsaved draft on cancel; conflicts and unknown outcomes block retry',async()=>{
 for(const mode of ['conflict','save-unknown','forbidden']) {
  const f=fixture();await f.controller.load();await f.controller.open();f.controller.change('body','changed');f.controller.requestSave();
  assert.equal(f.state().confirmation,'save');f.controller.cancelConfirmation();assert.equal(f.state().draft.body,'changed');assert.equal(f.writes.length,0);
  f.mode(mode);f.controller.requestSave();await f.controller.confirm();assert.equal(f.state().blocked,true);assert.equal(f.state().draft.body,'changed');assert.equal(f.state().active,true);
  f.controller.requestSave();await f.controller.confirm();assert.equal(f.writes.length,1);
 }
});
test('account invalidation cancels late open/save and never resumes old writer authority',async()=>{
 const f=fixture();await f.controller.load();let release;f.service.loadWriter=()=>new Promise(r=>release=r);
 const pending=f.controller.open();f.controller.sessionChanged(null);release({ok:true});await pending;assert.equal(f.state().canWrite,false);assert.equal(f.state().blocked,true);
 const g=fixture();await g.controller.load();await g.controller.open();g.controller.change('body','draft');g.controller.requestSave();g.controller.sessionChanged('another');await g.controller.confirm();assert.equal(g.writes.length,0);assert.equal(g.state().draft.body,'draft');
});
test('service re-resolves authenticated author before sending, rejects stale auth and scope',async()=>{
 let identity='user',scope={ok:true,authUserId:'user',account:{id:a}},calls=[];
 const client={auth:{getSession:async()=>({data:{session:{user:{id:identity}}}})},rpc:async(name,p)=>{calls.push(p);return{data:{id:a,revision:'1',deleted:false}};}};
 const storage={resolveAccount:async()=>scope};const service=createProfileIntroductionService(client,storage),writer=structuredClone(scope),draft={body:'x',iconSlot:null,imageUrl:''};
 identity='other';assert.equal((await service.save(writer,b,null,draft)).status,'session-changed');assert.equal(calls.length,0);
 identity='user';scope={...scope,account:{id:b}};assert.equal((await service.save(writer,b,null,draft)).status,'session-changed');assert.equal(calls.length,0);
 scope=writer;assert.equal((await service.save(writer,b,null,draft)).ok,true);assert.equal(calls[0].p_author_account_id,a);
});

test('real account-scoped client admits introduction RPCs and rejects another author or a switched account',async()=>{
 const {environment}=await import('./accountIntegrationFixture.mjs');
 const {createAccountAuthController}=await import('../js/accountAuthController.js');
 const f=environment(),runtime=await f.page().get(),auth=createAccountAuthController({runtime,navigate:()=>{}});
 await auth.start();await auth.login('1','valid');const client=auth.getClient(),account=client.accountContext.account,calls=[];
 runtime.getCurrent().client.rpc=async(name,p)=>{calls.push([name,p]);return {data:true};};
 assert.equal((await client.rpc('list_profile_introductions',{p_target_account_id:b})).data,true);
 assert.equal((await client.rpc('save_profile_introduction',{p_author_account_id:account.gameAccountId,p_target_account_id:b})).data,true);
 assert.equal((await client.rpc('save_profile_introduction',{p_author_account_id:'another',p_target_account_id:b})).error.code,'42501');
 assert.equal(calls.length,2);await auth.login('2','valid');
 assert.equal((await client.rpc('save_profile_introduction',{p_author_account_id:account.gameAccountId,p_target_account_id:b})).error.code,'PGRST301');assert.equal(calls.length,2);
});
