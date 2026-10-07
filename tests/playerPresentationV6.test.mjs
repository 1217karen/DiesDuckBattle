import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyDuckPresentation,createEmptyDuckQuotes,createEmptyQuoteLine,createEmptyPlayerPresentation,LEGACY_QUOTE_PATHS,QUOTE_PATHS,quoteTimings,presentationForPersistence} from '../js/playerPresentationModel.js';
import {migrateOnlinePlayerPresentation,encodeOnlinePlayer,decodeOnlinePlayer} from '../js/onlinePlayerDto.js';
import {createEmptyDuck} from '../js/playerBuildModel.js';
import {buildBattlePresentationSnapshot} from '../js/battlePresentationSnapshot.js';
import {player,a,da,db} from './onlineSelectFixture.mjs';
const timing=(text,iconSlot=3)=>({lines:[{text,iconSlot,opponentEno:null},{text:' <b>追加</b> ',iconSlot:10,opponentEno:'9223372036854775807'}]});
function legacy(p,version){
 p.schemaVersion=version;p.battler.quotes.skill.A=timing(' A ');p.battler.quotes.skill.C=timing(' C ');
 for(const d of Object.values(p.ducks))delete d.quotes;
 if(version<5){delete p.battler.profile.message;delete p.battler.profile.messageTail;}
 if(version<4)delete p.battler.profile.showBestStreak;
 if(version<3)for(const path of LEGACY_QUOTE_PATHS){const parent=path.slice(0,-1).reduce((v,k)=>v[k],p.battler.quotes),l=parent[path.at(-1)].lines[0];parent[path.at(-1)]={text:l.text,iconSlot:l.iconSlot};}
 if(version===1){delete p.battler.profile;for(const d of Object.values(p.ducks))delete d.profile;}
 return p;
}
test('v6 allocates independent empty A/C and only B/D on Battler',()=>{
 const p=createEmptyPlayerPresentation(),d=createEmptyDuckPresentation(),e=createEmptyDuckPresentation();
 assert.equal(p.schemaVersion,6);assert.deepEqual(Object.keys(p.battler.quotes.skill),['B','D']);
 assert.deepEqual(d.quotes,{skill:{A:{lines:[createEmptyQuoteLine()]},C:{lines:[createEmptyQuoteLine()]}}});
 d.quotes.skill.A.lines[0].text='changed';assert.equal(e.quotes.skill.A.lines[0].text,'');assert.equal(d.quotes.skill.C.lines[0].text,'');
});
for(const version of [1,2,3,4,5])test(`v${version}: copy every A/C line to build, detached and absent-display Ducks without mutation`,async()=>{
 const {data}=await player(a,'1',da);data.build.ducks.push({...createEmptyDuck({idFactory:()=>db}),name:'second'});
 data.presentation.ducks.orphan=createEmptyDuckPresentation();legacy(data.presentation,version);
 const original=structuredClone(data),loaded=migrateOnlinePlayerPresentation(data.presentation,[da,db]);
 assert.deepEqual(data,original);assert.deepEqual(Object.keys(loaded.battler.quotes.skill).sort(),['B','D']);
 for(const path of QUOTE_PATHS){const old=path.reduce((v,k)=>v[k],original.presentation.battler.quotes);assert.deepEqual(path.reduce((v,k)=>v[k],loaded.battler.quotes),version<3?{lines:[{...old,opponentEno:null}]}:old);}
 for(const id of [da,db,'orphan'])for(const c of ['A','C']){
  const old=original.presentation.battler.quotes.skill[c];assert.deepEqual(loaded.ducks[id].quotes.skill[c],version<3?{lines:[{...old,opponentEno:null}]}:old);
 }
 assert.deepEqual(decodeOnlinePlayer(encodeOnlinePlayer(data)).presentation,loaded);
 const dto=encodeOnlinePlayer(data);dto.battler.presentation={schemaVersion:version,name:data.battlerName,...original.presentation.battler,detachedDuckPresentation:{orphan:original.presentation.ducks.orphan}};
 dto.ducks[0].presentation={schemaVersion:version,name:data.build.ducks[0].name,icon:original.presentation.ducks[da]};
 dto.ducks[1].presentation={schemaVersion:version,name:'second',icon:null};
 const before=structuredClone(dto);assert.deepEqual(decodeOnlinePlayer(dto).presentation,loaded);assert.deepEqual(dto,before);
 loaded.ducks[da].quotes.skill.A.lines[0].text='only first';assert.equal(loaded.ducks[db].quotes.skill.A.lines[0].text,' A ');assert.equal(loaded.ducks.orphan.quotes.skill.A.lines[0].text,' A ');
 for(const mutate of [p=>p.battler.quotes.skill.A.unknown=true,p=>p.battler.quotes.skill.C=42,p=>p.ducks.orphan.quotes={},p=>p.battler.quotes.skill.A[version<3?'iconSlot':'lines']='bad']){
  const bad=structuredClone(original.presentation);mutate(bad);assert.throws(()=>migrateOnlinePlayerPresentation(bad,[da,db]));
 }
});
test('v6 strict A/C types, limits, extra rows and pruning on both persistence boundaries',async()=>{
 const {data}=await player(a,'1',da);const p=data.presentation;p.ducks[da].quotes.skill.A=timing('😀'.repeat(200));
 p.ducks[da].quotes.skill.A.lines.push(createEmptyQuoteLine(),{text:' ',iconSlot:null,opponentEno:null});
 const before=structuredClone(p),dto=encodeOnlinePlayer(data);assert.deepEqual(p,before);
 assert.equal(dto.ducks[0].presentation.icon.quotes.skill.A.lines.length,3);
 assert.deepEqual(decodeOnlinePlayer(dto).presentation,presentationForPersistence(p));
 for(const mutate of [q=>q.skill.A.lines[0].text='😀'.repeat(201),q=>q.skill.C.lines=[],q=>q.skill.A.lines[0].text=1,q=>q.skill.A.lines[0].iconSlot=11,q=>q.skill.A.lines[0].opponentEno='1',q=>q.skill.A.lines[1].opponentEno='01',q=>q.skill.A.extra=true,q=>q.skill.B=timing('bad'),q=>delete q.skill.C]){
  const bad=structuredClone(data);mutate(bad.presentation.ducks[da].quotes);assert.throws(()=>encodeOnlinePlayer(bad));
  const stored=structuredClone(dto);mutate(stored.ducks[0].presentation.icon.quotes);assert.throws(()=>decodeOnlinePlayer(stored));
 }
 const bad=structuredClone(data);bad.presentation.battler.quotes.skill.A=timing('removed');assert.throws(()=>encodeOnlinePlayer(bad));
});
test('snapshot selects Duck A/C, Battler B/D and Battler icons without changing result contract',async()=>{
 const {data}=await player(a,'1',da),p=data.presentation;p.battler.iconSlots[2]='face3';p.battler.iconSlots[9]='face10';
 p.ducks[db]=createEmptyDuckPresentation();p.ducks[da].iconUrl='NOT-A-FACE';
 for(const id of [da,db])for(const c of ['A','C'])p.ducks[id].quotes.skill[c]=timing(id+c);
 p.battler.quotes.skill.B=timing('B',10);p.battler.quotes.skill.D=timing('D',null);
 for(const id of [da,db]){const s=buildBattlePresentationSnapshot(p,id);assert.deepEqual(Object.keys(s.quotes.skill),['A','B','C','D']);
  for(const c of ['A','C'])assert.deepEqual(s.quotes.skill[c],{text:id+c,iconUrl:'face3'});
  assert.deepEqual(s.quotes.skill.B,{text:'B',iconUrl:'face10'});assert.deepEqual(s.quotes.skill.D,{text:'D',iconUrl:p.battler.defaultIconUrl});
 }
 const absent=buildBattlePresentationSnapshot(p,'missing');assert.equal(absent.quotes.skill.A.text,'');assert.equal(absent.quotes.skill.C.text,'');assert.equal(absent.quotes.skill.B.text,'B');
 assert.equal(quoteTimings(p).length,16);
});

test('conflict rebase keeps untouched Ducks, Battler quotes and targeted deletion; new Duck gets empty quotes',async()=>{
 const {createOnlineEditController}=await import('../js/onlineEditController.js');
 const {data}=await player(a,'1',da);data.build.ducks.push({...createEmptyDuck({idFactory:()=>db}),name:'second'});data.presentation.ducks[db]=createEmptyDuckPresentation();data.presentation.ducks.orphan=createEmptyDuckPresentation();
 let row={ok:true,authUserId:'user',account:{id:a,eno:'1'},revision:'0',data};
 const storage={load:async()=>structuredClone(row),save:async(_base,draft)=>{row={...row,data:structuredClone(draft),revision:'2'};return structuredClone(row);}};
 const editor=createOnlineEditController({storage,sections:['presentation'],confirm:()=>true});await editor.load();
 const p=editor.snapshot().draft.presentation;p.ducks[da].quotes.skill.A=timing('local');editor.edit({presentation:p});
 row=structuredClone(row);row.data.presentation.ducks[db].quotes.skill.C=timing('remote second');row.data.presentation.battler.quotes.skill.B=timing('remote B');row.data.presentation.ducks.orphan.quotes.skill.A=timing('remote orphan');row.revision='1';
 await editor.compare();await editor.adoptLatest(true);await editor.save();
 assert.equal(row.data.presentation.ducks[da].quotes.skill.A.lines[0].text,'local');assert.equal(row.data.presentation.ducks[db].quotes.skill.C.lines[0].text,'remote second');assert.equal(row.data.presentation.battler.quotes.skill.B.lines[0].text,'remote B');assert.equal(row.data.presentation.ducks.orphan.quotes.skill.A.lines[0].text,'remote orphan');
 const setting=createOnlineEditController({storage,sections:['build','publicSettings'],allowDuckPresentationDeletion:true,confirm:()=>true});await setting.load();
 const build=structuredClone(row.data.build);build.ducks=build.ducks.filter(d=>d.id!==da);
 setting.edit({build,publicSettings:{schemaVersion:1,publicDuckId:db}},{deleteDuckPresentationIds:[da]});
 row.data.presentation.ducks[db].quotes.skill.A=timing('latest second');await setting.compare();await setting.adoptLatest(true);
 assert.equal(setting.snapshot().draft.presentation.ducks[da],undefined);assert.equal(setting.snapshot().draft.presentation.ducks[db].quotes.skill.A.lines[0].text,'latest second');
 const id='99999999-9999-4999-8999-999999999999',added=structuredClone(setting.snapshot().draft.build);added.ducks.push(createEmptyDuck({idFactory:()=>id}));setting.edit({build:added});
 assert.deepEqual(setting.snapshot().draft.presentation.ducks[id],createEmptyDuckPresentation());
});
