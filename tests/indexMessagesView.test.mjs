import test from 'node:test';
import assert from 'node:assert/strict';
import { mountIndexMessages } from '../js/indexMessagesView.js';
const state=eno=>({ready:true,sessionKnown:true,signedIn:!!eno,accountsResolved:true,accounts:eno?[{eno,name:'name'}]:[],enos:eno?[eno]:[]});
function classList() {
 const classes=new Set();
 return {toggle(name,on){if(on)classes.add(name);else classes.delete(name);},remove(name){classes.delete(name);},contains(name){return classes.has(name);}};
}
function screen() {
 const nodes=new Map();const create=(tag='div')=>({tagName:tag,value:'',hidden:false,disabled:false,children:[],handlers:{},attributes:{},dataset:{},classList:classList(),addEventListener(k,fn){this.handlers[k]=fn;},setAttribute(k,v){this.attributes[k]=v;},append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},showModal(){this.open=true;},close(){this.open=false;},querySelector(q){const key=q.split('"')[1];return this.children.find(e=>e.dataset?.slot===key)??null;},focus(){}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,create());return nodes.get(id);};
 let loadData={eno:'1',ownMessage:'元の本文',ownIconSlot:null,ownDefaultIconUrl:'/default.png',
   ownIconSlots:['/slot1.png','/slot2.png'],others:['2','3','4'].map((eno,i)=>({eno,battlerName:'<b>名前</b>',
      defaultIconUrl:i===2?'':'/other-default.png',iconUrl:i===1?'/other-slot.png':'',message:'他人の本文'}))},fail=false,pending=null,calls=[],sent=[];
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'user'}}}})},rpc:async(name,args)=>{calls.push(name);sent.push({name,args});if(pending)return new Promise(r=>pending.resolve=r);return {error:fail?{}:null,data:name==='get_index_messages_v2'?loadData:{eno:args.p_eno,message:args.p_message,iconSlot:args.p_icon_slot}};}};
 const notices=[],iconChanges=[];const view=mountIndexMessages({getElementById:get,createElement:create},async()=>client,n=>notices.push(n),slot=>iconChanges.push(slot));
 return {get,view,calls,sent,notices,iconChanges,fail(v){fail=v;},empty(){loadData={eno:'1',ownMessage:'',ownIconSlot:null,ownDefaultIconUrl:'/default.png',ownIconSlots:['/slot1.png','/slot2.png'],others:[]};},delay(){pending={};return pending;}};
}
const tick=()=>new Promise(r=>setImmediate(r));
const submit=s=>s.get('home-message-form').handlers.submit({preventDefault(){}});
test('real UI display, edit boundary, cancel, save failure retention and success without reroll',async()=>{
 const s=screen();s.view.update(state('1'));await tick();
 assert.equal(s.get('home-message').textContent,'元の本文');assert.equal(s.get('home-messages').children.length,3);
 const row=s.get('home-messages').children[0];assert.equal(row.children[0].href,'profile.html?eno=2');assert.equal(row.children[1].children[0].textContent,'ENo.2｜<b>名前</b>');
  assert.equal(row.children[0].children[0].src,'/other-default.png','Unselected icon uses the battler default');
  assert.equal(s.get('home-messages').children[1].children[0].children[0].src,'/other-slot.png','Chosen slot takes priority');
  assert.equal(s.get('home-messages').children[2].children[0].children[0].src,'/img/B00_icon.png','Both empty uses fixed fallback');
 s.get('home-message-edit').handlers.click();assert.equal(s.get('home-message-input').value,'元の本文');
  assert.equal(s.get('home-message-icon-preview').src,'/default.png','Own default icon appears in picker preview');
 const input=s.get('home-message-input');input.value='😀'.repeat(60);input.handlers.input();assert.equal(s.get('home-message-save').disabled,false);
 input.value+='😀';input.handlers.input();assert.equal(s.get('home-message-save').disabled,true);await submit(s);assert.equal(s.calls.length,1);
 s.get('home-message-cancel').handlers.click();assert.equal(s.get('home-message-form').hidden,true);assert.equal(s.get('home-message').textContent,'元の本文');
 s.get('home-message-edit').handlers.click();input.value='新しい本文';s.fail(true);await submit(s);assert.equal(input.value,'新しい本文');assert.equal(s.get('home-message-form').hidden,false);assert.match(s.get('home-message-status').textContent,/保存できません/);
 assert.deepEqual(s.notices,[]);s.fail(false);await submit(s);assert.deepEqual(s.notices,[{message:"ひとことを保存しました。",kind:"success"}]);assert.equal(s.get('home-message').textContent,'新しい本文');assert.equal(s.get('home-message-form').hidden,true);assert.equal(s.calls.filter(n=>n==='get_index_messages_v2').length,1);
 s.get('home-message-edit').handlers.click();input.value='　 \n';await submit(s);assert.equal(s.get('home-message').textContent,'右のペンマークからひとことを編集できます。');
 assert.equal(s.get('home-message').classList.contains('is-placeholder'),true);
});
test('empty/load failure isolated to cards; late load and double save ignored',async()=>{
 const s=screen();s.empty();s.view.update(state('1'));await tick();assert.equal(s.get('home-message').textContent,'右のペンマークからひとことを編集できます。');
 assert.equal(s.get('home-message').classList.contains('is-placeholder'),true);
 assert.equal(s.get('home-messages-status').textContent,'ひとことはまだありません。');
 s.view.update(state(null));s.fail(true);s.view.update(state('1'));await tick();assert.match(s.get('home-message').textContent,/読み込めません/);assert.equal(s.get('home-message-edit').disabled,true);
 assert.equal(s.get('home-message').classList.contains('is-placeholder'),false);
 s.view.update(state(null));s.fail(false);const p=s.delay();s.view.update(state('1'));await tick();s.view.update(state(null));p.resolve({data:{eno:'1',ownMessage:'old',ownIconSlot:null,ownDefaultIconUrl:'',ownIconSlots:[],others:[]}});await tick();assert.equal(s.get('home-message').textContent,'');
 const t=screen();t.view.update(state('1'));await tick();t.get('home-message-edit').handlers.click();const q=t.delay();const first=submit(t);await tick();await submit(t);assert.equal(t.calls.filter(n=>n==='set_index_message_v2').length,1);
 t.view.update(state(null));q.resolve({data:{eno:'1',message:'元の本文',iconSlot:null}});await first;assert.equal(t.get('home-message').textContent,'');assert.deepEqual(t.notices,[]);
});

test('account switch rejects old account load even if it completes after new account',async()=>{
 const nodes=new Map();const el=()=>({value:'',handlers:{},classList:classList(),addEventListener(k,f){this.handlers[k]=f;},setAttribute(){},replaceChildren(){},focus(){}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,el());return nodes.get(id);};const pending=new Map();
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'user'}}}})},rpc:(_,args)=>new Promise(resolve=>pending.set(args.p_eno,resolve))};
 const view=mountIndexMessages({getElementById:get},async()=>client);
 view.update(state('1'));await tick();view.update(state('2'));await tick();
 pending.get('2')({data:{eno:'2',ownMessage:'new account',ownIconSlot:null,ownDefaultIconUrl:'',ownIconSlots:[],others:[]}});await tick();
 pending.get('1')({data:{eno:'1',ownMessage:'old account',ownIconSlot:null,ownDefaultIconUrl:'',ownIconSlots:[],others:[]}});await tick();
 assert.equal(get('home-message').textContent,'new account');
});

test('placeholder class follows empty saves and is removed for actual text, including matching guidance text',async()=>{
 const s=screen();s.empty();s.view.update(state('1'));await tick();
 const text=s.get('home-message'), input=s.get('home-message-input');
 assert.equal(text.classList.contains('is-placeholder'),true);
 for(const value of ['実際のひとこと','右のペンマークからひとことを編集できます。']) {
  s.get('home-message-edit').handlers.click();input.value=value;await submit(s);
  assert.equal(text.textContent,value);assert.equal(text.classList.contains('is-placeholder'),false);
 }
 s.get('home-message-edit').handlers.click();input.value='';await submit(s);
 assert.equal(text.textContent,'右のペンマークからひとことを編集できます。');
 assert.equal(text.classList.contains('is-placeholder'),true);
 s.view.update(state(null));assert.equal(text.classList.contains('is-placeholder'),false);
});
test('switch guard preserves unsaved home message and does not ask to discard',async()=>{
 const s=screen();s.view.update(state('1'));await tick();s.get('home-message-edit').handlers.click();s.get('home-message-input').value='保存前のひとこと';
 const prior=globalThis.confirm;globalThis.confirm=()=>assert.fail('discard prompt');
 try{assert.equal(s.view.canLeave({action:'select'}).ok,false);}finally{globalThis.confirm=prior;}
 assert.equal(s.get('home-message-input').value,'保存前のひとこと');assert.match(s.get('home-message-status').textContent,/保存してから/);
 s.get('home-message-cancel').handlers.click();assert.equal(s.view.canLeave({action:'select'}),true);
});

test('home icon picker chooses configured slot, preserves cancel, and sends only numeric slot',async()=>{
 const s=screen();s.view.update(state('1'));await tick();
 s.get('home-message-edit').handlers.click();
 s.get('home-message-icon-button').handlers.click();
 const choices=s.get('home-picker-list').children;
 assert.equal(choices.length,11);
 assert.equal(choices[0].dataset.slot,'default');
 assert.equal(choices[2].dataset.slot,'2');
 assert.equal(choices[3].disabled,true);
 choices[2].handlers.click();
 assert.equal(s.get('home-message-icon-preview').src,'/slot2.png');
 assert.equal(s.sent.length,1);
 s.get('home-message-cancel').handlers.click();
 assert.equal(s.iconChanges.at(-1),null);
 s.get('home-message-edit').handlers.click();
 s.get('home-message-icon-button').handlers.click();
 s.get('home-picker-list').children[2].handlers.click();
 await submit(s);
 assert.equal(s.sent.at(-1).name,'set_index_message_v2');
 assert.equal(s.sent.at(-1).args.p_icon_slot,2);
 assert.equal(s.iconChanges.at(-1),2);
 s.get('home-message-edit').handlers.click();
 s.get('home-message-icon-button').handlers.click();
 s.get('home-picker-list').children[0].handlers.click();
 await submit(s);
 assert.equal(s.sent.at(-1).args.p_icon_slot,null);
 assert.equal(s.iconChanges.at(-1),null);
});
