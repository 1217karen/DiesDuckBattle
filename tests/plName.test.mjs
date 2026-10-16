import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyPlayerPresentation,presentationForPersistence,LEGACY_QUOTE_PATHS} from '../js/playerPresentationModel.js';
import {createEmptyPlayerBuild} from '../js/playerBuildModel.js';
import {encodeOnlinePlayer,decodeOnlinePlayer,migrateOnlinePlayerPresentation} from '../js/onlinePlayerDto.js';
import {plNameError} from '../js/plName.js';
import {createOnlineEditController} from '../js/onlineEditController.js';
import {decodeOnlineCharacters} from '../js/onlineCharacterListService.js';
import {decodeOnlineProfile} from '../js/onlineProfileService.js';
import {profileFixture} from './onlineProfileFixture.mjs';
const data=()=>({build:createEmptyPlayerBuild(),presentation:createEmptyPlayerPresentation(),battlerName:'テスト',publicSettings:{schemaVersion:1,publicDuckId:null}});
test('PL name defaults, Unicode limits, whitespace and strict optional persistence field',()=>{
 const d=data();assert.equal(d.presentation.battler.plName,'');
 for(const name of ['','雪だるま','😀'.repeat(30),'  雪だるま　']){
  d.presentation.battler.plName=name;const original=structuredClone(d);
  assert.equal(decodeOnlinePlayer(encodeOnlinePlayer(d)).presentation.battler.plName,name.trim());assert.deepEqual(d,original);
 }
 for(const invalid of [null,42,{},'x\ny','x\ry','x\u2028y','😀'.repeat(31)]){
  assert.ok(plNameError(invalid));d.presentation.battler.plName=invalid;assert.throws(()=>encodeOnlinePlayer(d));
 }
 const legacy=data().presentation;delete legacy.battler.plName;
 assert.equal(migrateOnlinePlayerPresentation(legacy).battler.plName,'');assert.equal(Object.hasOwn(legacy.battler,'plName'),false);
 const dto=encodeOnlinePlayer(data());delete dto.battler.presentation.plName;
 assert.equal(decodeOnlinePlayer(dto).presentation.battler.plName,'');
 dto.battler.presentation.unknown='keep strict';assert.throws(()=>decodeOnlinePlayer(dto));
 assert.equal(decodeOnlinePlayer({battler:{build:{},presentation:{name:'new'}},ducks:[],publicDuckId:null}).presentation.battler.plName,'');
});
test('PL changes use existing dirty guard; failed save/load retain draft and persisted name',async()=>{
 let row={ok:true,authUserId:'user',account:{id:'a',eno:'1'},revision:'0',data:data()},failSave=false,failLoad=false;
 const storage={load:async()=>failLoad?{ok:false,status:'load-failed',message:'load failed'}:structuredClone(row),save:async(_base,draft)=>{
  if(failSave)return{ok:false,status:'save-failed',message:'save failed'};
  row={...row,revision:String(+row.revision+1),data:decodeOnlinePlayer(encodeOnlinePlayer(draft))};return structuredClone(row);
 }};
 const editor=createOnlineEditController({storage,sections:['presentation'],confirm:()=>true});await editor.load();
 for(const name of ['最初のPL','変更したPL','']){
  const p=editor.snapshot().draft.presentation;p.battler.plName=name;editor.edit({presentation:presentationForPersistence(p)});
  assert.equal(editor.snapshot().dirty,true);assert.equal((await editor.canLeave({action:'select'})).ok,false);
  failSave=true;await editor.save();assert.equal(editor.snapshot().draft.presentation.battler.plName,name);assert.equal(editor.snapshot().dirty,true);
  failSave=false;await editor.compare();await editor.adoptLatest(true);await editor.save();assert.equal(row.data.presentation.battler.plName,name);assert.equal(editor.snapshot().dirty,false);
  await editor.load();assert.equal(editor.snapshot().draft.presentation.battler.plName,name);
 }
 const before=structuredClone(row);failLoad=true;await editor.load();assert.deepEqual(row,before);assert.equal(editor.snapshot().canSave,false);
});
test('public contracts accept only typed PL extension, preserve missing old DTO support',()=>{
 const profile=profileFixture();assert.doesNotThrow(()=>decodeOnlineProfile(profile));
 const row={eno:'1',battlerName:'A',battlerIconUrl:'',accent:'#123456',background:'#123456',panel:'#123456',text:'#123456',duck:null,bestStreak:0};
 for(const name of ['', 'PL😀']){assert.equal(decodeOnlineProfile({...profile,plName:name}).plName,name);assert.equal(decodeOnlineCharacters([{...row,plName:name}])[0].plName,name);}
 for(const name of [null,{},1,'x'.repeat(31),'x\ny']){assert.throws(()=>decodeOnlineProfile({...profile,plName:name}));assert.throws(()=>decodeOnlineCharacters([{...row,plName:name}]));}
});

for(const version of [1,2,3,4,5,6])test(`pre-PL Presentation v${version} upgrades without mutating stored data`,()=>{
 const p=createEmptyPlayerPresentation();p.schemaVersion=version;delete p.battler.plName;
 if(version<6){p.battler.quotes.skill.A={lines:[{text:'old A',iconSlot:null,opponentEno:null}]};p.battler.quotes.skill.C={lines:[{text:'old C',iconSlot:null,opponentEno:null}]};}
 if(version<5){delete p.battler.profile.message;delete p.battler.profile.messageTail;}
 if(version<4)delete p.battler.profile.showBestStreak;
 if(version<3)for(const path of LEGACY_QUOTE_PATHS){const parent=path.slice(0,-1).reduce((v,k)=>v[k],p.battler.quotes),line=parent[path.at(-1)].lines[0];parent[path.at(-1)]={text:line.text,iconSlot:line.iconSlot};}
 if(version===1)delete p.battler.profile;
 const before=structuredClone(p),result=migrateOnlinePlayerPresentation(p);assert.equal(result.battler.plName,'');assert.deepEqual(p,before);
 const d=data(),dto=encodeOnlinePlayer(d);dto.battler.presentation={schemaVersion:version,name:d.battlerName,...p.battler,detachedDuckPresentation:{}};
 assert.equal(decodeOnlinePlayer(dto).presentation.battler.plName,'');
});
