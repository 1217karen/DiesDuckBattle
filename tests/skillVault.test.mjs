import test from 'node:test';
import assert from 'node:assert/strict';
import { BATTLER_PRESETS, DUCK_PRESETS } from '../js/battlePresets.js';
import { captureVaultSkill, presentVaultSkill, vaultSkillPatch } from '../js/skillVaultModel.js';
import { compileASkill } from '../js/aSkillCompiler.js';
import { createSkillVaultController } from '../js/skillVaultController.js';
import { createSkillVaultStorage } from '../js/skillVaultStorage.js';

const selection = type => structuredClone((['A','C'].includes(type) ? DUCK_PRESETS[0] : BATTLER_PRESETS[0])[`${type.toLowerCase()}Selection`]);
const owner = type => ({ [`${type.toLowerCase()}Selection`]: selection(type), skillLabels: { [type]: { name: '', ruby: 'ルビ' } } });
for (const type of ['A','B','C','D']) test(`${type}: copy selection/labels only; load does not mutate source or unrelated labels`, () => {
  const source = { ...owner(type), quotes: 'excluded', stats: { AT: 3 } };
  const entry = captureVaultSkill(type, source);
  assert.deepEqual(Object.keys(entry).sort(), ['name','ruby','selection','type']);
  assert.equal(entry.name,''); assert.equal(entry.ruby,'ルビ');
  assert.ok(presentVaultSkill(type,entry.selection).text);
  const target = { skillLabels: { Z: {name:'untouched',ruby:''} } };
  const patch = vaultSkillPatch(type,entry,target);
  assert.equal(patch.skillLabels[type].name,''); assert.equal(patch.skillLabels.Z.name,'untouched');
  patch[`${type.toLowerCase()}Selection`].injected=true;
  assert.equal(entry.selection.injected,undefined); assert.equal(source[`${type.toLowerCase()}Selection`].injected,undefined);
  assert.throws(()=>vaultSkillPatch(type,{...entry,type:'X'},target));
  assert.equal(captureVaultSkill(type,{...source,[`${type.toLowerCase()}Selection`]:null}),null);
  assert.equal(captureVaultSkill(type,{...source,skillLabels:{[type]:{name:'😀'.repeat(21),ruby:''}}}),null);
  assert.equal(presentVaultSkill(type,{...entry.selection,extraneous:true}).complete,false);
});
test('A completion ignores unavailable dice and over-budget battle status',()=>{
  const a={triggerId:'all',effects:Array.from({length:4},()=>({effectId:'heal',targetId:'self',options:{amount:'amount-7'}}))};
  const duck={...DUCK_PRESETS[0],dice:[0,0,0,0,0,0],aSelection:a,skillLabels:{A:{name:'',ruby:''}}};
  assert.equal(compileASkill(duck,a).ok,false); assert.ok(captureVaultSkill('A',duck));
  for(const invalid of [{...a,triggerId:''},{...a,effects:[{effectId:'unknown'}]},
    {...a,effects:[{effectId:'heal',targetId:'self',options:{amount:''}}]},
    {...a,effects:[{effectId:'heal',targetId:'self',options:{amount:'amount-7',extra:'bad'}}]}])
    assert.equal(presentVaultSkill('A',invalid).complete,false);
});
test('C every branch must be complete; current AP is derived rather than stored',()=>{
  const leaf=selection('C').structure.effects[0];
  const c={mode:'normal',structure:{kind:'random',branches:[{effects:[leaf]},{effects:[]}]}};
  assert.equal(presentVaultSkill('C',c).complete,false);
  c.structure.branches[1].effects=[structuredClone(leaf)];
  assert.equal(presentVaultSkill('C',c).complete,true); assert.match(presentVaultSkill('C',c).text,/AP\d+/);
});
const tick=()=>new Promise(r=>setTimeout(r,0));
test('known legacy leaves load through existing migration without changing stored data',()=>{
  for(const [type,selection] of [['A',{triggerId:'all',effects:[{effectId:'heal-self',amountOptionId:'amount-3'}]}],
    ['C',{mode:'normal',structure:{kind:'flat',effects:[{effectId:'damage-enemy',options:{amount:'damageAmount-50'}}]}}]]){
    const entry={type,selection,name:'',ruby:''},before=structuredClone(entry);
    const patch=vaultSkillPatch(type,entry,{skillLabels:{}});
    const next=patch[`${type.toLowerCase()}Selection`];
    assert.equal(presentVaultSkill(type,next).text,presentVaultSkill(type,selection).text);
    assert.deepEqual(entry,before);
    const leaf=type==='A'?next.effects[0]:next.structure.effects[0];assert.ok(leaf.targetId);
  }
});
const scope={authUserId:'user',gameAccountId:'account'};
test('controller immediate list, double-send guard, unknown reconciliation, stale ENo responses',async()=>{
  let resolveStore, stores=0; const rows=[];
  const storage={list:async()=>({ok:true,entries:rows}),store:async(_scope,entry)=>{stores++;rows.push(entry);return new Promise(r=>resolveStore=r);},remove:async()=>({ok:true,entries:[]})};
  const c=createSkillVaultController({storage,idFactory:()=> 'stable-id'});c.setScope(scope);await tick();
  const entry=captureVaultSkill('A',owner('A'));
  const first=c.store(entry);c.store(entry);assert.equal(stores,1);
  resolveStore({ok:false,status:'unknown'});await first;assert.ok(c.snapshot().uncertain);
  c.store(entry);assert.equal(stores,1);await c.refresh();assert.equal(c.snapshot().uncertain,null);
  assert.equal(c.snapshot().entries[0].id,'stable-id');
  const second=c.store(entry);c.setScope({...scope,gameAccountId:'other'});
  resolveStore({ok:true,entries:[{id:'old'}]});await second;await tick();
  assert.ok(!c.snapshot().entries.some(e=>e.id==='old'));
});
test('controller retries only explicitly, retaining ID; session failure clears vault',async()=>{
  const ids=[];let mode='unknown';
  const c=createSkillVaultController({storage:{list:async()=>({ok:true,entries:[]}),
    store:async(_s,e)=>{ids.push(e.id);return {ok:false,status:mode};}},idFactory:()=> 'once'});
  c.setScope(scope);await tick();await c.store(captureVaultSkill('D',owner('D')));
  await c.refresh();assert.ok(c.snapshot().uncertain);assert.equal(ids.length,1);
  await c.retry();assert.deepEqual(ids,['once','once']);mode='session-changed';await c.retry();
  assert.deepEqual(c.snapshot().entries,[]);assert.equal(c.snapshot().ready,false);
});
test('storage names account explicitly, rejects logout, unknown transport and switched identity',async()=>{
  const id='00000000-0000-4000-8000-000000000001';let user='user',calls=0,mode='ok';
  const client={auth:{getSession:async()=>({data:{session:user?{user:{id:user}}:null}})},rpc:async(name,args)=>{
    calls++;assert.equal(args.p_game_account_id,id);assert.equal(name,'list_skill_vault');
    if(mode==='switch')user='other';return {data:[]};}};
  const s=createSkillVaultStorage(client),target={authUserId:'user',gameAccountId:id};
  assert.equal((await s.list(target)).ok,true);user=null;assert.equal((await s.list(target)).status,'session-changed');assert.equal(calls,1);
  user='user';mode='switch';assert.equal((await s.list(target)).status,'session-changed');
  user='user';client.rpc=async()=>{throw Error('offline');};assert.equal((await s.store(target,{id})).status,'unknown');
});
