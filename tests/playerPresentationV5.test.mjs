import { legacyQuoteOwnership } from './legacyPresentationFixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyPlayerPresentation, LEGACY_QUOTE_PATHS, QUOTE_PATHS } from '../js/playerPresentationModel.js';
import { migrateOnlinePlayerPresentation, encodeOnlinePlayer, decodeOnlinePlayer } from '../js/onlinePlayerDto.js';
import { PROFILE_MESSAGE_MAX } from '../js/profileTextValidation.js';
import { decodeOnlineProfile } from '../js/onlineProfileService.js';
import { profileFixture } from './onlineProfileFixture.mjs';
import { player,a,da } from './onlineSelectFixture.mjs';

test('v5 defaults, 100 Unicode code points, plain text and save/reload',async()=>{
 const empty=createEmptyPlayerPresentation();assert.equal(empty.schemaVersion,6);
 assert.equal(empty.battler.profile.message,'');assert.equal(empty.battler.profile.messageTail,false);assert.equal(PROFILE_MESSAGE_MAX,100);
 const {data}=await player(a,'1',da);
 for(const message of ['😀'.repeat(100),'<b>plain</b>',' '])for(const messageTail of [false,true]){
  Object.assign(data.presentation.battler.profile,{message,messageTail});
  const dto=encodeOnlinePlayer(data);assert.equal(dto.ducks[0].presentation.schemaVersion,6);assert.deepEqual(decodeOnlinePlayer(dto),data);
 }
 data.presentation.battler.profile.message='😀'.repeat(101);assert.throws(()=>encodeOnlinePlayer(data));
});
for(const field of ['message','messageTail'])test(`v5 strict ${field} at persistence and public boundaries`,async()=>{
 const invalid=field==='message'?[undefined,null,0,false,[],{}]:[undefined,null,0,1,'true',[],{}];
 for(const value of invalid){
  const {data,snapshot}=await player(a,'1',da),profile=profileFixture();
  for(const p of [data.presentation.battler.profile,snapshot.battler.presentation.profile,profile.battler.profile]){
   if(value===undefined)delete p[field];else p[field]=value;
  }
  assert.throws(()=>encodeOnlinePlayer(data));assert.throws(()=>decodeOnlinePlayer(snapshot));assert.throws(()=>decodeOnlineProfile(profile));
 }
});
for(const version of [1,2,3,4])test(`v${version} -> v5 is lossless and rejects unknown legacy fields`,async()=>{
 const {data}=await player(a,'1',da),p=data.presentation;
 p.battler.profile.text=' old profile ';p.battler.profile.showBestStreak=false;
 p.battler.quotes.battleStart.lines[0].text='quote';
 p.ducks.orphan=structuredClone(p.ducks[da]);
 const expected=structuredClone(p);
 legacyQuoteOwnership(p);p.schemaVersion=version;delete p.battler.profile.message;delete p.battler.profile.messageTail;
 if(version<4){delete p.battler.profile.showBestStreak;expected.battler.profile.showBestStreak=true;}
 if(version<3)for(const path of (version<3 ? LEGACY_QUOTE_PATHS : QUOTE_PATHS)){const parent=path.slice(0,-1).reduce((v,k)=>v[k],p.battler.quotes),line=parent[path.at(-1)].lines[0];parent[path.at(-1)]={text:line.text,iconSlot:line.iconSlot};}
 if(version===1){delete p.battler.profile;expected.battler.profile=createEmptyPlayerPresentation().battler.profile;for(const d of Object.values(p.ducks))delete d.profile;}
 const before=structuredClone(p);assert.deepEqual(migrateOnlinePlayerPresentation(p),expected);assert.deepEqual(p,before);
 assert.deepEqual(decodeOnlinePlayer(encodeOnlinePlayer(data)).presentation,expected);
 const dto=encodeOnlinePlayer(data);dto.battler.presentation={...dto.battler.presentation,...p.battler,schemaVersion:version};
 if(version===1)delete dto.battler.presentation.profile;
 dto.battler.presentation.detachedDuckPresentation={orphan:p.ducks.orphan};
 dto.ducks[0].presentation.schemaVersion=version;dto.ducks[0].presentation.icon=p.ducks[da];
 assert.deepEqual(decodeOnlinePlayer(dto).presentation,expected);
 for(const mutate of [v=>v.battler.unknown=true,v=>v.ducks.orphan.unknown=true,v=>{if(v.battler.profile)v.battler.profile.message='future';else v.unknown=true;}]){
  const bad=structuredClone(p);mutate(bad);assert.throws(()=>migrateOnlinePlayerPresentation(bad));
 }
});
