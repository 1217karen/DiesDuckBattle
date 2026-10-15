import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoticeReadState, NOTICE_READ_KEY } from '../js/noticeReadState.js';
import { mountNoticeIndicators } from '../js/noticeIndicators.js';
import { Element } from './feedbackDomFixture.mjs';
function storage() { const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values}; }
test('IDs persist across reloads; additions alone are unread, not reorder, dates or body edits',()=>{
 const disk=storage(), articles=[{id:'a'},{id:'b'}];
 const state=createNoticeReadState({articles,storage:()=>disk});
 assert.equal(state.hasUnread(),true);state.markRead();assert.equal(state.hasUnread(),false);
 assert.deepEqual([...disk.values.keys()],[NOTICE_READ_KEY]);assert.deepEqual(JSON.parse(disk.getItem(NOTICE_READ_KEY)),['a','b']);
 assert.equal(createNoticeReadState({articles:[{id:'b',body:['edited'],date:'2099-01-01'},{id:'a'}],storage:()=>disk}).hasUnread(),false);
 const next=createNoticeReadState({articles:[...articles,{id:'c'}],storage:()=>disk});assert.equal(next.hasUnread(),true);next.markRead();assert.equal(next.hasUnread(),false);
});
test('blocked reads/writes and malformed storage do not prevent use',()=>{
 for(const storage of [()=>{throw Error('blocked');},()=>({getItem:()=>'{',setItem(){throw Error('quota');}}),()=>({getItem:()=>'{"unexpected":true}',setItem(){}})]) {
  const state=createNoticeReadState({articles:[{id:'a'}],storage});assert.equal(state.hasUnread(),true);assert.doesNotThrow(()=>state.markRead());assert.equal(state.hasUnread(),false);
 }
});
test('both menus refresh without duplicate nodes on read, guest/login redraw, storage and pageshow',()=>{
 const disk=storage(), articles=[{id:'a'}], state=createNoticeReadState({articles,storage:()=>disk});
 const doc=new Element('document'), menu=new Element('nav'), home=new Element('a');home.setAttribute('href','notice.html');doc.append(menu,home);
 doc.getElementById=()=>menu;
 doc.querySelectorAll=selector=>{assert.equal(selector,'a[href="notice.html"]');return [home,...menu.children];};
 let mutation;const events={};const win={addEventListener:(name,fn)=>events[name]=fn,removeEventListener:name=>delete events[name],MutationObserver:class {constructor(fn){mutation=fn;}observe(){}disconnect(){}}};
 const link=()=>{const a=new Element('a');a.setAttribute('href','notice.html');return a;};menu.append(link());
 const stop=mountNoticeIndicators(doc,win,state);
 for(let i=0;i<3;i++){menu.replaceChildren(link());mutation();for(const a of [home,menu.children[0]]){assert.equal(a.getAttribute('data-notice-unread'),'true');assert.match(a.getAttribute('aria-label'),/未読/);assert.equal(a.children.length,0);assert.equal(a.getAttribute('href'),'notice.html');}}
 state.markRead();assert.equal(home.getAttribute('data-notice-unread'),'false');
 articles.push({id:'b'});events.pageshow();assert.equal(home.getAttribute('data-notice-unread'),'true');
 createNoticeReadState({articles,storage:()=>disk}).markRead();events.storage({key:NOTICE_READ_KEY});assert.equal(home.getAttribute('data-notice-unread'),'false');
 articles.push({id:'c'});doc.fire('visibilitychange');assert.equal(home.getAttribute('data-notice-unread'),'true');
 doc.removeEventListener=()=>{};stop();
});
