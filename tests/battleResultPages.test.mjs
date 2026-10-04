import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createBattleResultStorage} from '../js/battleResultStorage.js';
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
function dom(){
  const elements=new Map();
  const element=()=>({children:[],listeners:{},attributes:{},hidden:false,disabled:false,value:'desc',textContent:'',
    addEventListener(type,fn){this.listeners[type]=fn;},append(...nodes){this.children.push(...nodes);},
    replaceChildren(...nodes){this.children=nodes;},setAttribute(k,v){this.attributes[k]=v;},checkValidity(){return true;},reportValidity(){},setCustomValidity(v){this.validityMessage=v;}});
  return {elements,document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},
    createElement:element,createDocumentFragment:element}};
}
async function page(file,context){
  const source=(await readFile(new URL('../js/'+file+'.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  return vm.runInNewContext('(async()=>{'+source+'})()',context);
}
const tick=()=>new Promise(r=>setImmediate(r));
test('result page waits for server record then initializes unchanged renderer',async()=>{
  const d=dom(),pending=gate(),started=gate(),calls=[];let rendered;
  const context={...d,URLSearchParams,location:{search:'?battleId=server-id'},history:{back(){}},FIXED_IMAGES:{},
    setHeaderIcon(){},numberOr:(v,f)=>v??f,buildBlocks(events){rendered=events;return [];},
    createBattleResultStorage:()=>createBattleResultStorage({rpc:async(name,args)=>{calls.push([name,args]);started.resolve();return pending.promise;}})};
  const loading=page('result',context);await started.promise;assert.equal(d.elements.get('btnNext').disabled,true);assert.equal(rendered,undefined);
  const record={p1:{battlerName:'A',duckName:'D',presentation:{}},p2:{battlerName:'B',duckName:'E',presentation:{}},result:'draw',events:[{type:'battleEnd',result:'draw'}]};
  pending.resolve({data:record});await loading;
  assert.equal(rendered,record.events);assert.equal(d.elements.get('p1Name').textContent,'A ＋ D');
  assert.deepEqual(calls,[['get_online_battle_result',{p_battle_id:'server-id'}]]);
});
const fixed={battlerIcon:'/img/B00_icon.png',duckIcon:'/img/D00.png'};
async function historyPage(account={ok:true,account:{id:'account',eno:'12'}}) {
  const d=dom(),requests=[],listeners={},started=gate();
  const loading=page('storagePage',{...d,window:{addEventListener:(name,fn)=>listeners[name]=fn},
    getSupabaseClient:async()=>({}),createOnlinePlayerStorage:()=>({resolveAccount:async()=>account}),
    FIXED_IMAGES:fixed,setImageWithFallback(img,url,fallback){img.src=url||fallback;img.addEventListener('error',()=>img.src=fallback);},
    createBattleResultStorage:()=>createBattleResultStorage({rpc:(name,args)=>{const pending=gate();requests.push({name,args,...pending});started.resolve();return pending.promise;}})});
  await started.promise;
  return {...d,requests,listeners,loading};
}
const row={battleId:'uuid-id',battleNo:1234,dateISO:'2026-10-04T12:30:00Z',result:'P2_win',favorite:false,
  p1:{eno:'12',battlerName:'A',duckName:'D',presentation:{battlerDefaultIconUrl:'old-a.png',duckIconUrl:'old-d.png'}},
  p2:{eno:'13',battlerName:'B',duckName:'E',presentation:{battlerDefaultIconUrl:'old-b.png',duckIconUrl:''}}};
const respond=(r,records=[row],total=31)=>r.resolve({data:{records:structuredClone(records),page:r.args.p_page,pageSize:30,total,totalPages:Math.ceil(total/30)}});
test('storage initializes own ENo, renders snapshot icons and VS, resets filters and ignores stale responses',async()=>{
  const d=await historyPage(),{requests,elements,loading}=d;
  assert.equal(elements.get('eno').value,'12');assert.equal(requests[0].args.p_eno,'12');
  assert.equal(requests[0].args.p_game_account_id,'account');assert.equal(requests[0].args.p_page_size,30);
  assert.equal(d.listeners.storage,undefined);
  elements.get('order').value='asc';elements.get('order').listeners.change();
  respond(requests[1]);await tick();
  const [identity,p1,mid,p2,date]=elements.get('list').children[0].children;
  assert.equal(identity.children[1].textContent,'#1234');assert.equal(identity.children[0].textContent,'☆');
  assert.equal(identity.children[0].attributes['aria-pressed'],'false');
  assert.deepEqual(p1.children.map(x=>x.src),['old-a.png','old-d.png']);
  assert.deepEqual(p2.children.map(x=>x.src),[fixed.duckIcon,'old-b.png']);
  assert.match(p1.children[0].alt,/ENo.12.*A/);p1.children[0].listeners.error();assert.equal(p1.children[0].src,fixed.battlerIcon);
  assert.deepEqual(mid.children.map(x=>x.textContent),['LOSE','VS','WIN']);
  assert.equal(mid.children[1].href,'result.html?battleId=uuid-id');
  assert.match(date.textContent,/10\/04\n/);
  const texts=node=>[node.textContent,...node.children.flatMap(texts)];
  assert.ok(!texts(elements.get('list')).includes('結果を見る'));assert.ok(!texts(elements.get('list')).includes('A ＋ D'));
  requests[0].resolve({error:{message:'old failure'}});await loading;await tick();assert.equal(elements.get('error').hidden,true);
  elements.get('next').listeners.click();assert.equal(requests[2].args.p_page,2);respond(requests[2]);await tick();
  elements.get('outcome').value='win';elements.get('outcome').listeners.change();
  assert.equal(requests[3].args.p_page,1);assert.equal(requests[3].args.p_outcome,'win');
  elements.get('eno').value='';elements.get('eno').listeners.change();
  assert.equal(requests[4].args.p_eno,null);assert.equal(requests[4].args.p_outcome,'all');
  assert.equal(elements.get('outcome').disabled,true);assert.equal(elements.get('outcome').value,'all');
  respond(requests[4],[],0);await tick();respond(requests[3]);await tick();assert.equal(elements.get('list').children.length,0);
});
test('stars wait for RPC, block repeated clicks, preserve failure state and refresh favorites-only pager',async()=>{
  const {requests,elements,loading}=await historyPage();respond(requests[0]);await loading;
  const star=elements.get('list').children[0].children[0].children[0];
  const pending=star.listeners.click();await tick();assert.equal(star.disabled,true);assert.equal(star.textContent,'☆');
  await star.listeners.click();assert.equal(requests.length,2);
  assert.deepEqual(requests[1].args,{p_game_account_id:'account',p_battle_id:'uuid-id',p_favorite:true});
  requests[1].resolve({error:{message:'failure'}});await tick();assert.equal(star.textContent,'☆');assert.equal(elements.get('favoriteError').hidden,false);
  respond(requests[2]);await pending;
  elements.get('favorites').value='only';elements.get('favorites').listeners.change();
  assert.equal(requests[3].args.p_favorites_only,true);respond(requests[3],[{...row,favorite:true}],1);await tick();
  const selected=elements.get('list').children[0].children[0].children[0];assert.equal(selected.textContent,'★');
  const removal=selected.listeners.click();await tick();assert.equal(requests[4].args.p_favorite,false);
  requests[4].resolve({data:{battleId:'uuid-id',favorite:false}});await tick();respond(requests[5],[],0);await removal;
  assert.equal(elements.get('list').children.length,0);assert.equal(elements.get('next').disabled,true);
});
for(const status of ['selection-required','not-signed-in'])test('unresolved account never selects first ENo or enables favorites: '+status,async()=>{
  const {requests,elements,loading}=await historyPage({ok:false,status,accounts:[{id:'a',eno:'12'},{id:'b',eno:'13'}]});
  assert.equal(elements.get('eno').value,'');assert.equal(elements.get('favorites').disabled,true);assert.equal(elements.get('outcome').disabled,true);
  assert.equal(requests[0].args.p_game_account_id,null);assert.equal(requests[0].args.p_eno,null);
  respond(requests[0]);await loading;assert.equal(elements.get('list').children[0].children[0].children[0].disabled,true);
});
