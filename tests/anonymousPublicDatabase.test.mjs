import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
let PGlite;if(process.env.PGLITE_MODULE)({PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE)));
const migration='20261011155515_public_page_anonymous_reads.sql';
const reads=[
 'public.list_online_characters()', 'diesduck_private.list_characters()',
 'public.get_online_profile(bigint)', 'diesduck_private.public_profile(bigint)',
 'public.list_online_battle_results(integer,integer,text,bigint,text,boolean,uuid)',
 'diesduck_private.list_battle_results(integer,integer,text,bigint,text,boolean,uuid)',
 'public.get_online_battle_result(uuid)', 'diesduck_private.get_battle_result(uuid)',
];
test('anonymous migration changes only eight read EXECUTE grants, preserving table and write boundaries',
 {skip:!PGlite&&'Set PGLITE_MODULE'},async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
  const files=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
  const functionAccess=async()=> (await db.query(`select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,
   has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','diesduck_private') order by 1`)).rows;
  const tableAccess=async()=> (await db.query(`select n.nspname,c.relname,c.relacl::text,c.relrowsecurity from pg_class c
   join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','diesduck_private') order by 1,2`)).rows;
  for(const f of files.filter(f=>f<migration))await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
  const before=await functionAccess(),tables=await tableAccess();
  await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
  const after=await functionAccess();assert.equal(after.length,before.length);assert.deepEqual(await tableAccess(),tables);
  assert.deepEqual(after.map(f=>[f.signature,f.authenticated]),before.map(f=>[f.signature,f.authenticated]));
  const changed=after.filter((f,i)=>f.anon!==before[i].anon);
  assert.deepEqual(changed.map(f=>f.signature.replaceAll(', ',',' )).sort(),reads.toSorted());
  assert.ok(changed.every(f=>f.anon));
  // Call protected RPCs rather than relying solely on ACL metadata. NULL arguments
  // are deliberately irrelevant: the anonymous caller must fail at EXECUTE.
  await db.exec("set role anon;select set_config('request.jwt.claim.sub','',false)");
  for(const sql of [
   'select public.load_online_player(null)',
   'select public.save_online_player(null,null,null)',
   'select public.prepare_online_battle(null,null,null,null)',
   'select public.list_online_opponents()',
   'select public.get_online_opponent(null)',
   'select public.save_online_battle_result(null,null,null,null,null)',
   'select public.set_online_battle_favorite(null,null,true)',
  ])await assert.rejects(db.exec(sql),{code:'42501'},sql);
  for(const table of ['game_accounts','game_account_access','battlers','ducks','battles','battle_favorites','game_account_records'])
   await assert.rejects(db.exec('select * from public.'+table),{code:'42501'},table);
  await assert.rejects(db.exec('select * from auth.users'),{code:'42501'});
  assert.deepEqual((await db.query('select public.list_online_characters() data')).rows[0].data,[]);
  assert.equal((await db.query('select public.get_online_profile(1) data')).rows[0].data,null);
  assert.equal((await db.query('select public.list_online_battle_results() data')).rows[0].data.total,0);
  assert.equal((await db.query('select public.get_online_battle_result(null) data')).rows[0].data,null);
 }finally{await db.close();}
});
