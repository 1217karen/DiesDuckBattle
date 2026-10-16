import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createEmptyPlayerBuild} from '../js/playerBuildModel.js';
import {createEmptyPlayerPresentation} from '../js/playerPresentationModel.js';
import {encodeOnlinePlayer,decodeOnlinePlayer} from '../js/onlinePlayerDto.js';
import {decodeOnlineProfile} from '../js/onlineProfileService.js';
import {decodeOnlineCharacters} from '../js/onlineCharacterListService.js';
import {filterCharacters} from '../js/characterListModel.js';
let PGlite;if(process.env.PGLITE_MODULE)({PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE)));
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('PL migration preserves existing rows and ACLs; real save/load/public DTOs and filters',{skip:!PGlite&&'Set PGLITE_MODULE'},async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to authenticated,anon,service_role;
   grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const directory=new URL('../supabase/migrations/',import.meta.url),files=(await readdir(directory)).filter(f=>f.endsWith('.sql')).sort();
  for(const f of files.filter(f=>!f.endsWith('_player_name.sql')))await db.exec(await readFile(new URL(f,directory),'utf8'));
  for(let n=1;n<=3;n++)await db.exec(`insert into auth.users values ('${uuid(n)}');insert into public.game_accounts(id) values ('${uuid(100+n)}');
   insert into public.game_account_access(auth_user_id,game_account_id) values ('${uuid(n)}','${uuid(100+n)}');
   insert into public.battlers(game_account_id,presentation) values ('${uuid(100+n)}','{"name":"キャラ${n}"}');`);
  const rows=()=>db.query('select * from public.battlers order by game_account_id');
  const acl=()=>db.query("select oid::regprocedure::text as name,proacl from pg_proc where pronamespace in ('public'::regnamespace,'diesduck_private'::regnamespace) order by name");
  const before=await rows(),permissions=await acl();
  await db.exec(await readFile(new URL(files.find(f=>f.endsWith('_player_name.sql')),directory),'utf8'));
  assert.deepEqual(await rows(),before);assert.deepEqual(await acl(),permissions);
  const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0].data;
  const user=n=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${uuid(n)}',false)`);
  const load=n=>value('select public.load_online_player($1) data',[uuid(100+n)]);
  const save=async(n,data,revision)=>value('select public.save_online_player($1,$2,$3) data',[uuid(100+n),revision??(await load(n)).revision,encodeOnlinePlayer(data)]);
  const list=async()=>{await db.exec("reset role;set role anon;select set_config('request.jwt.claim.sub','',false)");return decodeOnlineCharacters(await value('select public.list_online_characters() data'));};
  assert.ok((await list()).every(c=>c.plName===''));
  for(let n=1;n<=2;n++){
   await user(n);const d=decodeOnlinePlayer(await load(n));d.presentation.battler.plName='同じPL';await save(n,d);
   assert.equal(decodeOnlinePlayer(await load(n)).presentation.battler.plName,'同じPL');
  }
  assert.deepEqual(filterCharacters(await list(),{plName:'じpl'}).map(c=>c.eno),['1','2']);
  assert.equal(filterCharacters(await list(),{plName:'匿名'}).length,0);
  let p=decodeOnlineProfile(await value('select public.get_online_profile(1) data'));assert.equal(p.plName,'同じPL');assert.equal(p.isOwner,false);
  await user(1);let old=await load(1),d=decodeOnlinePlayer(old);d.presentation.battler.plName='変更したPL';await save(1,d);
  const changed=await load(1);assert.equal(decodeOnlinePlayer(changed).presentation.battler.plName,'変更したPL');
  d.presentation.battler.plName='失敗する変更';await assert.rejects(save(1,d,old.revision),{code:'40001'});assert.deepEqual(await load(1),changed);
  await user(2);await assert.rejects(save(1,d,changed.revision),{code:'42501'});
  await user(1);d.presentation.battler.plName='';await save(1,d);assert.equal(decodeOnlinePlayer(await load(1)).presentation.battler.plName,'');
  assert.deepEqual(filterCharacters(await list(),{plName:'同じ'}).map(c=>c.eno),['2']);
  // Persisted pre-extension Presentation remains readable without rewriting or exposing unrelated fields.
  await db.exec('reset role');await db.query("update public.battlers set presentation=presentation-'plName' where game_account_id=$1",[uuid(101)]);
  await user(1);assert.equal(decodeOnlinePlayer(await load(1)).presentation.battler.plName,'');
  await list();assert.equal(decodeOnlineProfile(await value('select public.get_online_profile(1) data')).plName,'');
  for(const invalid of [null,42,'x'.repeat(31),'a\nb']){
   await db.exec('reset role');await db.query("update public.battlers set presentation=jsonb_set(presentation,'{plName}',$1::jsonb) where game_account_id=$2",[JSON.stringify(invalid),uuid(101)]);
   assert.equal((await list())[0].plName,'');assert.equal(decodeOnlineProfile(await value('select public.get_online_profile(1) data')).plName,'');
  }
 }finally{await db.close();}
});
