import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {buildBlocks} from '../js/resultBlocks.js';
import {player} from './onlineSelectFixture.mjs';
import {createSelectState,selectOwnDuck,selectOpponent} from '../js/selectState.js';
import {startSelectedBattle} from '../js/selectBattle.js';
let PGlite;
if(process.env.PGLITE_MODULE)({PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE)));
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const da='33333333-3333-4333-8333-333333333333',dbb='44444444-4444-4444-8444-444444444444';
const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const presentation={battlerDefaultIconUrl:'old-battler.png',duckIconUrl:'old-duck.png',cutinUrl:'old-cutin.png',quotes:{battleStart:{text:'hello',iconUrl:'quote.png'}}};
const record={battleId:a,dateISO:'1900-01-01',battleNo:999,
  p1:{battlerId:a,duckId:da,battlerName:'Old A',duckName:'Old Duck A',loadout:{private:1},presentation},
  p2:{battlerId:b,duckId:dbb,battlerName:'Old B',duckName:'Old Duck B',presentation},
  result:'draw',events:[{type:'battleEnd',result:'draw'}]};
test('battle result database boundary and persistence',{skip:!PGlite&&'Set PGLITE_MODULE'},async t=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      grant execute on function auth.uid() to authenticated,anon,service_role;`);
    for(const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())
      await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    await db.exec(`insert into auth.users values ('${user}');insert into public.game_accounts(id) values ('${a}'),('${b}');
      insert into public.game_account_access values ('${user}','${a}',now());
      insert into public.ducks(id,game_account_id) values ('${da}','${a}'),('${dbb}','${b}');
      set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);`);
    const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0].data;
    const save=(r=record,ids=[a,da,b,dbb])=>value('select public.save_online_battle_result($1,$2,$3,$4,$5::jsonb) data',[...ids,JSON.stringify(r)]);
    const load=id=>value('select public.get_online_battle_result($1) data',[id]);
    const list=(page=1,order='desc')=>value('select public.list_online_battle_results($1,30,$2) data',[page,order]);
    let meta;
    const own=await player(a,'1',da), opponent=await player(b,'2',dbb);
    let state=createSelectState({ok:true,status:'loaded',build:own.data.build},{id:a,name:'Old A'});
    state=selectOwnDuck(state,da);
    state=selectOpponent(state,{id:b,name:'Old B',build:opponent.data.build,publicDuckId:dbb});
    const battle=startSelectedBattle(state,{rng:()=>0.5});
    assert.equal(battle.ok,true,battle.message);record.events=battle.events;record.result=battle.result;
    await t.test('own P1 succeeds; server generates UUID, sequence, time and ENo snapshots',async()=>{
      meta=await save();assert.match(meta.battleId,/^[0-9a-f-]{36}$/);assert.notEqual(meta.battleId,a);
      assert.equal(meta.battleNo,1);assert.ok(Math.abs(Date.now()-Date.parse(meta.dateISO))<60000);
      const saved=await load(meta.battleId);assert.equal(saved.battleId,meta.battleId);assert.equal(saved.battleNo,meta.battleNo);
      assert.equal(saved.dateISO,meta.dateISO);assert.equal(saved.p1.eno,'1');assert.equal(saved.p2.eno,'2');
      assert.ok(!('loadout' in saved.p1));assert.deepEqual(saved.p1.presentation,presentation);assert.deepEqual(saved.events,record.events);
      assert.ok(buildBlocks(saved.events,saved.result,{maxHP:{P1:100,P2:100},names:{P1:{battler:'A',duck:'D'},P2:{battler:'B',duck:'E'}},presentations:{P1:presentation,P2:presentation}}).length>0);
      assert.equal(await load(a),null);
    });
    await t.test('P1 spoofing, same account, and mismatched Duck owners rejected',async()=>{
      for(const ids of [[b,dbb,a,da],[a,da,a,da],[a,dbb,b,dbb],[a,da,b,da]])await assert.rejects(save(record,ids));
    });
    await t.test('malformed records and inconsistent endings rejected',async()=>{
      const variants=[null,[],{}, {...record,result:'win'},{...record,events:{}},{...record,events:[]},
        {...record,events:[{type:'battleEnd',result:'P1_win'}]}, {...record,events:[null]},
        {...record,events:[{type:'battleEnd',result:'draw'},{type:'battleEnd',result:'draw'}]},
        {...record,p1:{...record.p1,battlerId:b}}, {...record,p1:{...record.p1,duckId:dbb}},
        {...record,p2:{...record.p2,battlerId:a}}, {...record,p2:{...record.p2,duckId:da}},
        {...record,p1:{...record.p1,battlerName:null}}, {...record,p2:{...record.p2,presentation:null}}];
      for(const r of variants)await assert.rejects(save(r));
    });
    await t.test('direct table/sequence access and anonymous RPCs unavailable',async()=>{
      for(const sql of ['select * from public.battles',"insert into public.battles default values",'update public.battles set result=\'draw\'','delete from public.battles',"select nextval('public.battles_battle_no_seq')"])
        await assert.rejects(db.exec(sql));
      await db.exec("reset role;set role anon;");
      await assert.rejects(load(meta.battleId));await assert.rejects(list());await assert.rejects(save());
      await db.exec("reset role;set role authenticated;select set_config('request.jwt.claim.sub','',false);");
      await assert.rejects(load(meta.battleId));await assert.rejects(list());await assert.rejects(save());
      await db.exec(`select set_config('request.jwt.claim.sub','${user}',false);`);
    });
    await t.test('30 summaries, asc/desc, totals, bounds and no full events',async()=>{
      // A public Duck switch between prepare and save must not invalidate ownership.
      await db.exec(`reset role;update public.game_accounts set public_duck_id='${dbb}' where id='${b}';
        update public.game_accounts set public_duck_id=null where id='${b}';set role authenticated;`);
      for(let i=0;i<30;i++)await save();
      const newest=await list(),oldest=await list(1,'asc'),last=await list(2);
      assert.equal(newest.records.length,30);assert.equal(newest.total,31);assert.equal(newest.totalPages,2);
      assert.equal(newest.pageSize,30);assert.equal(newest.records[0].battleNo,31);
      assert.equal(oldest.records[0].battleNo,1);assert.equal(last.records.length,1);assert.equal(last.records[0].battleNo,1);
      assert.equal((await list(999)).page,2);
      for(const row of newest.records){assert.ok(!('events' in row));assert.equal(row.p1.eno,'1');assert.equal(row.p2.eno,'2');
        assert.equal(row.p1.battlerName,'Old A');assert.equal(row.p2.duckName,'Old Duck B');
        assert.deepEqual(row.p1.presentation,{battlerDefaultIconUrl:'old-battler.png',duckIconUrl:'old-duck.png'});}
      await assert.rejects(list(0));await assert.rejects(list(1,'bad'));
    });
    await t.test('all valid outcomes save and sequence values stay unique',async()=>{
      for(const result of ['P1_win','P2_win','draw']) {
        const saved=await save({...record,result,events:[{type:'battleEnd',result}]});
        assert.equal((await load(saved.battleId)).result,result);
      }
      const rows=(await list()).records;assert.equal(new Set(rows.map(r=>r.battleNo)).size,rows.length);
    });
    await t.test('snapshots survive presentation changes and participant deletion; result CHECK and RLS enabled',async()=>{
      await db.exec(`reset role;update public.ducks set presentation='{"name":"Changed"}';`);
      assert.equal(await value("select relrowsecurity data from pg_class where oid='public.battles'::regclass"),true);
      await assert.rejects(db.exec("update public.battles set result='invalid'"));
      const row=await value('select row_to_json(b) data from public.battles b where id=$1',[meta.battleId]);
      assert.equal(row.p1_eno,1);assert.equal(row.p2_eno,2);assert.equal(row.created_at,meta.dateISO);
      await db.exec('delete from public.game_accounts;set role authenticated;');
      assert.equal((await load(meta.battleId)).p1.battlerName,'Old A');assert.equal((await list()).records[0].p1.presentation.duckIconUrl,'old-duck.png');
    });
  } finally {await db.close();}
});
