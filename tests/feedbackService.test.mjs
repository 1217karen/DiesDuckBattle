import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeedbackService,decodeFeedbackList,decodeFeedbackReplies,validateFeedbackInput,selectFeedback} from '../js/feedbackService.js';
const id='00000000-0000-4000-8000-000000000001';
const row={id,category:'bug',title:'t',body:'b',status:'open',createdAt:'2026-10-09T00:00:00Z',reactionCount:0,replyCount:0,isOwn:false,hasReacted:false};
const list={threads:[row],canPost:false,isModerator:false};
const reply={id,body:'r',createdAt:row.createdAt,isAuthor:false,isModerator:false};
const tick=()=>new Promise(r=>setImmediate(r));
test('strict public DTO allowlists reject identities, invalid types and oversized Unicode',()=>{
 assert.deepEqual(decodeFeedbackList(list),list);assert.deepEqual(decodeFeedbackReplies([reply]),[reply]);
 for(const key of ['auth_user_id','game_account_id','authUserId','eno','hidden_at']){
  assert.throws(()=>decodeFeedbackList({...list,threads:[{...row,[key]:'secret'}]}));
  assert.throws(()=>decodeFeedbackReplies([{...reply,[key]:'secret'}]));
 }
 for(const bad of [{...row,status:'bad'},{...row,category:'bad'},{...row,reactionCount:-1},{...row,isOwn:'true'},{...row,body:'😀'.repeat(2001)}])assert.throws(()=>decodeFeedbackList({...list,threads:[bad]}));
 validateFeedbackInput({category:'question',title:'😀'.repeat(100),body:'😀'.repeat(2000)});
 for(const body of ['',' \n','😀'.repeat(2001)])assert.throws(()=>validateFeedbackInput({body},true));
 assert.throws(()=>validateFeedbackInput({category:'bug',title:'😀'.repeat(101),body:'b'}));
});
test('filters and ordering do not mutate input; same-count ties use newest first',()=>{
 const rows=[row,{...row,id:id.replace(/1$/,'2'),category:'request',status:'withdrawn',reactionCount:2,createdAt:'2026-10-10T00:00:00Z'}];
 assert.equal(selectFeedback(rows)[0].id,rows[1].id);assert.equal(selectFeedback(rows,'bug').length,1);
 assert.equal(selectFeedback(rows,'all','withdrawn')[0].category,'request');assert.equal(selectFeedback(rows,'all','all','reactions')[0].reactionCount,2);
 assert.equal(rows[0],row);
});
function fixture(){
 let session=null, pending, response=list, calls=[], changed=0, callback;
 const client={auth:{getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{callback=fn;return {data:{subscription:{unsubscribe(){}}}};}},rpc:async(name,args)=>{calls.push([name,args]);return pending?new Promise(r=>pending.resolve=r):{data:response};}};
 const service=createFeedbackService(client,()=>changed++);
 return {service,calls,set(v){session=v?{user:{id:v},access_token:v}:null;},response(v){response=v;},delay(){pending={};return pending;},event(name='SIGNED_OUT'){callback(name);},get changed(){return changed;}};
}
test('anonymous read works while every service mutation rejects before RPC',async()=>{
 const f=fixture();assert.equal((await f.service.list()).ok,true);f.response([reply]);assert.equal((await f.service.replies(id)).ok,true);
 const before=f.calls.length;
 for(const action of [()=>f.service.create('1',{category:'bug',title:'t',body:'b'}),()=>f.service.reply('1',id,'b'),()=>f.service.react('1',id),()=>f.service.withdraw('1',id),()=>f.service.status(id,'confirmed'),()=>f.service.hide(id)])assert.equal((await action()).ok,false);
 assert.equal(f.calls.length,before);
});
test('authenticated request arguments and successful mutation responses',async()=>{
 const f=fixture();f.set('a');f.response(id);assert.equal((await f.service.create('1',{category:'request',title:' t ',body:' b '})).ok,true);
 assert.deepEqual(f.calls[0],['create_feedback_thread',{p_eno:'1',p_category:'request',p_title:'t',p_body:'b'}]);
 assert.equal((await f.service.reply('1',id,'補足')).ok,true);
 f.response({hasReacted:true,reactionCount:1});assert.equal((await f.service.react('1',id)).data.hasReacted,true);
 f.response(true);assert.equal((await f.service.withdraw('1',id)).ok,true);assert.equal((await f.service.status(id,'confirmed')).ok,true);assert.equal((await f.service.hide(id,id)).ok,true);
 const before=f.calls.length;assert.equal((await f.service.status(id,'withdrawn')).ok,false);assert.equal((await f.service.reply('1',id,'😀'.repeat(2001))).ok,false);assert.equal(f.calls.length,before);
});
test('user switch, login from anon, logout/login ABA and account invalidation discard late responses',async()=>{
 for(const scenario of ['switch','anon-login','ABA','invalidate']){
  const f=fixture();if(scenario!=='anon-login')f.set('a');const delay=f.delay();
  const request=f.service.list();await tick();
  if(scenario==='switch'||scenario==='anon-login')f.set('b');
  if(scenario==='ABA'){f.event();f.event('SIGNED_IN');}
  if(scenario==='invalidate')f.service.invalidate();
  delay.resolve({data:list});const result=await request;assert.equal(result.ok,false);assert.equal(result.stale,true);
 }
});
test('null ENo can be sent for moderator reply only; user operations reject it',async()=>{
 const f=fixture();f.set('operator');f.response(id);assert.equal((await f.service.reply(null,id,'運営返信')).ok,true);
 assert.equal(f.calls[0][1].p_eno,null);const before=f.calls.length;
 for(const fn of [()=>f.service.create(null,{category:'bug',title:'t',body:'b'}),()=>f.service.react(null,id),()=>f.service.withdraw(null,id)])assert.equal((await fn()).ok,false);
 assert.equal(f.calls.length,before);
});
test('session loss during mutation never accepts success or retries toggle',async()=>{
 const f=fixture();f.set('a');const delay=f.delay();const request=f.service.react('1',id);await tick();f.set(null);delay.resolve({data:{hasReacted:true,reactionCount:1}});
 assert.equal((await request).stale,true);assert.equal(f.calls.length,1);
});
