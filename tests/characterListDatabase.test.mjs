import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {a,b,da,db as duckB,player} from './onlineSelectFixture.mjs';
import {encodeOnlinePlayer} from '../js/onlinePlayerDto.js';
import {decodeOnlineCharacters} from '../js/onlineCharacterListService.js';
let PGlite;if(process.env.PGLITE_MODULE)({PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE)));
const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',third='66666666-6666-4666-8666-666666666666';
const migration='20261006120000_character_list_and_best_streak.sql';
test('character list privacy, record atomicity, backfill and ACL in local Postgres',{skip:!PGlite&&'Set PGLITE_MODULE'},async t=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
 for(const f of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')&&f<migration).sort())await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
 await db.exec(`insert into auth.users values ('${user}'),('${other}');insert into public.game_accounts(id) values ('${a}'),('${b}'),('${third}');
 insert into public.game_account_access(auth_user_id,game_account_id) values ('${user}','${a}'),('${other}','${b}');
 insert into public.battlers(game_account_id,presentation) values ('${a}','{"name":"A"}'),('${b}','{"name":"B"}'),('${third}','{"name":"new"}');
 insert into public.ducks(id,game_account_id) values ('${da}','${a}'),('${duckB}','${b}');`);
 const asUser=id=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`);
 const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0].data;
 const side=(id,duck)=>({battlerId:id,duckId:duck,battlerName:'name',duckName:'duck',presentation:{}});
 const save=async(mode='random',result='P1_win',reverse=false,bad=false)=>{const p1=reverse?side(b,duckB):side(a,da),p2=reverse?side(a,da):side(b,duckB);
 return value('select public.save_online_battle_result($1,$2,$3,$4,$5::jsonb) data',[p1.battlerId,p1.duckId,p2.battlerId,p2.duckId,JSON.stringify({p1,p2,selectionMode:mode,result,events:[{type:'battleEnd',result:bad?'draw':result}]})]);};
 await asUser(user);for(let i=0;i<3;i++)await save();await save('manual');await save();await save();await save('random','draw');await save();await save('random','P2_win');
 await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261007111246_profile_message.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261007135040_duck_skill_quotes.sql',import.meta.url),'utf8'));
 const best=async(id=a)=>{await db.exec('reset role');return value('select best_random_win_streak data from public.game_account_records where game_account_id=$1',[id]);};
 const list=async()=>{await asUser(user);return decodeOnlineCharacters(await value('select public.list_online_characters() data'));};
 await t.test('backfill separates manual/draw/loss, defaults zero and includes registration/self/no public Duck',async()=>{
 assert.equal(await best(),3);assert.equal(await best(b),0);const rows=await list();assert.equal(rows.length,3);assert.deepEqual(rows[2],{eno:'3',battlerName:'new',battlerIconUrl:'',accent:'#4F91B3',duck:null,bestStreak:0});assert.equal(rows[0].bestStreak,3);
 });
 await t.test('win/loss/draw/manual/P2 and monotonic best; current contract and save_revision retained',async()=>{
 await db.exec('reset role');const revision=await value('select save_revision::text data from public.game_accounts where id=$1',[a]);
 await asUser(user);await save();assert.equal(await best(),3);await asUser(user);await save();assert.equal(await best(),3);await asUser(user);await save('random','P2_win');
 assert.equal(await value('select public.get_online_random_win_streak($1) data',[a]),0);assert.equal(await best(),3);
 await asUser(user);for(let i=0;i<4;i++)await save();assert.equal(await best(),4);
 for(const [mode,result] of [['random','draw'],['manual','P1_win']]){await asUser(user);await save(mode,result);assert.equal(await best(),4);}
 await asUser(other);await save('random','P2_win',true);assert.equal(await best(),4);assert.equal(await best(b),0);
 await db.exec('reset role');assert.equal(await value('select save_revision::text data from public.game_accounts where id=$1',[a]),revision);
 });
 await t.test('failed battle and downstream transaction rollback cannot leave updated best',async()=>{
 await asUser(user);await assert.rejects(save('random','P1_win',false,true),{code:'22023'});assert.equal(await best(),4);
 await asUser(user);await db.exec('begin');for(let i=0;i<5;i++)await save();await db.exec('rollback');assert.equal(await best(),4);
 });
 const {data}=await player(a,'1',da);data.presentation.battler.profile.showBestStreak=false;data.presentation.battler.profile.theme.accent='#123ABC';data.presentation.battler.profile.text='SECRET';
 data.presentation.ducks[da].profile.type='attack';data.presentation.ducks[da].profile.attributes=['炎','','🔥'];data.presentation.ducks[da].profile.text='SECRET';data.presentation.ducks.orphan={...structuredClone(data.presentation.ducks[da]),iconUrl:'SECRET'};
 const dto=encodeOnlinePlayer(data);
 await db.exec('reset role');await db.query("insert into public.ducks(id,game_account_id,presentation) values ('99999999-9999-4999-8999-999999999999',$1,'{\"name\":\"SECRET-private-duck\"}')",[a]);
 await db.exec('reset role');await db.query('update public.battlers set build=$2,presentation=$3 where game_account_id=$1',[a,JSON.stringify(dto.battler.build),JSON.stringify(dto.battler.presentation)]);
 await db.query('update public.ducks set build=$2,presentation=$3 where id=$1',[da,JSON.stringify(dto.ducks[0].build),JSON.stringify(dto.ducks[0].presentation)]);
 await db.query('update public.game_accounts set public_duck_id=$2 where id=$1',[a,da]);
 await t.test('v5 whitelist hides private data and best; only accent and public Duck fields',async()=>{
 const rows=await list(),v=rows[0];assert.equal(v.bestStreak,null);assert.equal(v.accent,'#123ABC');assert.deepEqual(v.duck,{name:data.build.ducks[0].name,iconUrl:data.presentation.ducks[da].iconUrl,type:'attack',attributes:['炎','','🔥']});
 assert.doesNotMatch(JSON.stringify(rows),/SECRET|cutin|skills|stats|flavorStats|detached|accountId|background|showBestStreak/);
 await db.exec('reset role');await db.query("update public.battlers set presentation=jsonb_set(presentation,'{profile,showBestStreak}','true') where game_account_id=$1",[a]);assert.equal((await list())[0].bestStreak,4);
 });
 await t.test('v4-v6 preserve the same explicit best streak privacy',async()=>{
 for(const version of [4,5,6])for(const visible of [true,false,null,'true']){
  await db.exec('reset role');
  await db.query("update public.battlers set presentation=jsonb_set(jsonb_set(presentation,'{schemaVersion}',$2::jsonb),'{profile,showBestStreak}',$3::jsonb) where game_account_id=$1",[a,String(version),JSON.stringify(visible)]);
  assert.equal((await list())[0].bestStreak,visible===true?4:null);
 }
 });
 await t.test('legacy versions default public and invalid accent falls back; stale ownership never substitutes private Duck',async()=>{
 for(const version of [1,2,3]){await db.exec('reset role');await db.query("update public.battlers set presentation=jsonb_set(presentation,'{schemaVersion}',$2::jsonb) where game_account_id=$1",[a,String(version)]);assert.equal((await list())[0].bestStreak,4);}
 await db.exec('reset role');await db.query("update public.battlers set presentation=jsonb_set(presentation,'{profile,theme,accent}','\"invalid\"') where game_account_id=$1",[a]);assert.equal((await list())[0].accent,'#4F91B3');
 // The FK normally prevents stale references; moving ownership via a privileged fixture tests the join's defense.
 await db.exec('reset role');await db.query('update public.game_accounts set public_duck_id=null where id=$1',[a]);assert.equal((await list())[0].duck,null);
 });
 await t.test('a mismatched public Duck ID never returns another account or private Duck',async()=>{
 await db.exec('reset role;begin;alter table public.game_accounts alter constraint game_accounts_public_duck_owner_fk deferrable initially deferred');
 await db.query('update public.game_accounts set public_duck_id=$2 where id=$1',[a,duckB]);
 assert.equal((await list())[0].duck,null);await db.exec('reset role;rollback');
 });
 await t.test('first random win records one on an independent account',async()=>{
 await asUser(other);await save('random','P1_win',true);assert.equal(await best(b),1);
 });
 await t.test('anon/no identity/direct table reads and writes denied',async()=>{
 await asUser(user);for(const sql of ['select * from public.game_account_records',`update public.game_account_records set best_random_win_streak=999`,`insert into public.game_account_records(game_account_id) values ('${third}')`])await assert.rejects(db.exec(sql),{code:'42501'});
 await db.exec('reset role;set role anon');await assert.rejects(value('select public.list_online_characters() data'),{code:'42501'});
 await asUser('');await assert.rejects(value('select public.list_online_characters() data'),{code:'42501'});
 await db.exec('reset role');assert.equal(await value("select relrowsecurity data from pg_class where oid='public.game_account_records'::regclass"),true);
 });
 await t.test('record is independent of Duck deletion and cascades with account',async()=>{
 await db.exec('reset role');await db.query('delete from public.ducks where id=$1',[da]);assert.equal(await best(),4);
 await db.query('delete from public.game_accounts where id=$1',[third]);assert.equal(await value('select count(*)::integer data from public.game_account_records where game_account_id=$1',[third]),0);
 });
 }finally{await db.close();}
});
