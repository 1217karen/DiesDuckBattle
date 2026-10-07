import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyPlayerPresentation,PLAYER_PRESENTATION_SCHEMA_VERSION,QUOTE_PATHS,createEmptyDuckProfile} from '../js/playerPresentationModel.js';
import {migrateOnlinePlayerPresentation,encodeOnlinePlayer,decodeOnlinePlayer} from '../js/onlinePlayerDto.js';
import {player,a,da} from './onlineSelectFixture.mjs';
test('v4 default and strict boolean/unknown fields',async()=>{
 assert.equal(PLAYER_PRESENTATION_SCHEMA_VERSION,5);assert.equal(createEmptyPlayerPresentation().battler.profile.showBestStreak,true);
 for(const value of [undefined,null,0,1,'true',[],{}]){
  const {data}=await player(a,'1',da);if(value===undefined)delete data.presentation.battler.profile.showBestStreak;else data.presentation.battler.profile.showBestStreak=value;
  assert.throws(()=>encodeOnlinePlayer(data));
  const {snapshot}=await player(a,'1',da);if(value===undefined)delete snapshot.battler.presentation.profile.showBestStreak;else snapshot.battler.presentation.profile.showBestStreak=value;assert.throws(()=>decodeOnlinePlayer(snapshot));
 }
 const {data}=await player(a,'1',da);data.presentation.battler.profile.showBestStreak=false;
 assert.deepEqual(decodeOnlinePlayer(encodeOnlinePlayer(data)),data);
 data.presentation.battler.profile.secret=1;assert.throws(()=>encodeOnlinePlayer(data));
});
for(const version of [1,2,3])test(`v${version} strictly migrates losslessly to v4`,async()=>{
 const {data}=await player(a,'1',da),p=data.presentation;
 p.battler.profile.text='profile';p.battler.profile.theme.accent='#aBcDeF';p.battler.profile.featuredBattleId=da;
 p.ducks.orphan={iconUrl:'detached',cutinUrl:'private',profile:{...createEmptyDuckProfile(),text:'orphan'}};
 p.battler.quotes.battleStart.lines[0].text='primary';p.battler.quotes.battleStart.lines[0].iconSlot=2;
 if(version===3)p.battler.quotes.battleStart.lines.push({text:'extra',iconSlot:3,opponentEno:'15'});
 if(version<3)for(const path of QUOTE_PATHS){const parent=path.slice(0,-1).reduce((v,k)=>v[k],p.battler.quotes),l=parent[path.at(-1)].lines[0];parent[path.at(-1)]={text:l.text,iconSlot:l.iconSlot};}
 p.schemaVersion=version;delete p.battler.profile.showBestStreak;delete p.battler.profile.message;delete p.battler.profile.messageTail;
 if(version===1){delete p.battler.profile;for(const d of Object.values(p.ducks))delete d.profile;}
 const before=structuredClone(p),loaded=migrateOnlinePlayerPresentation(p);assert.deepEqual(p,before);
 assert.equal(loaded.schemaVersion,5);assert.equal(loaded.battler.profile.showBestStreak,true);
 if(version>1){assert.deepEqual(loaded.battler.profile,{...p.battler.profile,message:"",messageTail:false,showBestStreak:true});assert.deepEqual(loaded.ducks,p.ducks);}
 if(version===3)assert.deepEqual(loaded.battler.quotes,p.battler.quotes);
 assert.deepEqual(decodeOnlinePlayer(encodeOnlinePlayer({...data,presentation:p})).presentation,loaded);
 p.battler.unknown=true;assert.throws(()=>migrateOnlinePlayerPresentation(p));
});
