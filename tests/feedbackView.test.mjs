import test from 'node:test';
import assert from 'node:assert/strict';
import {mountFeedbackBoard} from '../js/feedbackView.js';
import {feedbackDocument} from './feedbackDomFixture.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const id='00000000-0000-4000-8000-000000000001';
const row={id,category:'bug',title:'<b>title</b>',body:'body\nline',status:'open',createdAt:'2026-10-09T00:00:00Z',reactionCount:0,replyCount:0,isOwn:true,hasReacted:false};
const logged={ready:true,signedIn:true,eno:'1'},guest={ready:true,signedIn:false,eno:null};
function fixture(){
 const document=feedbackDocument(),get=id=>document.getElementById(id);let threads=[{...row}],moderator=false,fail=false,waitList,waitReply,confirmed=true;
 const calls=[];const ok=data=>({ok:true,data});
 const service={invalidate(){},async list(eno){calls.push('list');return waitList?new Promise(r=>waitList.resolve=r):ok({threads:structuredClone(threads),canPost:!!eno,isModerator:moderator});},
  async replies(){calls.push('replies');return waitReply?new Promise(r=>waitReply.resolve=r):ok([]);},
  async create(_,input){calls.push('create');if(fail)return {ok:false,message:'failed'};threads.unshift({...row,...input,id:id.replace(/1$/,'2')});return ok(id);},
  async reply(){calls.push('reply');threads[0].replyCount++;return ok(id);},
  async react(){calls.push('react');const t=threads[0];t.hasReacted=!t.hasReacted;t.reactionCount=t.hasReacted?1:0;return ok({hasReacted:t.hasReacted,reactionCount:t.reactionCount});},
  async withdraw(){calls.push('withdraw');threads[0].status='withdrawn';return ok(true);},
  async status(_,status){calls.push('status');threads[0].status=status;return ok(true);},async hide(){calls.push('hide');threads=[];return ok(true);}};
 const view=mountFeedbackBoard(document,service,()=>confirmed);
 const find=text=>get('feedback-list').querySelectorAll('button').find(n=>n.textContent===text);
 return {document,get,view,calls,find,threads,fail(v){fail=v;},moderator(){moderator=true;},confirm(v){confirmed=v;},delayList(){return waitList={};},delayReply(){return waitReply={};}};
}
test('anonymous sees safe text and lazy collapsed replies, no writing',async()=>{
 const f=fixture();f.view.updateAuth(guest);await tick();
 assert.equal(f.get('feedback-new').disabled,true);await f.get('feedback-new').fire('click');assert.equal(f.get('feedback-form').hidden,true);
 assert.equal(f.get('feedback-list').querySelector('h2').textContent,'<b>title</b>');
 assert.equal(f.calls.includes('replies'),false);assert.equal(f.find('👍 0').disabled,true);
 const details=f.get('feedback-list').querySelector('details');details.open=true;await details.fire('toggle');await tick();
 assert.equal(f.calls.filter(x=>x==='replies').length,1);assert.equal(f.find('返信を書く'),undefined);assert.equal(f.find('取り下げる'),undefined);
});
test('create validation, failed submit retains draft, successful submit adds card',async()=>{
 const f=fixture();f.view.updateAuth(logged);await tick();await f.get('feedback-new').fire('click');assert.equal(f.get('feedback-form').hidden,false);
 f.get('feedback-category').value='request';f.get('feedback-title').value='😀'.repeat(101);f.get('feedback-body').value='body';
 await f.get('feedback-form').fire('submit');await tick();assert.ok(!f.calls.includes('create'));
 f.get('feedback-title').value='valid';f.fail(true);await f.get('feedback-form').fire('submit');await tick();assert.equal(f.get('feedback-title').value,'valid');assert.equal(f.get('feedback-form').hidden,false);
 f.fail(false);await f.get('feedback-form').fire('submit');await tick();assert.equal(f.get('feedback-list').querySelectorAll('article').length,2);assert.equal(f.get('feedback-form').hidden,true);
});
test('zero replies still has inline editor; reaction state/count and owner withdrawal confirmation',async()=>{
 const f=fixture();f.view.updateAuth(logged);await tick();
 await f.find('👍 0').fire('click');await tick();assert.equal(f.find('👍 1').attrs['aria-pressed'],'true');
 await f.find('👍 1').fire('click');await tick();assert.equal(f.find('👍 0').attrs['aria-pressed'],'false');
 const details=f.get('feedback-list').querySelector('details');details.open=true;await details.fire('toggle');await tick();
 await f.find('返信を書く').fire('click');const form=details.querySelector('form');assert.equal(form.hidden,false);form.querySelector('textarea').value='補足';await form.fire('submit');await tick();assert.ok(f.calls.includes('reply'));
 f.confirm(false);await f.find('取り下げる').fire('click');assert.ok(!f.calls.includes('withdraw'));
 f.confirm(true);await f.find('取り下げる').fire('click');await tick();assert.equal(f.find('取り下げる'),undefined);assert.equal(f.threads[0].status,'withdrawn');
});
test('moderator controls only for allowed status; filters change displayed cards',async()=>{
 const f=fixture();f.moderator();f.view.updateAuth(logged);await tick();assert.ok(f.find('状態を変更'));assert.ok(f.find('投稿を非表示'));
 f.threads[0].status='withdrawn';await f.get('feedback-reload').fire('click');await tick();assert.equal(f.find('状態を変更'),undefined);assert.ok(f.find('投稿を非表示'));
 const radios=f.document.querySelectorAll('input[name="report-type"]');radios.forEach(n=>n.checked=n.value==='request');await radios[0].fire('change');assert.equal(f.get('feedback-list').querySelectorAll('article').length,0);
});
test('withdrawn UI keeps reading but blocks ordinary replies and reaction add/remove; moderator retains reply/hide',async()=>{
 for(const reacted of [false,true]){
  const f=fixture();Object.assign(f.threads[0],{status:'withdrawn',hasReacted:reacted,reactionCount:reacted?1:0});
  f.view.updateAuth(logged);await tick();
  const reaction=f.find(`👍 ${reacted?1:0}`);assert.equal(reaction.disabled,true);await reaction.fire('click');assert.ok(!f.calls.includes('react'));
  assert.equal(f.find('取り下げる'),undefined);assert.equal(f.get('feedback-list').querySelector('h2').textContent,row.title);
  const details=f.get('feedback-list').querySelector('details');details.open=true;await details.fire('toggle');await tick();
  assert.ok(f.calls.includes('replies'));assert.equal(f.find('返信を書く'),undefined);assert.equal(details.querySelector('form'),null);
 }
 const f=fixture();f.threads[0].status='withdrawn';f.moderator();f.view.updateAuth(logged);await tick();
 assert.equal(f.find('状態を変更'),undefined);assert.ok(f.find('投稿を非表示'));assert.equal(f.find('👍 0').disabled,true);
 const details=f.get('feedback-list').querySelector('details');details.open=true;await details.fire('toggle');await tick();
 await f.find('返信を書く').fire('click');const form=details.querySelector('form');form.querySelector('textarea').value='運営の補足';await form.fire('submit');await tick();assert.ok(f.calls.includes('reply'));
});
test('session change clears drafts and permissions and rejects old list/reply completion',async()=>{
 const f=fixture();f.view.updateAuth(logged);await tick();await f.get('feedback-new').fire('click');f.get('feedback-body').value='private draft';
 const pending=f.delayReply(),details=f.get('feedback-list').querySelector('details');details.open=true;await details.fire('toggle');await tick();
 f.view.sessionChanged();assert.equal(f.get('feedback-body').value,'');assert.equal(f.get('feedback-new').disabled,true);assert.equal(f.get('feedback-list').children.length,0);
 pending.resolve({ok:true,data:[]});await tick();assert.equal(f.get('feedback-list').children.length,0);
 const slow=f.delayList();f.view.updateAuth(logged);await tick();f.view.sessionChanged();slow.resolve({ok:true,data:{threads:[row],canPost:true,isModerator:true}});await tick();assert.equal(f.get('feedback-list').children.length,0);assert.equal(f.get('feedback-new').disabled,true);
});
