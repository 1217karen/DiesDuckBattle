import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { a,b,da,db as duckB,privateDuck,player } from './onlineSelectFixture.mjs';
import { decodePublicOpponent } from '../js/onlineSelectService.js';
import { decodeOnlinePlayer } from '../js/onlinePlayerDto.js';
import { encodeOnlinePlayer } from '../js/onlinePlayerDto.js';
let PGlite;
if(process.env.PGLITE_MODULE)({PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE)));
const userA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',userB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('public battle SQL/RLS against local Postgres only',{skip:!PGlite&&'Set PGLITE_MODULE'},async t=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      grant execute on function auth.uid() to authenticated,anon,service_role;`);
    for(const file of ['20260929132128_initial_online_schema.sql','20260930165424_online_player_storage.sql'])
      await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    await db.exec(`insert into auth.users values ('${userA}'),('${userB}');
      insert into public.game_accounts(id) values ('${a}'),('${b}');
      insert into public.game_account_access(auth_user_id,game_account_id) values ('${userA}','${a}'),('${userB}','${b}');
      insert into public.battlers(game_account_id,presentation) values ('${a}','{"name":"A"}'),('${b}','{"name":"B"}');`);
    const asUser=async user=>db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
    const value=async(sql,args=[])=> (await db.query(sql,args)).rows[0].data;
    for(const [id,eno,duck,user] of [[a,'1',da,userA],[b,'2',duckB,userB]]) {
      const {data}=await player(id,eno,duck);const snapshot=encodeOnlinePlayer(data);snapshot.battler.presentation.detachedDuckPresentation={hidden:{iconUrl:'PRIVATE-DETACHED'}};
      await asUser(user);const initial=await value('select public.load_online_player($1) data',[id]);
      await db.query('select public.save_online_player($1,$2,$3::jsonb)',[id,initial.revision,JSON.stringify(snapshot)]);
    }
    await db.exec(`reset role; insert into public.ducks(id,game_account_id,build,presentation)
      values ('${privateDuck}','${b}','{"private":"PRIVATE-BUILD"}','{"private":"PRIVATE-ICON"}');
      update public.battlers set presentation=presentation || '{"futurePrivate":"PRIVATE-FUTURE"}' where game_account_id='${b}';`);
    await asUser(userA);
    await t.test('baseline reproduces whole-Battler exposure while private Duck row is blocked',async()=>{
      assert.equal((await db.query('select * from public.ducks where id=$1',[privateDuck])).rows.length,0);
      const raw=await db.query('select presentation from public.battlers where game_account_id=$1',[b]);
      assert.match(JSON.stringify(raw.rows),/PRIVATE-DETACHED/);
    });
    await db.exec('reset role;');
    await db.exec(await readFile(new URL('../supabase/migrations/20261001114619_online_battle_public_boundary.sql',import.meta.url),'utf8'));
    await asUser(userA);
    await t.test('direct tables, guessed UUIDs and full draft RPC cannot retrieve foreign data',async()=>{
      assert.equal((await db.query('select * from public.battlers where game_account_id=$1',[b])).rows.length,0);
      assert.equal((await db.query('select * from public.ducks where game_account_id=$1',[b])).rows.length,0);
      assert.equal(await value('select public.load_online_player($1) data',[b]),null);
      assert.equal((await db.query('update public.ducks set build=\'{}\' where id=$1 returning id',[privateDuck])).rows.length,0);
    });
    await t.test('owner load/edit and own DB name remain available after tightening RLS',async()=>{
      const own=await value('select public.load_online_player($1) data',[a]);assert.equal(decodeOnlinePlayer(own).build.ducks[0].id,da);
      assert.equal((await db.query('select presentation from public.battlers where game_account_id=$1',[a])).rows.length,1);
      await db.query('update public.ducks set sort_order=4 where id=$1',[da]);
      assert.notEqual((await value('select public.load_online_player($1) data',[a])).revision,own.revision);
    });
    await t.test('public projection allows only published Duck and fixed battle fields',async()=>{
      const list=await value('select public.list_online_opponents() data');assert.deepEqual(list.map(r=>r.id),[b]);
      const row=await value('select public.get_online_opponent($1) data',[b]);
      assert.doesNotMatch(JSON.stringify(row),/PRIVATE/);assert.deepEqual(row.ducks.map(d=>d.id),[duckB]);
      assert.equal(decodePublicOpponent(row,a).publicDuckId,duckB);
      assert.equal(await value('select public.get_online_opponent($1) data',[a]),null);
      assert.equal(await value('select public.get_online_opponent($1) data',[privateDuck]),null);
    });
    const prepare=()=>value('select public.prepare_online_battle($1,$2,$3,$4) data',[a,da,b,duckB]);
    await t.test('VS pairs latest own and public data; forged own account/duck is denied',async()=>{
      await db.exec(`reset role; update public.battlers set presentation=jsonb_set(presentation,'{name}','"latest"') where game_account_id='${b}';`);await asUser(userA);
      assert.equal((await prepare()).opponent.battler.presentation.name,'latest');
      assert.equal(await value('select public.prepare_online_battle($1,$2,$3,$4) data',[b,privateDuck,b,duckB]),null);
      assert.equal(await value('select public.prepare_online_battle($1,$2,$3,$4) data',[a,privateDuck,b,duckB]),null);
    });
    await t.test('unpublish removes list/detail and rejects previous VS selection',async()=>{
      await db.exec(`reset role; update public.game_accounts set public_duck_id=null where id='${b}';`);await asUser(userA);
      assert.deepEqual(await value('select public.list_online_opponents() data'),[]);
      assert.equal(await value('select public.get_online_opponent($1) data',[b]),null);assert.equal(await prepare(),null);
      await db.exec(`reset role; update public.game_accounts set public_duck_id='${privateDuck}' where id='${b}';`);await asUser(userA);assert.equal(await prepare(),null);
    });
    await t.test('zero/multiple access and null identity disclose no projection',async()=>{
      await asUser('cccccccc-cccc-4ccc-8ccc-cccccccccccc');assert.deepEqual(await value('select public.list_online_opponents() data'),[]);
      await db.exec(`reset role; insert into public.game_account_access(auth_user_id,game_account_id) values ('${userA}','${b}');`);await asUser(userA);
      assert.deepEqual(await value('select public.list_online_opponents() data'),[]);assert.equal(await prepare(),null);
      await asUser('');assert.deepEqual(await value('select public.list_online_opponents() data'),[]);
    });
    await t.test('anon has no function, table or private schema access',async()=>{
      await db.exec('reset role; set role anon;');
      await assert.rejects(value('select public.list_online_opponents() data'),{code:'42501'});
      await assert.rejects(db.query('select * from public.ducks'),{code:'42501'});
      await assert.rejects(db.query('select * from diesduck_private.public_battle_data(null)'),{code:'42501'});
    });
  }finally{await db.close();}
});
