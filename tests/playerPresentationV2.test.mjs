import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyPlayerPresentation, createEmptyBattlerProfile, createEmptyDuckProfile, normalizePlayerPresentation, QUOTE_PATHS } from '../js/playerPresentationModel.js';
import { encodeOnlinePlayer, decodeOnlinePlayer, migrateOnlinePlayerPresentation } from '../js/onlinePlayerDto.js';
import { buildBattlePresentationSnapshot } from '../js/battlePresentationSnapshot.js';
import { player, a, da } from './onlineSelectFixture.mjs';

const populated = async () => {
  const {data} = await player(a, '1', da);
  data.presentation.battler.profile = { text:'  [b]本文[/b]\n'.repeat(10), iconSlots:[1,3,7,10],
    theme:{background:'#abcdef',panel:'#123456',text:'#fedcba',accent:'#ABCDEF'}, featuredBattleId:da,message:"",messageTail:false,showBestStreak:true };
  data.presentation.ducks[da].profile = {text:'Duck本文',type:'technical',attributes:['炎','😀',''],statLabelPreset:'hiragana',flavorStats:[{label:'食欲',value:0},{label:'',value:6}]};
  data.presentation.ducks.detached = {iconUrl:'',cutinUrl:'private',profile:{...createEmptyDuckProfile(),text:'独立',type:'heal'}};
  return data;
};

test('v2 complete defaults and independently allocated profiles', () => {
  const p=createEmptyPlayerPresentation();assert.equal(p.schemaVersion,5);
  assert.deepEqual(p.battler.profile,{text:'',iconSlots:[],theme:{background:'#DCEEF3',panel:'#FFFFFF',text:'#20282C',accent:'#4F91B3'},featuredBattleId:null,message:"",messageTail:false,showBestStreak:true});
  const n=normalizePlayerPresentation({ducks:{a:{},b:{}}});
  assert.deepEqual(n.ducks.a.profile,{text:'',type:null,attributes:['','',''],statLabelPreset:'default',flavorStats:[]});
  n.ducks.a.profile.attributes[0]='火';assert.equal(n.ducks.b.profile.attributes[0],'');
  p.battler.profile.theme.text='#000000';assert.equal(createEmptyBattlerProfile().theme.text,'#20282C');
});

test('v1 explicit migration preserves every display field; next save is v2',async()=>{
  const data=await populated();data.presentation.battler.standingImageUrl='standing';
  data.presentation.battler.iconSlots=Array.from({length:10},(_,i)=>String(i));
  const dto=encodeOnlinePlayer(data);dto.battler.presentation.schemaVersion=1;delete dto.battler.presentation.profile;
  for(const d of dto.ducks){d.presentation.schemaVersion=1;delete d.presentation.icon.profile;}
  for(const d of Object.values(dto.battler.presentation.detachedDuckPresentation))delete d.profile;
  for (const path of QUOTE_PATHS) {
    const parent=path.slice(0,-1).reduce((v,k)=>v[k],dto.battler.presentation.quotes),line=parent[path.at(-1)].lines[0];
    parent[path.at(-1)]={text:line.text,iconSlot:line.iconSlot};
  }
  const before=structuredClone(dto),loaded=decodeOnlinePlayer(dto);
  assert.deepEqual(dto,before);assert.equal(loaded.presentation.schemaVersion,5);
  const expected=structuredClone(data);expected.presentation.battler.profile=createEmptyBattlerProfile();
  for(const d of Object.values(expected.presentation.ducks))d.profile=createEmptyDuckProfile();
  assert.deepEqual(loaded,expected);assert.equal(encodeOnlinePlayer(loaded).battler.presentation.schemaVersion,5);
});

test('v2 lossless roundtrip includes detached profile, empty selected URLs and no shared objects',async()=>{
  const data=await populated(),before=structuredClone(data),dto=encodeOnlinePlayer(data),loaded=decodeOnlinePlayer(dto);
  assert.equal(dto.dtoVersion,1);assert.deepEqual(loaded,data);assert.deepEqual(data,before);
  loaded.presentation.ducks.detached.profile.text='changed';assert.equal(data.presentation.ducks.detached.profile.text,'独立');
  assert.deepEqual(loaded.presentation.battler.profile.iconSlots,[1,3,7,10]);
  assert.equal(loaded.presentation.battler.iconSlots[0],'');
  assert.equal(JSON.stringify(buildBattlePresentationSnapshot(data.presentation,da)).includes('profile'),false);
});

const badBattler = [
  p=>p.text=1,p=>p.iconSlots=[0],p=>p.iconSlots=[11],p=>p.iconSlots=[1.5],p=>p.iconSlots=['1'],
  p=>p.iconSlots=[1,2,3,4,5],p=>p.iconSlots=[1,1],p=>p.iconSlots=[3,1],p=>p.iconSlots=null,
  p=>p.theme.background='red',p=>p.theme.panel='#abc',p=>p.theme.text='url(x)',p=>p.theme.accent=null,
  p=>p.theme.mode='dark',p=>delete p.theme.text,p=>p.featuredBattleId='not-a-uuid',p=>p.extra=true
];
const badDuck = [
  p=>p.text=null,p=>p.type='unknown',p=>p.type='',p=>p.attributes=['炎',''],p=>p.attributes=['','','',''],
  p=>p.attributes=['炎闇','',''],p=>p.attributes=[1,'',''],p=>p.attributes=['e\u0301','',''],
  p=>p.statLabelPreset='custom',p=>p.flavorStats=[{label:'',value:-1}],p=>p.flavorStats=[{label:'',value:7}],
  p=>p.flavorStats=[{label:'',value:1.5}],p=>p.flavorStats=[{label:1,value:0}],p=>p.flavorStats=[{label:'',value:0,extra:1}],
  p=>p.flavorStats=Array(3).fill({label:'',value:1}),p=>p.AT=1,p=>delete p.type
];
for(const [kind,mutations] of [['battler',badBattler],['duck',badDuck]])for(const [i,mutate] of mutations.entries()){
 test(`strict ${kind} profile rejects malformed/unknown ${i} on encode and decode`,async()=>{
  const data=await populated(),dto=encodeOnlinePlayer(data);
  mutate(kind==='battler'?data.presentation.battler.profile:data.presentation.ducks[da].profile);
  mutate(kind==='battler'?dto.battler.presentation.profile:dto.ducks[0].presentation.icon.profile);
  assert.throws(()=>encodeOnlinePlayer(data));assert.throws(()=>decodeOnlinePlayer(dto));
 });
}

test('strict versions, nested unknowns, missing v2 profile and legacy unknowns never normalize away',async()=>{
 for(const version of [0,6,99,'2',null]){const data=await populated();data.presentation.schemaVersion=version;assert.throws(()=>encodeOnlinePlayer(data));}
 for(const mutate of [d=>d.battler.presentation.schemaVersion=99,d=>d.ducks[0].presentation.schemaVersion=99,
  d=>delete d.battler.presentation.profile,d=>delete d.ducks[0].presentation.icon.profile,
  d=>d.battler.presentation.detachedDuckPresentation.detached.profile.unknown=1,
  d=>{d.battler.presentation.schemaVersion=1;},d=>{d.ducks[0].presentation.schemaVersion=1;},
  d=>d.ducks[0].presentation.extra=1]){
  const dto=encodeOnlinePlayer(await populated());mutate(dto);assert.throws(()=>decodeOnlinePlayer(dto));
 }
 const old=createEmptyPlayerPresentation();old.schemaVersion=1;delete old.battler.profile;old.battler.unknown=1;
 assert.throws(()=>migrateOnlinePlayerPresentation(old));
});

test('all flavor enum values and hex case roundtrip without coercion',async()=>{
 for(const type of [null,'attack','defense','speed','heal','technical','normal'])for(const preset of ['default','kanji','english','hiragana']){
  const data=await populated();Object.assign(data.presentation.ducks[da].profile,{type,statLabelPreset:preset});
  assert.deepEqual(decodeOnlinePlayer(encodeOnlinePlayer(data)),data);
 }
});

test('local normalization sorts unique slots but online boundary requires canonical order',()=>{
 const p=createEmptyPlayerPresentation();p.battler.profile.iconSlots=[7,1,7,3];
 assert.deepEqual(normalizePlayerPresentation(p).battler.profile.iconSlots,[1,3,7]);
 assert.throws(()=>migrateOnlinePlayerPresentation(p));
});
