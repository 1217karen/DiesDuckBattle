import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeOnlineProfile, createOnlineProfileService } from '../js/onlineProfileService.js';
import { profileFixture, profileOptionSelections } from './onlineProfileFixture.mjs';

for (const [category, axis, selection] of profileOptionSelections) test(`known ${category} option ${axis} is lossless; unknown option rejected`, () => {
  const p = profileFixture(), owner = category === 'B' ? 'battler' : 'duck';
  p[owner].skills[category].selection = structuredClone(selection);
  assert.deepEqual(decodeOnlineProfile(p)[owner].skills[category].selection, selection);
  const selected = p[owner].skills[category].selection;
  const leaf = category === 'B' ? selected : category === 'A' ? selected.effects[0] : selected.structure.effects[0];
  leaf.options.unknownOption = 'private';
  assert.throws(() => decodeOnlineProfile(p), TypeError);
});

test('public profile decoder is lossless, detached, canonical and accepts incomplete stats', () => {
  const value=profileFixture(); value.eno='0001'; value.duck.profile.attributes=['🔥','a','炎'];
  value.duck.profile.text=' \n[bold]text[/bold] '; value.duck.profile.flavorStats=[{label:'',value:0},{label:'test',value:6}];
  const decoded=decodeOnlineProfile(value);
  assert.deepEqual(decoded,{...value,eno:'1'}); assert.notEqual(decoded.battler,value.battler);
  value.duck=null; value.featuredBattle=null; assert.equal(decodeOnlineProfile(value).duck,null);
});
for(const type of [null,'attack','defense','speed','heal','technical','normal'])
  test(`profile type ${type}`,()=>{const p=profileFixture();p.duck.profile.type=type;assert.equal(decodeOnlineProfile(p).duck.profile.type,type);});
for(const preset of ['default','kanji','english','hiragana'])
  test(`profile preset ${preset}`,()=>{const p=profileFixture();p.duck.profile.statLabelPreset=preset;assert.equal(decodeOnlineProfile(p).duck.profile.statLabelPreset,preset);});
const invalid = {
  future:p=>p.profileVersion=3, unknown:p=>p.private='secret', uuid:p=>p.accountId='bad', eno:p=>p.eno=0,
  owner:p=>p.isOwner=1, name:p=>p.battler.name=null, theme:p=>p.battler.profile.theme.accent='red',
  themeField:p=>p.battler.profile.theme.mode='light', iconRange:p=>p.battler.profileIcons[0].slot=0,
  iconRangeHigh:p=>p.battler.profileIcons[0].slot=11, iconDuplicate:p=>p.battler.profileIcons[1].slot=1,
  iconOrder:p=>p.battler.profileIcons.reverse(), iconCount:p=>p.battler.profileIcons=Array.from({length:5},(_,i)=>({slot:i+1,url:''})),
  iconUrl:p=>p.battler.profileIcons[0].url=null, iconField:p=>p.battler.profileIcons[0].private=true,
  rawFeatured:p=>p.battler.profile.featuredBattleId=null, label:p=>p.battler.skills.B.label.ruby=null,
  labelUnknown:p=>p.battler.skills.B.label.private='secret', selection:p=>p.battler.skills.B.selection={private:'secret'},
  optionUnknown:p=>p.battler.skills.B.selection={options:{private:'secret'}},
  duckId:p=>p.duck.id='bad', attributesCount:p=>p.duck.profile.attributes=[''], attributesType:p=>p.duck.profile.attributes[0]=1,
  attributesLength:p=>p.duck.profile.attributes[0]='🔥a', type:p=>p.duck.profile.type='future', preset:p=>p.duck.profile.statLabelPreset='future',
  flavorCount:p=>p.duck.profile.flavorStats=Array(3).fill({label:'',value:0}), flavorFraction:p=>p.duck.profile.flavorStats=[{label:'',value:1.5}],
  flavorHigh:p=>p.duck.profile.flavorStats=[{label:'',value:7}], flavorLow:p=>p.duck.profile.flavorStats=[{label:'',value:-1}],
  flavorField:p=>p.duck.profile.flavorStats=[{label:'',value:0,private:1}], stats:p=>p.duck.stats.AT='5', statField:p=>p.duck.stats.HP=100,
  cutin:p=>p.duck.cutinUrl='private', featuredId:p=>p.featuredBattle.battleId='bad', battleNo:p=>p.featuredBattle.battleNo=9007199254740992,
  date:p=>p.featuredBattle.dateISO='invalid', result:p=>p.featuredBattle.result='win', events:p=>p.featuredBattle.events=[],
  featuredSide:p=>p.featuredBattle.p1.loadout={}, missing:p=>delete p.duck.profile.text,
};
for(const [name,mutate] of Object.entries(invalid)) test(`reject malformed/unknown profile: ${name}`,()=>{
  const value=profileFixture();mutate(value);assert.throws(()=>decodeOnlineProfile(value),TypeError);
});
function clientFixture() {
  let user='caller',response={data:profileFixture()},failure=false,onRpc=()=>{};
  const calls=[];
  const client={auth:{getSession:async()=>({data:{session:user?{user:{id:user}}:null}})},
    from:()=>{throw Error('Account/table resolution forbidden');},rpc:async(name,args)=>{calls.push([name,args]);onRpc();if(failure)throw Error('private error');return response;}};
  return {service:createOnlineProfileService(client),calls,user:v=>user=v,response:v=>response=v,throw:()=>failure=true,onRpc:v=>onRpc=v};
}
test('service calls only dedicated ENo RPC, no own-account resolution',async()=>{
  const f=clientFixture();assert.equal((await f.service.getProfile('0001')).ok,true);
  assert.deepEqual(f.calls,[['get_online_profile',{p_eno:'1'}]]);
});
for(const [response,status] of [[{data:null},'profile-not-found'],[{error:{code:'PGRST202'}},'migration-required'],
  [{error:{code:'42883'}},'migration-required'],[{error:{code:'42501'}},'forbidden'],[{error:{code:'22023'}},'unsupported-data'],
  [{error:{code:'network'}},'load-failed'],[{data:{}},'unsupported-data']])
  test(`service ${status} ${JSON.stringify(response)}`,async()=>{const f=clientFixture();f.response(response);assert.equal((await f.service.getProfile(1)).status,status);});
test('service rejects wrong ENo and invalid inputs',async()=>{
  const f=clientFixture();assert.equal((await f.service.getProfile(2)).status,'unsupported-data');
  for(const eno of [null,0,-1,'x',9007199254740992])assert.equal((await f.service.getProfile(eno)).status,'invalid-eno');
});
test('service normalizes thrown network errors',async()=>{const f=clientFixture();f.throw();assert.equal((await f.service.getProfile(1)).status,'load-failed');});
for(const user of [null,'different'])for(const throws of [false,true])test(`identity change during RPC (${user}, throw=${throws})`,async()=>{
  const f=clientFixture();f.onRpc(()=>f.user(user));if(throws)f.throw();assert.equal((await f.service.getProfile(1)).status,'session-changed');
});
test('signed out caller makes no RPC',async()=>{const f=clientFixture();f.user(null);assert.equal((await f.service.getProfile(1)).status,'not-signed-in');assert.equal(f.calls.length,0);});
