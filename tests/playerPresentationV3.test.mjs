import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_PRESENTATION_SCHEMA_VERSION, QUOTE_PATHS, QUOTE_TEXT_MAX, createEmptyPlayerPresentation, presentationForPersistence } from '../js/playerPresentationModel.js';
import { migrateOnlinePlayerPresentation, encodeOnlinePlayer, decodeOnlinePlayer } from '../js/onlinePlayerDto.js';
import { buildBattlePresentationSnapshot } from '../js/battlePresentationSnapshot.js';
import { createQuoteEnoLookup } from '../js/quoteEnoLookup.js';
import { player,a,da } from './onlineSelectFixture.mjs';
const at=(p,path)=>path.reduce((v,k)=>v[k],p.battler.quotes);
const extra=(text='extra',opponentEno='15')=>({text,iconSlot:10,opponentEno});

test('v3 defaults: all timings have independent primary lines with null ENo',()=>{
 assert.equal(PLAYER_PRESENTATION_SCHEMA_VERSION,4);assert.equal(QUOTE_TEXT_MAX,200);
 const p=createEmptyPlayerPresentation();for(const path of QUOTE_PATHS)assert.deepEqual(at(p,path),{lines:[{text:'',iconSlot:null,opponentEno:null}]});
 at(p,QUOTE_PATHS[0]).lines[0].text='change';assert.equal(at(p,QUOTE_PATHS[1]).lines[0].text,'');
});
for(const version of [1,2])test(`v${version} strictly migrates every text/icon without truncation or profile loss`,async()=>{
 const {data}=await player(a,'1',da);const p=data.presentation;p.schemaVersion=version;delete p.battler.profile.showBestStreak;
 for(const [i,path] of QUOTE_PATHS.entries()){
  const parent=path.slice(0,-1).reduce((v,k)=>v[k],p.battler.quotes);
  parent[path.at(-1)]={text:' <b>😀</b>\n'.repeat(30)+i,iconSlot:i%10+1};
 }
 if(version===1){delete p.battler.profile;for(const d of Object.values(p.ducks))delete d.profile;}
 else{p.battler.profile.text='profile';p.ducks[da].profile.text='Duck';}
 const before=structuredClone(p),m=migrateOnlinePlayerPresentation(p);assert.deepEqual(p,before);
 for(const path of QUOTE_PATHS){const old=at(p,path);assert.deepEqual(at(m,path).lines,[{...old,opponentEno:null}]);}
 if(version===2){assert.deepEqual(m.battler.profile,{...p.battler.profile,showBestStreak:true});assert.deepEqual(m.ducks,p.ducks);}
 const valid=structuredClone(p);for(const path of QUOTE_PATHS)at(valid,path).text='valid';
 const dto=encodeOnlinePlayer({...data,presentation:valid});
 dto.battler.presentation={...dto.battler.presentation,...p.battler,schemaVersion:version};
 if(version===1)delete dto.battler.presentation.profile;
 for(const d of dto.ducks){d.presentation.schemaVersion=version;d.presentation.icon=p.ducks[d.id];}
 assert.deepEqual(decodeOnlinePlayer(dto).presentation,m);
 assert.throws(()=>encodeOnlinePlayer({...data,presentation:m}));
 const bad=structuredClone(p);at(bad,QUOTE_PATHS[0]).unknown=true;assert.throws(()=>migrateOnlinePlayerPresentation(bad));
});
const mutations=[
 p=>p.battler.quotes.battleStart.unknown=true,
 p=>p.battler.quotes.battleStart.lines=[],
 p=>p.battler.quotes.battleStart.lines[0].unknown=true,
 ...[0,11,1.5,'1'].map(value=>p=>p.battler.quotes.battleStart.lines[0].iconSlot=value),
 ...['0','01','-1','1.5','abc','9223372036854775808',15,''].map(value=>p=>p.battler.quotes.battleStart.lines.push(extra('text',value))),
 p=>p.battler.quotes.battleStart.lines[0].opponentEno='15',
 p=>p.battler.quotes.battleStart.lines[0].text='😀'.repeat(201),
 p=>p.battler.quotes.battleStart.lines[0].text='<b>'+'a'.repeat(194)+'</b>'
];
for(const [i,mutate] of mutations.entries())test(`v3 strict encode/decode rejects malformed line ${i}`,async()=>{
 const {data}=await player(a,'1',da);mutate(data.presentation);assert.throws(()=>encodeOnlinePlayer(data));
 const {snapshot}=await player(a,'1',da);const p={battler:snapshot.battler.presentation};mutate(p);assert.throws(()=>decodeOnlinePlayer(snapshot));
});
test('exact 200 code points and tags, max bigint, whitespace, empty pruning and snapshot privacy',async()=>{
 const {data}=await player(a,'1',da);const p=data.presentation;
 for(const path of QUOTE_PATHS)at(p,path).lines=[{text:'😀'.repeat(200),iconSlot:1,opponentEno:null},extra('',null),extra(' ',null),extra('\n','9223372036854775807'),extra('<b>'+'a'.repeat(193)+'</b>')];
 const before=structuredClone(p),encoded=encodeOnlinePlayer(data),loaded=decodeOnlinePlayer(encoded);
 assert.deepEqual(p,before);assert.equal(encoded.battler.presentation.schemaVersion,4);assert.equal(encoded.ducks[0].presentation.schemaVersion,4);
 assert.deepEqual(loaded.presentation,presentationForPersistence(p));
 for(const path of QUOTE_PATHS)assert.equal(at(loaded.presentation,path).lines.length,4);
 const snap=buildBattlePresentationSnapshot(p,da);
 for(const path of QUOTE_PATHS)assert.deepEqual(path.reduce((v,k)=>v[k],snap.quotes),{text:'😀'.repeat(200),iconUrl:p.battler.defaultIconUrl});
 assert.doesNotMatch(JSON.stringify(snap),/opponentEno|lines|9223372036854775807/);
});
test('ENo lookup debounce, stale responses, missing name, failures and disposal',async()=>{
 let now=0,seq=0;const tasks=new Map(),calls=[],pending=[];let message;
 const lookup=createQuoteEnoLookup(eno=>{calls.push(eno);return new Promise((resolve,reject)=>pending.push({resolve,reject}));},v=>message=v,
 {schedule:(fn,delay)=>{const id=++seq;tasks.set(id,{fn,at:now+delay});return id;},cancel:id=>tasks.delete(id)});
 const tick=ms=>{now+=ms;for(const [id,task]of tasks)if(task.at<=now){tasks.delete(id);void task.fn();}};
 const flush=async()=>{await Promise.resolve();await Promise.resolve();};
 for(const value of ['','01','0','-1','1.5','9223372036854775808'])lookup.update(value);
 tick(500);assert.equal(calls.length,0);
 lookup.update('1');tick(200);lookup.update('15');tick(399);assert.equal(calls.length,0);tick(1);assert.deepEqual(calls,['15']);
 lookup.update('16');tick(400);pending[1].resolve({ok:true,profile:{battler:{name:'師匠'}}});await flush();assert.equal(message,'ENo.16 師匠');
 pending[0].resolve({ok:true,profile:{battler:{name:'古い'}}});await flush();assert.equal(message,'ENo.16 師匠');
 lookup.update('99');tick(400);pending[2].resolve({ok:false,status:'profile-not-found'});await flush();assert.equal(message,'ENo.99 該当なし');
 lookup.update('17');tick(400);pending[3].reject(Error());await flush();assert.equal(message,'確認できません');
 lookup.update('18');tick(400);lookup.dispose();pending[4].resolve({ok:true,profile:{battler:{name:'破棄'}}});await flush();assert.equal(message,'');
});
