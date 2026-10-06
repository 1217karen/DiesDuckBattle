import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { menuModel } from '../js/commonMenuModel.js';
const read = file => readFile(new URL('../'+file, import.meta.url), 'utf8');
const gateCode = await read('js/pageLoadGate.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function fixture() {
  const nodes=new Map(), events={}, classes=new Set(['page-loading','has-common-menu']);
  const classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(){}};
  const element=()=>({children:[],handlers:{},attributes:{},textContent:'',value:'',hidden:false,classList,
    append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;},remove(){this.removed=true;},
    setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,v){this.handlers[k]=v;},close(){},focus(){},checkValidity(){return true;}});
  const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const body=element(); body.classList=classList;
  const document={body,getElementById:get,querySelector:s=>get(s.slice(1)),querySelectorAll:()=>[],createElement:element,
    addEventListener:(n,fn)=>events[n]=fn,visibilityState:'visible'};
  let now=0, timer, canceled=false;
  const ctx={document,setTimeout(fn,delay){timer={fn,at:now+delay};return 1;},clearTimeout(){canceled=true;}};
  vm.runInNewContext(gateCode,ctx);
  return {get,body,document,nodes,events,classes,gate:ctx.diesDuckPageLoad,element,
    finishPageLoad:()=>ctx.diesDuckPageLoad.finish(),
    window:{addEventListener:(n,fn)=>events[n]=fn,removeEventListener(){}},
    advance(ms){now+=ms;if(timer&&!canceled&&now>=timer.at){const fn=timer.fn;timer=null;fn();}},
    visible:()=>!classes.has('page-loading'),indicators:()=>body.children.filter(n=>n.className==='page-load-indicator'&&!n.removed)};
}
async function run(name,context) {
  const code=(await read('js/'+name+'.js')).replace(/^import .*;\r?\n/gm,'');
  return vm.runInNewContext('(async()=>{'+code+'})()',context);
}
test('gate: 999ms stays silent; finish cancels timer and is idempotent; no menu mutation',()=>{
 const f=fixture(),menu=f.get('common-menu');menu.textContent='ENo.12｜Alice';
 f.advance(999);assert.equal(f.visible(),false);assert.equal(f.indicators().length,0);
 f.finishPageLoad();f.finishPageLoad();f.advance(5000);
 assert.equal(f.visible(),true);assert.equal(f.indicators().length,0);assert.equal(f.get('common-menu'),menu);assert.equal(menu.textContent,'ENo.12｜Alice');
});
test('gate: 1000ms adds one accessible quiet status; finish removes it permanently',()=>{
 const f=fixture();f.advance(1000);assert.equal(f.indicators().length,1);
 assert.equal(f.indicators()[0].textContent,'読み込み中……');assert.equal(f.indicators()[0].attributes.role,'status');
 f.finishPageLoad();f.advance(9000);assert.equal(f.indicators().length,0);assert.equal(f.visible(),true);
});
test('gate: redirect never reveals; unexpected error shows error alone then finishes',()=>{
 const f=fixture();f.classes.add('auth-required-pending');f.gate.fail();f.finishPageLoad();f.advance(1000);
 assert.equal(f.visible(),false);assert.equal(f.indicators().length,0);
 const g=fixture();g.gate.fail();assert.equal(g.visible(),true);assert.ok(g.classes.has('page-load-failed'));
 assert.match(g.body.children[0].textContent,/読み込めません/);assert.equal(g.body.children[0].attributes.role,'alert');
});
for(const name of ['indexPage','authPage']) for(const outcome of ['signed-in','signed-out','restore-error','sdk-error']) test(name+' readiness '+outcome,async()=>{
 const f=fixture();let listener,mounted=false;
 const auth={subscribe(fn){listener=fn;fn({ready:false,sessionKnown:false,accounts:[],enos:[]});}};
 const ctx={...f,consumeIndexNotice(){},menuModel,mountAuthView(){mounted=true;return {};},
 getAuthRuntime:async()=>{if(outcome==='sdk-error')throw Error('sdk');return auth;}};
 await run(name,ctx);
 if(outcome!=='sdk-error') {
  assert.equal(mounted,true);assert.equal(f.visible(),false);
  listener({ready:true,sessionKnown:outcome!=='restore-error',signedIn:outcome==='signed-in',accounts:[{eno:'12',name:'Alice'}],enos:['12'],message:''});
 }
 assert.equal(f.visible(),true);
 if(outcome.endsWith('error'))assert.match(f.get(name==='indexPage'?'home-status':'auth-root').textContent,/読み込めません/);
 else if(name==='indexPage') {
  assert.equal(f.get('home-game').hidden,outcome!=='signed-in');
  if(outcome==='signed-in'){assert.match(f.get('home-status').textContent,/Alice/);assert.ok(f.get('home-game').children.length);}
 }
});
for(const name of ['settingPage','characterPage']) for(const outcome of ['success','error','denied']) test(name+' awaits editor boundary '+outcome,async()=>{
 const f=fixture(),pending=deferred(),started=deferred();let mounted=false;
 const noop=()=>({});
 const ctx={...f,requireLoginPage:async()=>{if(outcome==='denied'){f.classes.add('auth-required-pending');throw Error('Login required');}},
 createSettingState:noop,createBuildRules:noop,createASkillCatalog:noop,createBSkillCatalog:noop,createCSkillCatalog:noop,createCSkillRules:noop,
 createIconPicker:noop,createEmptyPlayerPresentation:noop,
 mountOnlineEditor:async()=>{mounted=true;started.resolve();await pending.promise;f.get('editor').textContent=outcome==='success'?'hydrated':'load error';return null;}};
 const running=run(name,ctx);
 if(outcome==='denied'){await assert.rejects(running,/Login required/);assert.equal(mounted,false);assert.equal(f.visible(),false);return;}
 await started.promise;assert.equal(f.visible(),false);pending.resolve();await running;
 assert.equal(f.visible(),true);assert.equal(f.get('editor').textContent,outcome==='success'?'hydrated':'load error');
});
for(const outcome of ['success','error','denied']) test('SELECT waits for load/render and never re-hides on recheck '+outcome,async()=>{
 const f=fixture(),pending=deferred(),started=deferred();let listener,checks=0,clients=0;
 const state={self:{name:'Alice'},build:null};
 const ctx={...f,requireLoginPage:async()=>{if(outcome==='denied'){f.classes.add('auth-required-pending');throw Error('Login required');}},
 createSelectState:()=>state,createSelectPresentation:()=>()=>{},FIXED_IMAGES:{},duckChoices:()=>[],battlerSummary:()=>'',duckSummary:()=>'',battleStartStatus:()=>({reason:'choose'}),
 getSupabaseClient:async()=>{clients++;return {auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};},createOnlineSelectService:()=>({}),
 createOnlineSelectController:()=>({subscribe:fn=>listener=fn,load:async()=>{started.resolve();await pending.promise;if(outcome==='error')throw Error('offline');listener({state,eno:'12',message:'complete',canStart:false});},checkScope(){checks++;},invalidate(){}})};
 const running=run('select',ctx);
 if(outcome==='denied'){await assert.rejects(running,/Login required/);assert.equal(clients,0);assert.equal(f.visible(),false);return;}
 await started.promise;assert.equal(f.visible(),false);pending.resolve();await running;
 assert.equal(f.visible(),true);assert.match(f.get('load-status').textContent,outcome==='error'?/準備できません/:/complete/);
 f.events.focus();f.events.pageshow({persisted:true});f.events.visibilitychange();assert.equal(checks,3);assert.equal(f.visible(),true);
});
for(const outcome of ['records','empty','error','throw']) test('storage renders adopted first response before reveal '+outcome,async()=>{
 const f=fixture(),pending=deferred(),started=deferred();
 const record={battleId:'id',battleNo:1,dateISO:'2026-10-05',result:'draw',p1:{eno:'1'},p2:{eno:'2'}};
 const ctx={...f,createBattleResultStorage:()=>({list:async()=>{started.resolve();await pending.promise;if(outcome==='throw')throw Error('offline');return {ok:outcome!=='error',records:outcome==='records'?[record]:[],page:1,total:outcome==='records'?1:0,totalPages:1};}}),
 getSupabaseClient:async()=>({}),createOnlinePlayerStorage:()=>({resolveAccount:async()=>({ok:false})}),FIXED_IMAGES:{},setImageWithFallback(){}};
 const running=run('storagePage',ctx);await started.promise;assert.equal(f.visible(),false);pending.resolve();await running;
 assert.equal(f.visible(),true);
 if(outcome==='records')assert.equal(f.get('list').children.length,1);
 else assert.equal(f.get(outcome==='empty'?'empty':'error').hidden,false);
 f.events.focus();assert.equal(f.visible(),true);
});
for(const outcome of ['success','not-found','throw']) test('result sets up record/error before reveal without waiting for images '+outcome,async()=>{
 const f=fixture(),pending=deferred(),started=deferred();let rendered=false;
 const ctx={...f,URLSearchParams,location:{search:'?battleId=id'},history:{back(){}},FIXED_IMAGES:{},numberOr:(v,d)=>v??d,
 setHeaderIcon(){return new Promise(()=>{});},buildBlocks(){rendered=true;return [];},
 createBattleResultStorage:()=>({load:async()=>{started.resolve();await pending.promise;if(outcome==='throw')throw Error('offline');return {ok:outcome==='success',status:outcome,record:{events:[],p1:{battlerName:'Alice'},p2:{battlerName:'Bob'}}};}})};
 const running=run('result',ctx);await started.promise;assert.equal(f.visible(),false);pending.resolve();await running;
 assert.equal(f.visible(),true);
 if(outcome==='success'){assert.equal(rendered,true);assert.match(f.get('p1Name').textContent,/Alice/);assert.equal(f.get('centerTurn').textContent,'TURN 0');}
 else { assert.match(f.get('logArea').children[0].textContent,/見つかりません|取得できません/); assert.equal(f.get('battle-header').hidden,true); }
});
test('HTML starts gated; markers preserve background/menu and layout; noscript lives outside hidden content',async()=>{
 for(const name of ['index','auth','select','setting','character','storage','result','rulebook']){
  const html=await read(name+'.html');assert.match(html,/<body class="[^"]*page-loading/);assert.match(html,/css\/page-loading.css/);
  assert.match(html,/<main data-page-content/);assert.match(html,/<noscript><p class="page-load-noscript">/);
  assert.ok(html.indexOf('page-load-noscript')<html.indexOf('<main'));
  assert.doesNotMatch(html,/<header[^>]*data-page-content[^>]*id="common-menu"|<div[^>]*data-page-content[^>]*id="bg"/);
  assert.doesNotMatch(html,/(?:表示)?設定を読み込んでいます/);
  assert.match(html,/data-page-src="js\//);
 }
 const css=await read('css/page-loading.css');assert.match(css,/visibility: hidden !important/);assert.doesNotMatch(css,/display:\s*none/);
 assert.match(css,/top: var\(--common-menu-height/);
 const gate=await read('js/pageLoadGate.js');assert.doesNotMatch(gate,/pageshow|focus|visibilitychange|sessionStorage/);
});

test('storage: superseded initial response does not reveal while newest request is pending',async()=>{
 const f=fixture(),requests=[];
 const running=run('storagePage',{...f,createBattleResultStorage:()=>({list:()=>{const p=deferred();requests.push(p);return p.promise;}}),
 getSupabaseClient:async()=>({}),createOnlinePlayerStorage:()=>({resolveAccount:async()=>({ok:false})})});
 while(!requests.length) await tick();
 f.events.focus();assert.equal(requests.length,2);
 requests[0].resolve({ok:false});await running;assert.equal(f.visible(),false);
 requests[1].resolve({ok:true,records:[],total:0,page:1,totalPages:0});await tick();assert.equal(f.visible(),true);assert.equal(f.get('empty').hidden,false);
});
test('entry loader catches module/evaluation failure, but a guard redirect never reveals private content',async()=>{
 const code=(await read('js/pageEntry.js')).replace('import(pageModule.href)','loadModule(pageModule.href)');
 for(const denied of [false,true]){
  const f=fixture();f.document.currentScript={dataset:{pageSrc:'js/select.js'}};f.document.baseURI='https://example.test/select.html';
  vm.runInNewContext(code,{document:f.document,URL,diesDuckPageLoad:f.gate,
   loadModule:async()=>{if(denied)f.classes.add('auth-required-pending');throw Error('module or guard failed');}});
  await tick();assert.equal(f.visible(),!denied);
  assert.equal(f.body.children.some(n=>n.className==='page-load-error'),!denied);
 }
});
