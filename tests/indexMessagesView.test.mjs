import test from 'node:test';
import assert from 'node:assert/strict';
import { mountIndexMessages } from '../js/indexMessagesView.js';
const state=eno=>({ready:true,sessionKnown:true,signedIn:!!eno,accountsResolved:true,accounts:eno?[{eno,name:'name'}]:[],enos:eno?[eno]:[]});
function screen() {
 const nodes=new Map();const create=()=>({value:'',hidden:false,disabled:false,children:[],handlers:{},attributes:{},addEventListener(k,fn){this.handlers[k]=fn;},setAttribute(k,v){this.attributes[k]=v;},append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},focus(){}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,create());return nodes.get(id);};
 let loadData={eno:'1',ownMessage:'元の本文',others:['2','3','4'].map(eno=>({eno,battlerName:'<b>名前</b>',defaultIconUrl:'',message:'他人の本文'}))},fail=false,pending=null,calls=[];
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'user'}}}})},rpc:async(name,args)=>{calls.push(name);if(pending)return new Promise(r=>pending.resolve=r);return {error:fail?{}:null,data:name==='get_index_messages'?loadData:{eno:args.p_eno,message:args.p_message}};}};
 const view=mountIndexMessages({getElementById:get,createElement:create},async()=>client);
 return {get,view,calls,fail(v){fail=v;},empty(){loadData={eno:'1',ownMessage:'',others:[]};},delay(){pending={};return pending;}};
}
const tick=()=>new Promise(r=>setImmediate(r));
const submit=s=>s.get('home-message-form').handlers.submit({preventDefault(){}});
test('real UI display, edit boundary, cancel, save failure retention and success without reroll',async()=>{
 const s=screen();s.view.update(state('1'));await tick();
 assert.equal(s.get('home-message').textContent,'元の本文');assert.equal(s.get('home-messages').children.length,3);
 const row=s.get('home-messages').children[0];assert.equal(row.children[0].href,'profile.html?eno=2');assert.equal(row.children[1].children[0].textContent,'ENo.2｜<b>名前</b>');
 s.get('home-message-edit').handlers.click();assert.equal(s.get('home-message-input').value,'元の本文');
 const input=s.get('home-message-input');input.value='😀'.repeat(60);input.handlers.input();assert.equal(s.get('home-message-save').disabled,false);
 input.value+='😀';input.handlers.input();assert.equal(s.get('home-message-save').disabled,true);await submit(s);assert.equal(s.calls.length,1);
 s.get('home-message-cancel').handlers.click();assert.equal(s.get('home-message-form').hidden,true);assert.equal(s.get('home-message').textContent,'元の本文');
 s.get('home-message-edit').handlers.click();input.value='新しい本文';s.fail(true);await submit(s);assert.equal(input.value,'新しい本文');assert.equal(s.get('home-message-form').hidden,false);assert.match(s.get('home-message-status').textContent,/保存できません/);
 s.fail(false);await submit(s);assert.equal(s.get('home-message').textContent,'新しい本文');assert.equal(s.get('home-message-form').hidden,true);assert.equal(s.calls.filter(n=>n==='get_index_messages').length,1);
 s.get('home-message-edit').handlers.click();input.value='　 \n';await submit(s);assert.equal(s.get('home-message').textContent,'ひとことはまだありません。');
});
test('empty/load failure isolated to cards; late load and double save ignored',async()=>{
 const s=screen();s.empty();s.view.update(state('1'));await tick();assert.equal(s.get('home-message').textContent,'ひとことはまだありません。');
 s.view.update(state(null));s.fail(true);s.view.update(state('1'));await tick();assert.match(s.get('home-message').textContent,/読み込めません/);assert.equal(s.get('home-message-edit').disabled,true);
 s.view.update(state(null));s.fail(false);const p=s.delay();s.view.update(state('1'));await tick();s.view.update(state(null));p.resolve({data:{eno:'1',ownMessage:'old',others:[]}});await tick();assert.equal(s.get('home-message').textContent,'');
 const t=screen();t.view.update(state('1'));await tick();t.get('home-message-edit').handlers.click();const q=t.delay();const first=submit(t);await tick();await submit(t);assert.equal(t.calls.filter(n=>n==='set_index_message').length,1);
 t.view.update(state(null));q.resolve({data:{eno:'1',message:'元の本文'}});await first;assert.equal(t.get('home-message').textContent,'');
});

test('account switch rejects old account load even if it completes after new account',async()=>{
 const nodes=new Map();const el=()=>({value:'',handlers:{},addEventListener(k,f){this.handlers[k]=f;},setAttribute(){},replaceChildren(){},focus(){}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,el());return nodes.get(id);};const pending=new Map();
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'user'}}}})},rpc:(_,args)=>new Promise(resolve=>pending.set(args.p_eno,resolve))};
 const view=mountIndexMessages({getElementById:get},async()=>client);
 view.update(state('1'));await tick();view.update(state('2'));await tick();
 pending.get('2')({data:{eno:'2',ownMessage:'new account',others:[]}});await tick();
 pending.get('1')({data:{eno:'1',ownMessage:'old account',others:[]}});await tick();
 assert.equal(get('home-message').textContent,'new account');
});
