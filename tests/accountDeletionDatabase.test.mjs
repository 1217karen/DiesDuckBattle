import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { player } from './onlineSelectFixture.mjs';
let PGlite;if(process.env.PGLITE_MODULE)({PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE)));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('account deletion transaction: auth, public data, vault and immutable battle history',{skip:!PGlite&&'Set PGLITE_MODULE'},async t=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade);
      create table auth.identities(user_id uuid references auth.users(id) on delete cascade);
      create table auth.refresh_tokens(session_id uuid references auth.sessions(id) on delete cascade);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
    for(const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())
      await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    for(let n=1;n<=3;n++){
      await db.query('insert into auth.users values ($1)',[id(n)]);
      await db.query('insert into auth.sessions values ($1,$2)',[id(n+100),id(n)]);
      await db.query('insert into auth.identities values ($1)',[id(n)]);
      await db.query('insert into auth.refresh_tokens values ($1)',[id(n+100)]);
      await db.query('insert into public.game_accounts(id) values ($1)',[id(n)]);
      await db.query('insert into public.game_account_access(auth_user_id,game_account_id) values ($1,$1)',[id(n)]);
      const snapshot=(await player(id(n),String(n),id(n+200))).snapshot;
      await db.query('insert into public.battlers(game_account_id,build,presentation) values ($1,$2,$3)',[id(n),snapshot.battler.build,snapshot.battler.presentation]);
      await db.query('insert into public.ducks(id,game_account_id,build,presentation) values ($1,$2,$3,$4)',[id(n+200),id(n),snapshot.ducks[0].build,snapshot.ducks[0].presentation]);
      await db.query('update public.game_accounts set public_duck_id=$1 where id=$2',[id(n+200),id(n)]);
      await db.query('insert into public.game_account_messages(game_account_id,message) values ($1,$2)',[id(n),'message'+n]);
      await db.query('insert into public.game_account_records(game_account_id,best_random_win_streak) values ($1,3)',[id(n)]);
    }
    const as=async(n=1,role='authenticated',session=n+100)=>{
      await db.exec(`reset role;set role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
        [n?id(n):'',JSON.stringify({session_id:session?id(session):null})]);
    };
    const rpc=async(name,args=[])=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) data`,args)).rows[0].data;
    const prepare=(eno='1')=>rpc('prepare_account_deletion',[eno]);
    const remove=(target)=>rpc('delete_own_account',[target.gameAccountId,target.authUserId,target.eno,target.name]);
    await as();let target=await prepare();assert.deepEqual(target,{gameAccountId:id(1),authUserId:id(1),eno:'1',name:'DB名1'});
    await rpc('store_skill_vault',[id(1),id(300),'D',{optionId:'add-self-1'},'保管','るび']);
    await rpc('store_skill_vault',[id(2),id(301),'D',{optionId:'add-self-2'},'other','']).then(()=>assert.fail('must reject'),error=>assert.equal(error.code,'42501'));
    await as(2);await rpc('store_skill_vault',[id(2),id(301),'D',{optionId:'add-self-2'},'other','']);
    await db.exec('reset role');
    const presentation={battlerDefaultIconUrl:'https://example.invalid/old.png',duckIconUrl:'https://example.invalid/duck.png',cutinUrl:'https://example.invalid/cutin.png'};
    const record={battleId:id(400),battleNo:1,p1:{eno:'1',battlerName:'昔の名前1',duckName:'昔のアヒル1',presentation},
      p2:{eno:'2',battlerName:'昔の名前2',duckName:'昔のアヒル2',presentation},result:'draw',events:[{type:'battleEnd',result:'draw'}]};
    await db.query(`insert into public.battles(id,p1_account_id,p1_eno,p1_duck_id,p2_account_id,p2_eno,p2_duck_id,result,record) values ($1,$2,1,$3,$4,2,$5,'draw',$6)`,[id(400),id(1),id(201),id(2),id(202),record]);
    await db.query('insert into public.battle_favorites(game_account_id,battle_id) values ($1,$3),($2,$3)',[id(1),id(2),id(400)]);
    const beforeBattle=(await db.query('select * from public.battles')).rows;
    const beforeOther=(await db.query('select * from public.game_accounts where id=$1',[id(2)])).rows;
    await t.test('anonymous, stale sessions, wrong identity and unconfirmed name rejected',async()=>{
      await as(0,'anon');await assert.rejects(prepare(),{code:'42501'});await assert.rejects(remove(target),{code:'42501'});
      await as(0);await assert.rejects(prepare(),{code:'42501'});
      await as(1,'authenticated',999);await assert.rejects(prepare(),{code:'42501'});
      await as(1,'authenticated',102);await assert.rejects(prepare(),{code:'42501'});
      await as(2);await assert.rejects(remove(target),{code:'42501'});
      await as();await assert.rejects(prepare('2'),{code:'42501'});
      for(const bad of [{...target,gameAccountId:id(2)},{...target,eno:'2'},{...target,name:'old'},{...target,authUserId:id(2)}])await assert.rejects(remove(bad));
      await assert.rejects(db.exec('delete from auth.users'),{code:'42501'});
      await assert.rejects(db.exec('delete from public.game_accounts'),{code:'42501'});
    });
    await t.test('new multi-ENo or shared grant after prepare invalidates confirmation; no collateral deletion',async()=>{
      for(const pair of [[id(1),id(2)],[id(2),id(1)]]){
        await db.exec('reset role');await db.query('insert into public.game_account_access(auth_user_id,game_account_id) values ($1,$2)',pair);
        await as();await assert.rejects(prepare(),{code:'42501'});await assert.rejects(remove(target),{code:'42501'});
        await db.exec('reset role');assert.equal((await db.query('select count(*)::integer n from auth.users')).rows[0].n,3);
        await db.query('delete from public.game_account_access where auth_user_id=$1 and game_account_id=$2',pair);
      }
    });
    await t.test('late Auth deletion failure rolls back the ENTIRE game deletion',async()=>{
      await db.exec(`create function auth.block_delete() returns trigger language plpgsql as $$begin raise exception 'isolated failure'; end$$;
        create trigger test_block before delete on auth.users for each row execute function auth.block_delete();`);
      await as();await assert.rejects(remove(target));
      assert.deepEqual(await prepare(),target);assert.equal((await rpc('list_skill_vault',[id(1)])).length,1);
      await db.exec('reset role');assert.equal((await db.query('select public_duck_id from public.game_accounts where id=$1',[id(1)])).rows[0].public_duck_id,id(201));
      assert.equal((await db.query('select count(*)::integer n from public.ducks')).rows[0].n,3);
      assert.deepEqual((await db.query('select * from public.battles')).rows,beforeBattle);
      await db.exec('drop trigger test_block on auth.users;drop function auth.block_delete()');
    });
    await t.test('exclusive confirmed deletion removes all current private data and Auth login material',async()=>{
      await as();assert.equal((await rpc('get_online_profile',['1'])).eno,'1');
      const result=await remove(target);assert.deepEqual(result,{deleted:true,gameAccountId:id(1),authUserId:id(1),eno:'1'});
      await assert.rejects(remove(target),{code:'42501'});await assert.rejects(prepare(),{code:'42501'});
      await db.exec('reset role');
      for(const table of ['game_accounts','battlers','ducks','game_account_access','game_account_messages','game_account_records','battle_favorites']){
        const column=table==='game_accounts'?'id':'game_account_id';assert.equal((await db.query(`select count(*)::integer n from public.${table} where ${column}=$1`,[id(1)])).rows[0].n,0,table);
      }
      for(const table of ['skill_vault','skill_vault_counters'])assert.equal((await db.query(`select count(*)::integer n from diesduck_private.${table} where game_account_id=$1`,[id(1)])).rows[0].n,0);
      assert.equal((await db.query('select count(*)::integer n from auth.users where id=$1',[id(1)])).rows[0].n,0);
      for(const table of ['sessions','identities'])assert.equal((await db.query(`select count(*)::integer n from auth.${table} where user_id=$1`,[id(1)])).rows[0].n,0);
      assert.equal((await db.query('select count(*)::integer n from auth.refresh_tokens where session_id=$1',[id(101)])).rows[0].n,0);
      assert.deepEqual((await db.query('select * from public.game_accounts where id=$1',[id(2)])).rows,beforeOther);
      const next=(await db.query('insert into public.game_accounts default values returning eno')).rows[0].eno;assert.ok(Number(next)>3);
    });
    await t.test('public profile/list/messages/opponents lose deleted account; anonymous history and both ENo filters survive byte-for-byte',async()=>{
      await as(2);assert.equal(await rpc('get_online_profile',['1']),null);
      assert.ok(!(await rpc('list_online_characters')).some(r=>r.eno==='1'));
      assert.ok(!(await rpc('list_online_opponents')).some(r=>r.eno==='1'));
      assert.ok(!JSON.stringify(await rpc('get_index_messages',['2'])).includes('message1'));
      assert.equal((await rpc('list_skill_vault',[id(2)])).length,1);
      await as(0,'anon');assert.deepEqual(await rpc('get_online_battle_result',[id(400)]),record);
      for(const [eno,opponent] of [['1',null],[null,'1'],['1','2'],['2','1']]){
        const list=await rpc('list_online_battle_results',[1,30,'desc',eno,'all',false,null,opponent]);
        assert.equal(list.total,1);assert.equal(list.records[0].p1.battlerName,'昔の名前1');assert.equal(list.records[0].p1.presentation.duckIconUrl,presentation.duckIconUrl);
      }
      await db.exec('reset role');assert.deepEqual((await db.query('select * from public.battles')).rows,beforeBattle);
    });
  } finally {await db.close();}
});
