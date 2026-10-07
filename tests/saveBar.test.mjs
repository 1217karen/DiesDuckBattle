import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createOnlineEditController } from '../js/onlineEditController.js';
import { createEmptyPlayerBuild, createEmptyDuck } from '../js/playerBuildModel.js';
import { createEmptyPlayerPresentation } from '../js/playerPresentationModel.js';

for (const [page, sections] of [['character',['presentation','battlerName']],['setting',['build','publicSettings']]]) {
 test(`${page} save bar follows real dirty transitions through save, reload, discard and conflict`, async () => {
  const nodes=new Map(),classes=new Set(),states=[];
  const bar={classList:{toggle(name,enabled){if(enabled)classes.add(name);else classes.delete(name);}}};
  const document={visibilityState:'visible',activeElement:null,
   createElement(tag){return {tagName:tag,children:[],handlers:{},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},setAttribute(){},addEventListener(name,fn){this.handlers[name]=fn;},focus(){},remove(){},close(value){this.returnValue=value;this.handlers.close?.();},showModal(){queueMicrotask(()=>this.close('confirmed'));}};},
   getElementById(id){if(!nodes.has(id))nodes.set(id,this.createElement('div'));return nodes.get(id);},
   querySelector(selector){assert.equal(selector,'.save-bar');return bar;},querySelectorAll(){return [];},addEventListener(){},removeEventListener(){},
  };
  document.body=document.createElement('body');
  let conflict=false,server={ok:true,account:{id:'account',eno:'1'},authUserId:'auth',revision:'0',data:{build:createEmptyPlayerBuild(),presentation:createEmptyPlayerPresentation(),publicSettings:{schemaVersion:1,publicDuckId:null},battlerName:'Battler'}};
  const storage={load:async()=>structuredClone(server),resolveAccount:async()=>structuredClone(server),save:async(base,data)=>{
   if(conflict)return {ok:false,status:'conflict',message:'conflict'};
   server={...server,revision:String(Number(server.revision)+1),data:structuredClone(data)};return structuredClone(server);
  }};
  const source=(await readFile(new URL('../js/onlineEditor.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
  const context={document,queueMicrotask,createOnlineEditController,showToast(){},window:{addEventListener(){},removeEventListener(){}},
   getSupabaseClient:async()=>({auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};}}}),getAuthRuntime:async()=>({beforeLogout:()=>()=>{}}),createOnlinePlayerStorage:()=>storage,sections,onState:state=>states.push(state),hydrate(){}};
  const controller=await vm.runInNewContext(`(async()=>{${source}\nreturn mountOnlineEditor({sections,hydrate,onState});})()`,context);
  const check=dirty=>{assert.equal(controller.snapshot().dirty,dirty);assert.equal(classes.has('is-dirty'),dirty);assert.equal(nodes.get('save-message').textContent,dirty?'未保存の変更があります':'変更はありません');assert.equal(nodes.get('save').disabled,!controller.snapshot().canSave);};
  let counter=0;
  const edit=()=>{if(page==='character')controller.edit({battlerName:'Draft '+(++counter)});else {const build=structuredClone(controller.snapshot().draft.build);build.ducks.push(createEmptyDuck());controller.edit({build});}};
  check(false);edit();check(true);await controller.save();check(false);
  edit();check(true);await controller.load();check(false);
  edit();await controller.compare();await controller.adoptLatest(false);check(false);
  edit();conflict=true;await controller.save();check(true);assert.equal(nodes.get('save').disabled,true);
  await controller.compare();check(true);await controller.adoptLatest(true);check(true);assert.equal(nodes.get('save').disabled,false);
  conflict=false;await controller.save();check(false);
  edit();conflict=true;await controller.save();await controller.compare();await controller.adoptLatest(false);check(false);
  edit();controller.invalidate();check(false);
  assert(states.some(state=>state.dirty&&state.status==='conflict'));
 });
}
