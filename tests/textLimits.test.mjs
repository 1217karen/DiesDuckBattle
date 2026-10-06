import test from 'node:test';
import assert from 'node:assert/strict';
import { BATTLER_NAME_MAX, DUCK_NAME_MAX, battlerNameError, duckNameError, duckNameIssues, codePointLength } from '../js/nameValidation.js';
import { BATTLER_PROFILE_MAX, DUCK_PROFILE_MAX, FLAVOR_LABEL_WIDTH_MAX, textDisplayWidth, presentationTextIssues } from '../js/profileTextValidation.js';
import { SKILL_NAME_MAX, SKILL_RUBY_MAX, validSkillLabel } from '../js/skillLabels.js';
import { clonePlayerBuild, updateDuck } from '../js/playerBuildModel.js';
import { migratePlayerBuild } from '../js/playerBuildMigration.js';
import { createPlayerBuildStorage, PLAYER_BUILD_STORAGE_KEY } from '../js/playerBuildStorage.js';
import { createPlayerPresentationStorage, PLAYER_PRESENTATION_STORAGE_KEY } from '../js/playerPresentationStorage.js';
import { encodeOnlinePlayer, decodeOnlinePlayer } from '../js/onlinePlayerDto.js';
import { createEmptyDuckProfile, QUOTE_PATHS } from '../js/playerPresentationModel.js';
import { registrationInput, createAuthService } from '../js/authService.js';
import { validateRegistration, registerAccount } from '../supabase/functions/_shared/registration.mjs';
import { createRegistrationHandler } from '../supabase/functions/_shared/registration-handler.mjs';
import { player, a, da } from './onlineSelectFixture.mjs';
const memory=(key,data)=>{let raw=JSON.stringify(data),writes=0;return {getItem:k=>k===key?raw:null,setItem(k,v){writes++;raw=v;},get writes(){return writes;}};};

test('shared text constants and code point counting',()=>{
 assert.deepEqual([BATTLER_NAME_MAX,DUCK_NAME_MAX,SKILL_NAME_MAX,SKILL_RUBY_MAX,BATTLER_PROFILE_MAX,DUCK_PROFILE_MAX,FLAVOR_LABEL_WIDTH_MAX],[15,15,20,50,2000,300,10]);
 assert.equal(codePointLength('😀aあ'),3);
});
for(const char of ['a','あ','😀'])test(`name and skill exact boundaries: ${char}`,async()=>{
 const {data}=await player(a,'1',da);
 for(const error of [battlerNameError,duckNameError]){assert.equal(error(char.repeat(15)),'');assert.ok(error(char.repeat(16)));assert.ok(error('　 '));}
 data.battlerName=char.repeat(15);data.build.ducks[0].name=char.repeat(15);assert.doesNotThrow(()=>encodeOnlinePlayer(data));
 data.battlerName=char.repeat(16);assert.throws(()=>encodeOnlinePlayer(data));data.battlerName='valid';
 data.build.ducks[0].name=char.repeat(16);assert.equal(duckNameIssues(data.build)[0].code,'NAME_TOO_LONG');assert.throws(()=>clonePlayerBuild(data.build));assert.throws(()=>encodeOnlinePlayer(data));
 assert.equal(validSkillLabel({name:char.repeat(20),ruby:char.repeat(50)}),true);
 assert.equal(validSkillLabel({name:char.repeat(21),ruby:''}),false);assert.equal(validSkillLabel({name:'',ruby:char.repeat(51)}),false);
});
for(const [text,width]of [['abcdefghij',10],['abcdefghijk',11],['あいうえお',10],['あいうえおか',12],['abcあいう',9],['ｱｲｳｴｵ',5],['｡｢｣､･',5],['😀',2],['Ａ',2]])test(`flavor width ${JSON.stringify(text)} = ${width}`,async()=>{
 assert.equal(textDisplayWidth(text),width);const {data}=await player(a,'1',da);
 data.presentation.ducks[da].profile.flavorStats=[{label:text,value:0}];
 assert.equal(presentationTextIssues(data.presentation).length,width>10?1:0);
 if(width>10)assert.throws(()=>encodeOnlinePlayer(data));else assert.deepEqual(decodeOnlinePlayer(encodeOnlinePlayer(data)),data);
});
for(const char of ['a','😀'])test(`profile boundaries and tags count code points: ${char}`,async()=>{
 const {data}=await player(a,'1',da);data.presentation.battler.profile.text=char.repeat(2000);data.presentation.ducks[da].profile.text=char.repeat(300);
 assert.deepEqual(decodeOnlinePlayer(encodeOnlinePlayer(data)),data);
 data.presentation.battler.profile.text+='<b></b>';assert.throws(()=>encodeOnlinePlayer(data));assert.equal(data.presentation.battler.profile.text,char.repeat(2000)+'<b></b>');
 data.presentation.battler.profile.text=char.repeat(2001);assert.throws(()=>encodeOnlinePlayer(data));data.presentation.battler.profile.text='';
 data.presentation.ducks[da].profile.text=char.repeat(301);assert.throws(()=>encodeOnlinePlayer(data));data.presentation.ducks[da].profile.text='';
 data.presentation.ducks.detached={iconUrl:'',cutinUrl:'',profile:{...createEmptyDuckProfile(),text:'a'.repeat(301)}};assert.throws(()=>encodeOnlinePlayer(data));
 data.presentation.ducks.detached.profile.text='';data.presentation.ducks.detached.profile.flavorStats=[{label:'あ'.repeat(6),value:6}];assert.throws(()=>encodeOnlinePlayer(data));
});
for(const version of [1,2,3])test(`old v${version} oversized stored data loads losslessly but cannot be saved`,async()=>{
 const {data}=await player(a,'1',da);const dto=encodeOnlinePlayer(data);
 delete dto.battler.presentation.profile.showBestStreak;dto.battler.presentation.schemaVersion=version;dto.ducks[0].presentation.schemaVersion=version;
 dto.battler.presentation.name='😀'.repeat(16);dto.ducks[0].presentation.name='あ'.repeat(16);
 dto.battler.build.skillLabels.B={name:'a'.repeat(21),ruby:'😀'.repeat(51)};
 if(version<3)for(const path of QUOTE_PATHS){const p=path.slice(0,-1).reduce((v,k)=>v[k],dto.battler.presentation.quotes);const first=p[path.at(-1)].lines[0];p[path.at(-1)]={text:first.text,iconSlot:first.iconSlot};}
 if(version===1){delete dto.battler.presentation.profile;delete dto.ducks[0].presentation.icon.profile;}
 else {
  dto.battler.presentation.profile.text='😀'.repeat(2001);
  dto.ducks[0].presentation.icon.profile.text='😀'.repeat(301);
  dto.battler.presentation.detachedDuckPresentation.orphan={iconUrl:'',cutinUrl:'',profile:{...createEmptyDuckProfile(),text:'a'.repeat(301),flavorStats:[{label:'abcdefghiあ',value:6}]}};
 }
 const before=structuredClone(dto),loaded=decodeOnlinePlayer(dto);assert.deepEqual(dto,before);
 assert.equal(loaded.battlerName,dto.battler.presentation.name);assert.equal(loaded.build.ducks[0].name,dto.ducks[0].presentation.name);assert.deepEqual(loaded.build.battler.skillLabels.B,dto.battler.build.skillLabels.B);
 if(version>1){assert.equal(loaded.presentation.battler.profile.text,dto.battler.presentation.profile.text);assert.deepEqual(loaded.presentation.ducks.orphan,dto.battler.presentation.detachedDuckPresentation.orphan);}
 assert.throws(()=>encodeOnlinePlayer(loaded));
 const buildStore=memory(PLAYER_BUILD_STORAGE_KEY,loaded.build),repo=createPlayerBuildStorage(buildStore);assert.deepEqual(repo.load().build,loaded.build);assert.equal(repo.save(loaded.build).ok,false);assert.equal(buildStore.writes,0);
 const draft=updateDuck(loaded.build,da,{name:' 改名 '});assert.equal(draft.ducks[0].name,' 改名 ');assert.equal(draft.battler.skillLabels.B.name,'a'.repeat(21));
 assert.equal(migratePlayerBuild(loaded.build).ok,true);
 if(version>1){const store=memory(PLAYER_PRESENTATION_STORAGE_KEY,loaded.presentation),pres=createPlayerPresentationStorage(store);assert.deepEqual(pres.load().presentation,loaded.presentation);assert.equal(pres.save(loaded.presentation).ok,false);assert.equal(store.writes,0);}
});
for(const char of ['a','😀'])test(`registration length validation before all effects: ${char}`,async()=>{
 const valid={characterName:char.repeat(15),password:'abc123',confirmation:'abc123'};
 assert.ok(validateRegistration(valid));assert.equal(registrationInput(valid).ok,true);
 const invalid={...valid,characterName:char.repeat(16)};assert.equal(validateRegistration(invalid),null);assert.equal(registrationInput(invalid).ok,false);
 const dependencies={client:new Proxy({},{get(){assert.fail('no client access');}}),uuid(){assert.fail('no UUID');}};
 assert.deepEqual(await registerAccount(invalid,dependencies),{status:400,body:{ok:false,error:'invalid_input'}});
 const handler=createRegistrationHandler({createAdminClient(){assert.fail('no admin initialization');},uuid(){assert.fail('no UUID');}});
 const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(invalid)}));assert.equal(response.status,400);assert.deepEqual(await response.json(),{ok:false,error:'invalid_input'});
 const service=createAuthService({config:{},fetchImpl(){assert.fail('no request');}});assert.equal((await service.register(invalid)).ok,false);
});
test('names and profile whitespace survive saves without trim',async()=>{
 const {data}=await player(a,'1',da);data.battlerName='  名前  ';data.build.ducks[0].name='  アヒル  ';data.presentation.battler.profile.text=' \n ';
 data.presentation.ducks[da].profile={...createEmptyDuckProfile(),text:' \n ',flavorStats:[{label:' ',value:0}]};
 assert.deepEqual(decodeOnlinePlayer(encodeOnlinePlayer(data)),data);
});
