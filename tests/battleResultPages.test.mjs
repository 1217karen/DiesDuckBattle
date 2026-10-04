import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createBattleResultStorage} from '../js/battleResultStorage.js';
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
function dom(){
  const elements=new Map();
  const element=()=>({children:[],listeners:{},hidden:false,disabled:false,value:'desc',textContent:'',
    addEventListener(type,fn){this.listeners[type]=fn;},append(...nodes){this.children.push(...nodes);},
    replaceChildren(...nodes){this.children=nodes;},setAttribute(){}});
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
test('storage page uses paged RPC and discards stale ordering responses',async()=>{
  const d=dom(),requests=[],listeners={};
  await page('storagePage',{...d,window:{addEventListener:(name,fn)=>listeners[name]=fn},
    createBattleResultStorage:()=>createBattleResultStorage({rpc:(name,args)=>{const pending=gate();requests.push({name,args,...pending});return pending.promise;}})});
  assert.equal(listeners.storage,undefined);assert.equal(requests[0].args.p_page_size,30);
  d.elements.get('order').value='asc';d.elements.get('order').listeners.change({target:{value:'asc'}});
  const row={battleId:'id',dateISO:'2026-10-04',result:'draw',p1:{battlerName:'A',duckName:'D'},p2:{battlerName:'B',duckName:'E'}};
  requests[1].resolve({data:{records:[row],page:1,pageSize:30,total:31,totalPages:2}});await tick();
  assert.equal(d.elements.get('list').children.length,1);assert.equal(d.elements.get('pageInfo').textContent,'1 / 2');
  requests[0].resolve({error:{message:'old failure'}});await tick();assert.equal(d.elements.get('error').hidden,true);
  d.elements.get('next').listeners.click();assert.equal(requests[2].args.p_page,2);assert.equal(requests[2].args.p_order,'asc');
  requests[2].resolve({error:{message:'offline'}});await tick();assert.equal(d.elements.get('error').hidden,false);
});
