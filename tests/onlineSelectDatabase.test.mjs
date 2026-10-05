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
      const {data}=await player(id,eno,duck);
      data.presentation.battler.profile.text='PRIVATE-BATTLER-PROFILE';
      data.presentation.battler.profile.iconSlots=[1,3];
      data.presentation.battler.profile.featuredBattleId=da;
      data.presentation.ducks[duck].profile.text='PRIVATE-DUCK-PROFILE';
      data.presentation.ducks[duck].profile.type='attack';
      data.presentation.ducks[duck].profile.attributes=['火','',''];
      data.presentation.ducks[duck].profile.flavorStats=[{label:'PRIVATE-FLAVOR',value:6}];
      const snapshot=encodeOnlinePlayer(data);
      snapshot.battler.presentation.detachedDuckPresentation={hidden:{iconUrl:'PRIVATE-DETACHED',cutinUrl:'PRIVATE-DETACHED-CUTIN',profile:structuredClone(data.presentation.ducks[duck].profile)}};
      await asUser(user);const initial=await value('select public.load_online_player($1) data',[id]);
      await db.query('select public.save_online_player($1,$2,$3::jsonb)',[id,initial.revision,JSON.stringify(snapshot)]);
    }
    await db.exec(`reset role; insert into public.ducks(id,game_account_id,build,presentation)
      values ('${privateDuck}','${b}','{"private":"PRIVATE-BUILD"}','{"private":"PRIVATE-ICON","icon":{"iconUrl":"private.png","cutinUrl":"PRIVATE-CUTIN"}}');
      update public.battlers set presentation=presentation || '{"futurePrivate":"PRIVATE-FUTURE"}' where game_account_id='${b}';`);
    await asUser(userA);
    await t.test('baseline reproduces whole-Battler exposure while private Duck row is blocked',async()=>{
      assert.equal((await db.query('select * from public.ducks where id=$1',[privateDuck])).rows.length,0);
      const raw=await db.query('select presentation from public.battlers where game_account_id=$1',[b]);
      assert.match(JSON.stringify(raw.rows),/PRIVATE-DETACHED/);
    });
    await db.exec('reset role;');
    await db.exec(await readFile(new URL('../supabase/migrations/20261001114619_online_battle_public_boundary.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261004082650_skill_label_snapshot.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261004101854_c_skill_cutin.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261004152422_opponent_list_default_icon.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261005110530_presentation_v2_battle_projection.sql',import.meta.url),'utf8'));
    await asUser(userA);
    await t.test('direct tables, guessed UUIDs and full draft RPC cannot retrieve foreign data',async()=>{
      assert.equal((await db.query('select * from public.battlers where game_account_id=$1',[b])).rows.length,0);
      assert.equal((await db.query('select * from public.ducks where game_account_id=$1',[b])).rows.length,0);
      assert.equal(await value('select public.load_online_player($1) data',[b]),null);
      assert.equal((await db.query('update public.ducks set build=\'{}\' where id=$1 returning id',[privateDuck])).rows.length,0);
    });
    await t.test('owner load/edit and own DB name remain available after tightening RLS',async()=>{
      const own=await value('select public.load_online_player($1) data',[a]);assert.equal(decodeOnlinePlayer(own).build.ducks[0].id,da);
      assert.equal(decodeOnlinePlayer(own).presentation.battler.profile.text,'PRIVATE-BATTLER-PROFILE');
      assert.equal(decodeOnlinePlayer(own).presentation.ducks.hidden.profile.text,'PRIVATE-DUCK-PROFILE');
      assert.equal((await db.query('select presentation from public.battlers where game_account_id=$1',[a])).rows.length,1);
      await db.query('update public.ducks set sort_order=4 where id=$1',[da]);
      assert.notEqual((await value('select public.load_online_player($1) data',[a])).revision,own.revision);
    });
    await t.test('public projection allows only published Duck and fixed battle fields',async()=>{
      const list=await value('select public.list_online_opponents() data');assert.deepEqual(list.map(r=>r.id),[b]);
      assert.deepEqual(Object.keys(list[0]).sort(),['defaultIconUrl','eno','id','name','publicDuckId']);
      assert.equal(list[0].defaultIconUrl,'https://example.invalid/2.png');
      assert.doesNotMatch(JSON.stringify(list),/PRIVATE|quotes|iconSlots|cutinUrl|duck2/);
      const row=await value('select public.get_online_opponent($1) data',[b]);
      assert.doesNotMatch(JSON.stringify(row),/PRIVATE/);assert.deepEqual(row.ducks.map(d=>d.id),[duckB]);
      assert.equal(row.battler.presentation.schemaVersion,1);assert.equal(row.ducks[0].presentation.schemaVersion,1);
      assert.equal('profile' in row.battler.presentation,false);assert.equal('profile' in row.ducks[0].presentation.icon,false);
      assert.equal(decodePublicOpponent(row,a).presentation.schemaVersion,2);
      assert.equal(decodePublicOpponent(row,a).publicDuckId,duckB);
      assert.equal(row.ducks[0].presentation.icon.cutinUrl,'https://example.invalid/cutin2.png');
      assert.equal(decodePublicOpponent(row,a).presentation.ducks[duckB].cutinUrl,row.ducks[0].presentation.icon.cutinUrl);
      assert.equal(await value('select public.get_online_opponent($1) data',[a]),null);
      assert.equal(await value('select public.get_online_opponent($1) data',[privateDuck]),null);
    });
    await t.test('public cut-in whitelist omits unknown/private fields and fills old missing cut-ins',async()=>{
      await db.exec('reset role;');
      await db.query("update public.ducks set presentation=jsonb_set(presentation,'{icon}',(presentation->'icon') || '{\"private\":\"PRIVATE-DUCK-DISPLAY\"}'::jsonb) where id=$1",[duckB]);
      await asUser(userA);
      let row=await value('select public.get_online_opponent($1) data',[b]);
      assert.deepEqual(Object.keys(row.ducks[0].presentation.icon).sort(),['cutinUrl','iconUrl']);
      assert.doesNotMatch(JSON.stringify(row),/PRIVATE/);
      await db.exec('reset role;');
      await db.query("update public.ducks set presentation=jsonb_set(presentation,'{icon}',(presentation->'icon')-'cutinUrl'-'private') where id=$1",[duckB]);
      await asUser(userA);row=await value('select public.get_online_opponent($1) data',[b]);
      assert.equal(row.ducks[0].presentation.icon.cutinUrl,'');
      assert.equal(decodePublicOpponent(row,a).presentation.ducks[duckB].cutinUrl,'');
      await db.exec('reset role;');
      await db.query("update public.ducks set presentation=jsonb_set(presentation,'{icon,cutinUrl}','\"https://example.invalid/cutin2.png\"') where id=$1",[duckB]);
      await asUser(userA);
    });
    await t.test('v3 public skill labels preserve spaces and whitelist only name/ruby; v2 still decodes',async()=>{
      const ruby='   サン   ダー      ';
      const labels=keys=>Object.fromEntries(keys.map(k=>[k,{name:k+'雷',ruby,private:'PRIVATE-LABEL'}]));
      await db.exec('reset role;');
      await db.query("update public.battlers set build=jsonb_set(build,'{skillLabels}',$1::jsonb) where game_account_id=$2",[JSON.stringify(labels(['B','D'])),b]);
      await db.query("update public.ducks set build=jsonb_set(build,'{skillLabels}',$1::jsonb) where id=$2",[JSON.stringify(labels(['A','C'])),duckB]);
      await asUser(userA);
      const row=await value('select public.get_online_opponent($1) data',[b]),decoded=decodePublicOpponent(row,a);
      assert.doesNotMatch(JSON.stringify(row),/PRIVATE/);
      for(const [owner,keys]of [[decoded.build.battler,['B','D']],[decoded.build.ducks[0],['A','C']]])
        for(const k of keys)assert.deepEqual(owner.skillLabels[k],{name:k+'雷',ruby});
      await db.exec(`reset role;
        update public.battlers set build=jsonb_set(build-'skillLabels','{schemaVersion}','2') where game_account_id='${b}';
        update public.ducks set build=jsonb_set(build-'skillLabels','{schemaVersion}','2') where id='${duckB}';`);
      await asUser(userA);
      const old=await value('select public.get_online_opponent($1) data',[b]);
      assert.equal('skillLabels' in old.battler.build,false);assert.equal('skillLabels' in old.ducks[0].build,false);
      const migrated=decodePublicOpponent(old,a);assert.equal(migrated.build.schemaVersion,3);
      assert.deepEqual(migrated.build.ducks[0].skillLabels.A,{name:'',ruby:''});
    });
    const prepare=()=>value('select public.prepare_online_battle($1,$2,$3,$4) data',[a,da,b,duckB]);
    await t.test('VS pairs latest own and public data; forged own account/duck is denied',async()=>{
      await db.exec(`reset role; update public.battlers set presentation=jsonb_set(presentation,'{name}','"latest"') where game_account_id='${b}';`);await asUser(userA);
      const pair=await prepare();
      assert.equal(decodeOnlinePlayer(pair.self).presentation.battler.profile.text,'PRIVATE-BATTLER-PROFILE');
      assert.equal(decodePublicOpponent(pair.opponent,a).presentation.schemaVersion,2);
      assert.doesNotMatch(JSON.stringify(pair.opponent),/PRIVATE|profile|featuredBattleId|flavorStats/);
      assert.equal(pair.opponent.battler.presentation.name,'latest');
      assert.equal(pair.opponent.ducks[0].presentation.icon.cutinUrl,'https://example.invalid/cutin2.png');
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
