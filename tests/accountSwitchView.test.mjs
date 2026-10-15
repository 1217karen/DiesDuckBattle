import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountSwitchView} from '../js/accountSwitchView.js';
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 let view,state={ready:true,busy:'',accounts:[],savedAccounts:[{eno:'1',name:'一郎'}],pendingAccounts:[]},answer={ok:false},gate;
 const calls=[];
 const document={activeElement:null,createElement:tag=>new Node(tag)};
 class Node{
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.handlers={};this.value='';this.textContent='';this.isConnected=false;}
  append(...nodes){for(const n of nodes){n.parent=this;n.isConnected=true;this.children.push(n);}}
  replaceChildren(...nodes){for(const n of this.children)n.isConnected=false;this.children=[];this.append(...nodes);}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,f){this.handlers[k]=f;}
  focus(){document.activeElement=this;}
  showModal(){this.open=true;}
  close(){this.open=false;this.handlers.close?.();}
  remove(){this.isConnected=false;this.parent.children=this.parent.children.filter(n=>n!==this);}
 }
 document.body=new Node('body');const menu=new Node('menu'),summary=new Node('summary');document.body.append(menu,summary);
 const controller={snapshot:()=>state,async login(eno,password){calls.push(['login',eno,password]);if(gate)await gate;return answer;},async select(eno){calls.push(['select',eno]);return answer;},logout(){calls.push(['logout']);},cleanupPending(slot){calls.push(['cleanup',slot]);}};
 view=createAccountSwitchView({document,controller,menu,summary,deletion:{busy:false,separator:new Node('hr'),launch:new Node('button'),feedback:new Node('p')}});view.update(state);
 const walk=n=>[n,...n.children.flatMap(walk)],all=()=>walk(document.body),button=label=>all().find(n=>n.tagName==='button'&&n.textContent===label);
 return {view,document,menu,summary,calls,all,button,set(next){state={...state,...next};view.update(state);},answer(result){answer=result;},wait(p){gate=p;},open(){button('＋ 別のアカウントを追加').focus();button('＋ 別のアカウントを追加').handlers.click();},dialog:()=>all().find(n=>n.tagName==='dialog')};
}
test('unselected user can open saved account choices; selected account is disabled and identified',async()=>{
 const f=fixture();assert.ok(f.button('ENo.1｜一郎'));await f.button('ENo.1｜一郎').handlers.click();await tick();assert.deepEqual(f.calls,[['select','1']]);
 f.set({accounts:[{eno:'1',name:'一郎'}]});assert.equal(f.button('ENo.1｜一郎（現在使用中）').disabled,true);assert.equal(f.button('ENo.1｜一郎（現在使用中）').attributes['aria-current'],'true');
});
test('cancel and Escape erase password and restore focus without signing in',()=>{
 for(const escape of [false,true]){const f=fixture();f.open();const password=f.all().find(n=>n.type==='password');password.value='secret';
 if(escape)f.dialog().handlers.cancel({preventDefault(){}});else f.button('キャンセル').handlers.click();
 assert.equal(password.value,'');assert.equal(f.dialog(),undefined);assert.deepEqual(f.calls,[]);assert.equal(f.document.activeElement,f.button('＋ 別のアカウントを追加'));
 }
});
test('submit clears password immediately and prevents repeat submit or close until resolved',async()=>{
 const f=fixture();let release;f.wait(new Promise(r=>release=r));f.open();const fields=f.all().find(n=>n.tagName==='fieldset'),form=f.all().find(n=>n.tagName==='form');
 f.all().find(n=>n.inputMode==='numeric').value='2';const password=f.all().find(n=>n.type==='password');password.value='secret';
 const pending=form.handlers.submit({preventDefault(){}});assert.equal(password.value,'');assert.equal(fields.disabled,true);
 await form.handlers.submit({preventDefault(){}});f.dialog().handlers.cancel({preventDefault(){}});assert.equal(f.dialog().open,true);assert.equal(f.calls.length,1);
 f.set({message:'ログインできません'});release();await pending;assert.equal(fields.disabled,false);assert.ok(f.all().some(n=>n.textContent==='ログインできません'));assert.equal(password.value,'');
});
test('expired selection opens login prefilled with the exact ENo; successful submit closes modal',async()=>{
 const f=fixture();f.answer({ok:false,code:'reauthentication-required'});f.button('ENo.1｜一郎').handlers.click();await tick();
 assert.equal(f.all().find(n=>n.inputMode==='numeric').value,'1');f.answer({ok:true});f.all().find(n=>n.type==='password').value='valid';
 await f.all().find(n=>n.tagName==='form').handlers.submit({preventDefault(){}});assert.equal(f.dialog(),undefined);
});
test('busy state disables account actions and cleanup explicitly names its pending slot',()=>{
 const f=fixture();f.set({pendingAccounts:[{eno:'2',slot:'slot-2'}]});f.button('ENo.2の未完了ログインを清掃').handlers.click();assert.deepEqual(f.calls,[['cleanup','slot-2']]);
 f.set({busy:'select'});assert.ok(f.all().filter(n=>n.tagName==='button').every(n=>n.disabled));f.open();assert.equal(f.dialog(),undefined);
});
