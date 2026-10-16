import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeOnlineCharacters,createOnlineCharacterListService} from '../js/onlineCharacterListService.js';
import {filterCharacters} from '../js/characterListModel.js';
import {createCharacterCard} from '../js/characterListView.js';
import {loadCharacterListPage} from '../js/characterListPage.js';
const row=(eno='1',bestStreak=0)=>({eno,bestStreak,battlerName:'Abc 炎',battlerIconUrl:'',accent:'#4F91B3',background:'#123456',panel:'#234567',text:'#abcdef',duck:{name:'Duck',iconUrl:'',type:'attack',attributes:['炎','','🔥']}});
test('exact list decoder accepts public zero and private null, copies data',()=>{const a=[row(),row('2',null)];assert.deepEqual(decodeOnlineCharacters(a),a);assert.notEqual(decodeOnlineCharacters(a),a);});
test('all four colors require validated six-digit hex values in the public DTO',()=>{
 for(const key of ['background','panel','text','accent']) for(const value of [undefined,null,42,'red','#abc','url(secret)']) {
  const v=row();v[key]=value;assert.throws(()=>decodeOnlineCharacters([v]));
 }
});
const bad=[v=>v.secret=1,v=>v.eno='01',v=>v.eno=1,v=>v.eno='9223372036854775808',v=>v.accent='red',v=>v.accent='#abc',v=>v.battlerName=null,v=>v.battlerIconUrl=null,v=>v.duck.type='__proto__',v=>v.duck.type='foo',v=>v.duck.secret=1,v=>v.duck.attributes=['炎'],v=>v.duck.attributes=['ab','',''],v=>v.duck.attributes=[1,'',''],v=>v.bestStreak=-1,v=>v.bestStreak=1.5,v=>v.bestStreak=Number.MAX_SAFE_INTEGER+1,v=>v.bestStreak='1'];
for(const [i,change] of bad.entries())test(`strict list reject ${i}`,()=>{const v=row();change(v);assert.throws(()=>decodeOnlineCharacters([v]));});
test('filters AND, literal attribute match, null duck, numeric ENo, best privacy ordering',()=>{
 const a=row('2',3),b=row('10',3),c={...row('9223372036854775807',null),duck:null,battlerName:'other'},d={...row('1',0),battlerName:'Other',duck:{...row().duck,name:'ABC Duck',type:'heal'}};
 const rows=[c,b,a,d],ids=opts=>filterCharacters(rows,opts).map(x=>x.eno);
 assert.deepEqual(ids({}),['1','2','10',c.eno]);assert.deepEqual(ids({sort:'eno-desc'}),[c.eno,'10','2','1']);
 assert.deepEqual(ids({sort:'best'}),['2','10','1',c.eno]);
 assert.deepEqual(ids({name:' abc '}),['1','2','10']);assert.deepEqual(ids({attribute:'🔥',type:'heal',name:'abc'}),['1']);
 assert.deepEqual(ids({attribute:'炎🔥'}),[]);assert.deepEqual(ids({name:'other',type:'attack'}),[]);
 assert.deepEqual(filterCharacters([row('10',null),row('2',null)],{sort:'best'}).map(x=>x.eno),['2','10']);assert.equal(rows[0],c);
});
test('service uses one RPC, rejects malformed/private responses and identity changes',async()=>{
 let count=0,identity='user',calls=[];const client={auth:{getSession:async()=>({data:{session:{user:{id:identity}}}})},rpc:async name=>{calls.push(name);return{data:[row()]};}};
 assert.equal((await createOnlineCharacterListService(client).list()).ok,true);assert.deepEqual(calls,['list_online_characters']);
 client.rpc=async()=>{identity='changed';return{data:[row()]};};assert.equal((await createOnlineCharacterListService(client).list()).ok,false);
 client.auth.getSession=async()=>({data:{session:null}});client.rpc=async()=>{count++;return{data:[row()]};};assert.equal((await createOnlineCharacterListService(client).list()).ok,true);assert.equal(count,1);
});
class El {constructor(tag){this.tagName=tag;this.children=[];this.style={setProperty(k,v){this[k]=v;}};this.attributes={};this.handlers={};this.value='';}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(k,v){this.attributes[k]=v;}addEventListener(k,fn){this.handlers[k]=fn;}set textContent(v){this.text=v;}get textContent(){return(this.text??'')+this.children.map(x=>x.textContent).join('');}}
const doc=()=>{const nodes=new Map();return{createElement:tag=>new El(tag),getElementById:id=>{if(!nodes.has(id))nodes.set(id,new El('div'));return nodes.get(id);}};};
test('card exact image dimensions, fallbacks, labels, profile colors and link',()=>{
 const document=doc(),v=row(),c=createCharacterCard(document,v);assert.equal(c.tagName,'a');assert.equal(c.href,'profile.html?eno=1');assert.equal(c.style.borderColor,v.accent); for(const [key,value] of Object.entries({'--card-accent':v.accent,'--card-bg':v.background,'--card-panel':v.panel,'--card-text':v.text})) assert.equal(c.style[key],value);
 const [b,info]=c.children[1].children,d=info.children[1].children[0];assert.equal(b.width,120);assert.equal(d.width,60);assert.equal(b.src,'/img/B00_icon.png');assert.equal(d.src,'/img/D00.png');
 assert.match(c.textContent,/アタックタイプ.*属性：炎・🔥.*MAX STREAK0/);
 v.duck=null;v.bestStreak=null;v.battlerIconUrl='broken';const empty=createCharacterCard(document,v),img=empty.children[1].children[0];img.handlers.error();assert.equal(img.src,'/img/B00_icon.png');assert.match(empty.textContent,/属性：―.*MAX STREAK―/);
});
test('page fetches once, filters without another RPC, shows no-results and generic error',async()=>{
 const document=doc();let count=0,finished=0;
 await loadCharacterListPage({document,getClient:async()=>({}),createService:()=>({list:async()=>{count++;return{ok:true,characters:[row()]};}}),finish:()=>finished++});
 const name=document.getElementById('name-filter');name.value='missing';name.handlers.input();assert.equal(document.getElementById('character-list').children.length,0);assert.equal(document.getElementById('list-message').textContent,'該当するキャラクターがいません。');
 name.value='abc';name.handlers.input();assert.equal(document.getElementById('character-list').children.length,1);assert.equal(count,1);assert.equal(finished,1);
 await loadCharacterListPage({document:doc(),getClient:async()=>{throw Error('SECRET');},finish:()=>finished++});assert.equal(finished,2);
});

test('guest list reaches profile links through real service; login during request is rejected',async()=>{
 let user=null;
 const client={auth:{getSession:async()=>({data:{session:user?{user:{id:user}}:null}})},rpc:async()=>({data:[row()]})};
 const document=doc();await loadCharacterListPage({document,getClient:async()=>client,finish(){}});
 assert.equal(document.getElementById('character-list').children[0].href,'profile.html?eno=1');
 client.rpc=async()=>{user='new-user';return{data:[row()]};};
 assert.equal((await createOnlineCharacterListService(client).list()).ok,false);
});

test('PL substring filter combines conditions, includes duplicates and never invents anonymous labels',async()=>{
 const rows=[{...row('1'),plName:'雪だるまPL'},{...row('2'),plName:'雪だるまPL'}, {...row('3'),plName:''},row('4'),{...row('5'),plName:'匿名'}];
 rows[1].duck.type='heal';
 assert.equal(filterCharacters(rows).length,5);
 assert.deepEqual(filterCharacters(rows,{plName:' だるまpl '}).map(c=>c.eno),['1','2']);
 assert.deepEqual(filterCharacters(rows,{plName:'だるま',name:'abc',attribute:'炎',type:'heal'}).map(c=>c.eno),['2']);
 assert.deepEqual(filterCharacters(rows,{plName:'匿名'}).map(c=>c.eno),['5']);
 const document=doc();await loadCharacterListPage({document,search:'?plName='+encodeURIComponent('雪だるまPL'),getClient:async()=>({}),createService:()=>({list:async()=>({ok:true,characters:rows})}),finish(){}});
 const field=document.getElementById('pl-name-filter');assert.equal(field.value,'雪だるまPL');assert.equal(document.getElementById('character-list').children.length,2);
 field.value='';field.handlers.input();assert.equal(document.getElementById('character-list').children.length,5);
});
