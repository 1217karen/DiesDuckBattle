import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadSettingPage } from './settingPageHarness.mjs';
import { createSkillVaultView } from '../js/skillVaultView.js';
import { createOnlineEditController } from '../js/onlineEditController.js';
import { createEmptyPlayerBuild,createEmptyDuck } from '../js/playerBuildModel.js';
import { createEmptyPlayerPresentation } from '../js/playerPresentationModel.js';
import { battlerPresetPatch,duckPresetPatch } from '../js/battlePresets.js';
import { presentVaultSkill } from '../js/skillVaultModel.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
function initial(){
  const build=createEmptyPlayerBuild();Object.assign(build.battler,battlerPresetPatch('attack'));
  build.ducks=['one','two'].map(id=>({...createEmptyDuck({idFactory:()=>id}),...duckPresetPatch('attack'),name:id}));
  return {build,presentation:createEmptyPlayerPresentation(),publicSettings:{schemaVersion:1,publicDuckId:'two'},battlerName:'バトラー'};
}
function server(){
  let rows=[],writes=0,fail=false,wait=null;const counts={};
  return {get rows(){return structuredClone(rows);},get writes(){return writes;},set fail(v){fail=v;},set wait(v){wait=v;},
    async list(){return fail?{ok:false,status:'failed'}:{ok:true,entries:structuredClone(rows)};},
    async store(scope,entry){writes++;if(wait)await wait;if(fail)return {ok:false,status:'unknown'};
      rows.push({...structuredClone(entry),gameAccountId:scope.gameAccountId,displayName:entry.name||`スキル${counts[entry.type]=(counts[entry.type]??0)+1}`});
      return {ok:true,entries:structuredClone(rows)};},
    async remove(_s,id){writes++;rows=rows.filter(e=>e.id!==id);return {ok:true,entries:structuredClone(rows)};},
  };
}
async function page(data=initial(),vaultStorage=server()) {
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.attributes={};this.value='';this.classList={toggle(){}};}
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
    replaceChildren(...children){this.children=[];this.append(...children);}
    setAttribute(k,v){this.attributes[k]=v;}
    addEventListener(k,v){this.handlers[k]=v;}
    focus(){} showModal(){this.open=true;} close(){this.open=false;this.handlers.close?.();}
    remove(){this.parent.children=this.parent.children.filter(e=>e!==this);}
    set textContent(v){this.text=String(v);this.children=[];}
    get textContent(){return (this.text??'')+this.children.map(e=>e.textContent).join('');}
  }
  const body=new Element('body'),walk=e=>[e,...e.children.flatMap(walk)],all=()=>walk(body);
  for(const m of (await readFile(new URL('../setting.html',import.meta.url),'utf8')).matchAll(/\bid="([^"]+)"/g)){const e=new Element('div');e.id=m[1];body.append(e);}
  const get=id=>all().find(e=>e.id===id);
  globalThis.document={body,createElement:tag=>new Element(tag),getElementById:get};globalThis.window={addEventListener(){}};
  globalThis.localStorage={getItem(){throw Error('no local vault');},setItem(){throw Error('no local vault');}};
  let row={ok:true,account:{id:'account',eno:'1'},authUserId:'auth',revision:'0',data:structuredClone(data)},online,vault;
  const writes=[],edits=[];
  const storage={resolveAccount:async()=>structuredClone(row),load:async()=>structuredClone(row),save:async(base,next)=>{
    writes.push(structuredClone(next));row={...base,data:structuredClone(next)};return row;
  }};
  await loadSettingPage(data.build,()=>{},async({sections,allowDuckPresentationDeletion,hydrate,onState})=>{
    online=createOnlineEditController({storage,sections,allowDuckPresentationDeletion,confirm:()=>true});let version=-1;
    online.subscribe(next=>{if(next.dataVersion!==version){version=next.dataVersion;hydrate(next.draft);}onState(next);});
    const edit=online.edit;online.edit=(...args)=>{edits.push(structuredClone(args));return edit(...args);};
    await online.load();return online;
  },options=>vault=createSkillVaultView({...options,storage:vaultStorage,notify:()=>{}}));
  await tick();
  const dialog=()=>all().find(e=>e.tagName==='dialog');
  const button=(text,root=body)=>walk(root).find(e=>e.tagName==='button'&&e.textContent===text);
  const click=e=>{assert.ok(e,'control exists');assert.ok(!e.disabled,'control enabled');e.handlers.click();};
  return {get,button,dialog,click,online,vault,vaultStorage,writes,edits,all,
    input(id,value){const e=get(id);e.value=value;e.handlers.input();},
    async store(type){click(get(`vault-${type}-store`));click(button('保管する',dialog()));await tick();},
    inspect(type,name){const details=get(`vault-${type}`);details.open=true;details.handlers.toggle();click(button(name,details));},
  };
}
for(const type of ['A','B','C','D']) test(`${type}: closed vault, unsaved label copy, cancel, load, delete confirmation, reload persistence`,async()=>{
  const p=await page(),before=p.online.snapshot().draft;
  assert.equal(p.get(`vault-${type}`).open,false);
  assert.notEqual(p.get(`vault-${type}-store`).parent,p.get(`vault-${type}`));
  p.input(`skill-${type.toLowerCase()}-name`,'必殺');p.input(`skill-${type.toLowerCase()}-ruby`,'ひっさつ');
  const edited=p.online.snapshot().draft;
  p.click(p.get(`vault-${type}-store`));assert.ok(p.dialog().textContent.includes('スキルを保管しますか？'));
  p.click(p.button('キャンセル',p.dialog()));assert.equal(p.vaultStorage.writes,0);
  await p.store(type);assert.equal(p.vaultStorage.rows.length,1);assert.equal(p.writes.length,0);
  assert.deepEqual(p.online.snapshot().draft,edited);assert.ok(p.all().some(e=>e.textContent.includes('スキルを保管しました。')));
  p.inspect(type,'必殺');const actions=p.dialog().children.at(-1);
  assert.deepEqual(actions.children.map(e=>e.textContent),['読み込む','キャンセル','削除する']);
  p.click(p.button('キャンセル',p.dialog()));assert.deepEqual(p.online.snapshot().draft,edited);
  if(['A','C'].includes(type))p.click(p.get('duck-tab-1'));
  p.input(`skill-${type.toLowerCase()}-name`,'編集中');
  const targetBefore=p.online.snapshot().draft;
  p.inspect(type,'必殺');p.click(p.button('読み込む',p.dialog()));
  const after=p.online.snapshot().draft,expected=structuredClone(targetBefore);
  const owner=['A','C'].includes(type)?expected.build.ducks[1]:expected.build.battler;
  owner.skillLabels[type]={name:'必殺',ruby:'ひっさつ'};
  owner[type.toLowerCase()+'Selection']=p.vaultStorage.rows[0].selection;
  assert.deepEqual(after,expected);assert.equal(p.online.snapshot().dirty,true);assert.equal(p.writes.length,0);
  assert.equal(p.get(`skill-${type.toLowerCase()}-ruby`).value,'ひっさつ');
  assert.ok(p.all().some(e=>e.textContent.includes(presentVaultSkill(type,owner[type.toLowerCase()+'Selection']).text)));
  await p.store(type);assert.equal(p.vaultStorage.rows.length,2);
  p.inspect(type,'必殺');p.click(p.button('削除する',p.dialog()));assert.ok(p.dialog().textContent.includes('この操作は取り消せません'));
  p.click(p.button('キャンセル',p.dialog()));assert.equal(p.vaultStorage.rows.length,2);
  p.inspect(type,'必殺');p.click(p.button('削除する',p.dialog()));p.click(p.button('削除する',p.dialog()));await tick();
  assert.equal(p.vaultStorage.rows.length,1);assert.deepEqual(p.online.snapshot().draft,after);assert.equal(p.writes.length,0);
  const reloaded=await page(before,p.vaultStorage);assert.ok(reloaded.button('必殺',reloaded.get(`vault-${type}`)));
});
test('blank names remain blank on load; stable numbers; name limits update without blur',async()=>{
  const p=await page();await p.store('A');assert.equal(p.vaultStorage.rows[0].displayName,'スキル1');
  p.input('skill-a-name','一時名');p.inspect('A','スキル1');p.click(p.button('読み込む',p.dialog()));assert.equal(p.get('skill-a-name').value,'');
  p.input('skill-a-name','a'.repeat(21));assert.equal(p.get('vault-A-store').disabled,true);
  p.input('skill-a-name','');assert.equal(p.get('vault-A-store').disabled,false);
  p.inspect('A','スキル1');p.click(p.button('削除する',p.dialog()));p.click(p.button('削除する',p.dialog()));await tick();
  await p.store('A');assert.equal(p.vaultStorage.rows[0].displayName,'スキル2');
});
test('unfinished selections disabled; completed A stores despite pt or unavailable dice',async()=>{
  const data=initial();for(const t of ['b','d'])data.build.battler[t+'Selection']=null;
  data.build.ducks[0].aSelection=null;data.build.ducks[0].cSelection={mode:'normal',structure:{kind:'random',branches:[{effects:[]},{effects:[]}]}};
  const p=await page(data);for(const t of ['A','B','C','D'])assert.equal(p.get(`vault-${t}-store`).disabled,true);
  const over=initial();over.build.ducks[0].aSelection={triggerId:'all',effects:Array.from({length:4},()=>({effectId:'heal',targetId:'self',options:{amount:'amount-7'}}))};
  const q=await page(over);assert.equal(q.get('vault-A-store').disabled,false);await q.store('A');assert.equal(q.vaultStorage.rows.length,1);
});
test('late store never edits newly selected duck; login change closes dialog; failed list leaves editor usable',async()=>{
  const p=await page();await p.store('A');p.inspect('A','スキル1');
  p.click(p.get('duck-tab-1'));assert.equal(p.dialog(),undefined);assert.equal(p.online.snapshot().dirty,false);
  let finish;p.vaultStorage.wait=new Promise(r=>finish=r);p.click(p.get('vault-C-store'));p.click(p.button('保管する',p.dialog()));
  assert.equal(p.get('vault-A-store').disabled,true);p.click(p.get('duck-tab-0'));const before=p.online.snapshot().draft;
  finish();await tick();assert.deepEqual(p.online.snapshot().draft,before);assert.equal(p.writes.length,0);
  p.inspect('A','スキル1');p.online.invalidate('changed');assert.equal(p.dialog(),undefined);assert.deepEqual(p.vault.controller.snapshot().entries,[]);
  const broken=server();broken.fail=true;const q=await page(initial(),broken);
  assert.equal(q.get('vault-A-store').disabled,true);q.input('skill-a-name','編集可');assert.equal(q.online.snapshot().dirty,true);
});
test('retired selections are visible with explanation, never substituted or loaded',async()=>{
  const data={id:'retired',type:'A',name:'古い技',ruby:'',displayName:'古い技',selection:{triggerId:'all',effects:[{effectId:'retired-effect'}]}};
  const p=await page(initial(),{list:async()=>({ok:true,entries:[data]})});p.inspect('A','古い技');
  assert.equal(p.button('読み込む',p.dialog()).disabled,true);assert.ok(p.dialog().textContent.includes('元の保管データは維持'));
  p.click(p.button('キャンセル',p.dialog()));assert.equal(p.online.snapshot().dirty,false);
});
