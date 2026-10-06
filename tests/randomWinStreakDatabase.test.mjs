import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { a,b,da,db as duckB } from './onlineSelectFixture.mjs';
let PGlite;
if(process.env.PGLITE_MODULE)({PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE)));
const userA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',userB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const migration='20261004162107_random_battle_win_streak.sql';

test('random mode persistence and own-P1 current streak SQL boundary',{skip:!PGlite&&'Set PGLITE_MODULE'},async t=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      grant execute on function auth.uid() to authenticated,anon,service_role;`);
    for(const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')&&f!==migration&&f<'20261006120000').sort())
      await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    await db.exec(`insert into auth.users values ('${userA}'),('${userB}');
      insert into public.game_accounts(id) values ('${a}'),('${b}');
      insert into public.game_account_access(auth_user_id,game_account_id) values ('${userA}','${a}'),('${userB}','${b}');
      insert into public.ducks(id,game_account_id) values ('${da}','${a}'),('${duckB}','${b}');`);
    const asUser=user=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);`);
    const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0].data;
    const streak=id=>value('select public.get_online_random_win_streak($1) data',[id]);
    const side=(id,duck)=>({battlerId:id,duckId:duck,battlerName:'本来の名前',duckName:'本来のDuck',presentation:{battlerDefaultIconUrl:'real.png',duckIconUrl:'real-duck.png',quotes:{battleStart:{text:'本来のセリフ'}}}});
    const save=async(mode,result='P1_win',reversed=false)=>{
      const p1=reversed?side(b,duckB):side(a,da),p2=reversed?side(a,da):side(b,duckB);
      const record={p1,p2,result,events:[{type:'battleEnd',result}],unknown:'not-whitelisted'};
      if(mode!==undefined)record.selectionMode=mode;
      return value('select public.save_online_battle_result($1,$2,$3,$4,$5::jsonb) data',
        [p1.battlerId,p1.duckId,p2.battlerId,p2.duckId,JSON.stringify(record)]);
    };
    await asUser(userA);const legacy=await save();
    await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261006120000_character_list_and_best_streak.sql',import.meta.url),'utf8'));
    await asUser(userA);
    await t.test('no own P1 history is zero; legacy row/record default to manual',async()=>{
      assert.equal(await streak(a),0);await asUser(userB);assert.equal(await streak(b),0);await asUser(userA);
      const record=await value('select public.get_online_battle_result($1) data',[legacy.battleId]);
      assert.equal(record.selectionMode,'manual');assert.equal(record.p1.battlerName,'本来の名前');
      await db.exec('reset role');assert.equal(await value('select selection_mode data from public.battles where id=$1',[legacy.battleId]),'manual');await asUser(userA);
    });
    await t.test('random wins extend; P2 participation never affects own streak',async()=>{
      for(const expected of [1,2]) {
        const meta=await save('random');assert.equal(await streak(a),expected);
        const record=await value('select public.get_online_battle_result($1) data',[meta.battleId]);
        assert.equal(record.selectionMode,'random');assert.equal(record.unknown,undefined);
        assert.equal(record.p2.presentation.duckIconUrl,'real-duck.png');
        await db.exec('reset role');assert.equal(await value('select selection_mode data from public.battles where id=$1',[meta.battleId]),'random');await asUser(userA);
      }
      await asUser(userB);for(const [mode,result] of [['random','P1_win'],['manual','draw'],['random','P2_win']])await save(mode,result,true);
      await asUser(userA);assert.equal(await streak(a),2);
    });
    await t.test('manual save, random loss and draw each break; subsequent random wins start anew',async()=>{
      const manual=await save('manual');assert.equal(await streak(a),0);
      assert.equal((await value('select public.get_online_battle_result($1) data',[manual.battleId])).selectionMode,'manual');
      await save('random');assert.equal(await streak(a),1);
      await save('random','P2_win');assert.equal(await streak(a),0);
      await save('random');assert.equal(await streak(a),1);
      await save('random','draw');assert.equal(await streak(a),0);
      await save('random');await save('random');assert.equal(await streak(a),2);
      await save();assert.equal(await streak(a),0);
    });
    await t.test('invalid explicit modes rejected and old clients use manual without overload',async()=>{
      for(const mode of [null,'bad',0,{},[],true]) await assert.rejects(save(mode),{code:'22023'});
      await db.exec('reset role');
      assert.equal(await value("select count(*)::integer data from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='save_online_battle_result'"),1);
      await assert.rejects(db.exec("update public.battles set selection_mode='bad'"),{code:'23514'});
      await asUser(userA);
    });
    await t.test('ownership, anon, null identity and direct table boundaries remain enforced',async()=>{
      await assert.rejects(streak(b),{code:'42501'});await assert.rejects(streak(null),{code:'42501'});
      await assert.rejects(db.query('select * from public.battles'),{code:'42501'});
      await assert.rejects(value('select diesduck_private.random_win_streak($1) data',[b]),{code:'42501'});
      await db.exec('reset role;set role anon;');await assert.rejects(streak(a),{code:'42501'});
      await asUser('');await assert.rejects(streak(a),{code:'42501'});
      await asUser(userA);assert.equal(await streak(a),0);
    });
  } finally {await db.close();}
});
