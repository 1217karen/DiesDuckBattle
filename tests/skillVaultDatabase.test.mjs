import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { BATTLER_PRESETS,DUCK_PRESETS } from '../js/battlePresets.js';
import { skillVaultContract,skillVaultContractSQL } from '../scripts/skill-vault-contract.mjs';
import { presentVaultSkill } from '../js/skillVaultModel.js';
let PGlite;if(process.env.PGLITE_MODULE)({PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE)));
test('vault migration contract matches current identities/options (no prices)',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20261014111357_skill_vault.sql',import.meta.url),'utf8');
  assert.ok(sql.includes(skillVaultContractSQL()));
});
test('vault DB ownership, strict selections, stable numbers, idempotency and revision isolation',{skip:!PGlite&&'Set PGLITE_MODULE'},async t=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
    for(const f of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())
      await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
    const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    for(let n=1;n<=3;n++){
      await db.query('insert into auth.users values ($1)',[id(n)]);
      await db.query('insert into public.game_accounts(id) values ($1)',[id(n)]);
      await db.query('insert into public.game_account_access values ($1,$2)',[id(n===2?1:n),id(n)]);
    }
    const revisions=()=>db.query('select id,save_revision from public.game_accounts order by id');
    const before=(await revisions()).rows;
    const as=async(n=1,role='authenticated')=>{await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);};
    const rpc=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) data`,args)).rows[0].data;
    const list=(account=1)=>rpc('list_skill_vault',[id(account)]);
    let serial=100;
    const store=(type,sel,name='',ruby='',account=1,entryId=id(serial++))=>rpc('store_skill_vault',[id(account),entryId,type,sel,name,ruby]);
    const remove=(entryId,account=1)=>rpc('delete_skill_vault',[id(account),entryId]);
    const selections=Object.fromEntries(['A','B','C','D'].map(type=>[type,structuredClone((['A','C'].includes(type)?DUCK_PRESETS[0]:BATTLER_PRESETS[0])[type.toLowerCase()+'Selection'])]));
    await t.test('catalog-derived legal leaves agree with JS completion, malformed fields rejected',async()=>{
      const contract=skillVaultContract();
      const sample=spec=>Array.isArray(spec)?spec[0]:Object.fromEntries(Object.entries(spec.fields).filter(([k])=>!spec.optional.includes(k)).map(([k,v])=>[k,sample(v)]));
      for(const type of ['A','B','C']) for(const row of contract[type]){
        let leaf=sample(row.schema),s;
        if(type==='A') s={triggerId:row.face===null?'all':`exact:${row.face}`,effects:row.cancel?[leaf,contract.A[0]].map((v,i)=>i?sample(v.schema):v):[leaf]};
        else if(type==='B') s=leaf;
        else s={mode:row.modes[0],structure:{kind:'flat',effects:[leaf]}};
        assert.equal(presentVaultSkill(type,s).complete,true,JSON.stringify(s));
        const valid=await db.query('select diesduck_private.valid_vault_selection($1,$2) valid',[type,s]);
        assert.equal(valid.rows[0].valid,true,JSON.stringify(s));
      }
    });
    await as();
    await t.test('all categories, same names, blank names and per-type persistent counters',async()=>{
      for(const type of ['A','B','C','D']) {
        let rows=await store(type,selections[type]);let entry=rows.filter(r=>r.type===type).at(-1);
        assert.equal(entry.displayName,'スキル1');assert.equal(entry.name,'');
        await remove(entry.id);rows=await store(type,selections[type]);
        assert.equal(rows.filter(r=>r.type===type).at(-1).displayName,'スキル2');
        await store(type,selections[type],'同名','るび');await store(type,selections[type],'同名','るび');
        rows=await list();assert.equal(rows.filter(r=>r.type===type&&r.name==='同名').length,2);
        assert.deepEqual(rows.find(r=>r.type===type).selection,selections[type]);
      }
    });
    await t.test('explicit accounts even with multiple ENo; no cross-account access or direct table rights',async()=>{
      assert.deepEqual(await list(2),[]);await store('D',selections.D,'別ENo','',2);
      assert.equal((await list()).some(r=>r.name==='別ENo'),false);
      for(const name of ['list_skill_vault','delete_skill_vault','store_skill_vault']) {
        const args=name==='list_skill_vault'?[id(3)]:name==='delete_skill_vault'?[id(3),id(100)]:[id(3),id(serial++),'D',selections.D,'',''];
        await assert.rejects(rpc(name,args),{code:'42501'});
      }
      for(const table of ['skill_vault','skill_vault_counters']) for(const op of [`select * from`, `delete from`])
        await assert.rejects(db.exec(`${op} diesduck_private.${table}`),{code:'42501'});
      await as(0);await assert.rejects(list(),{code:'42501'});
      await as(0,'anon');await assert.rejects(list(),{code:'42501'});await as();
    });
    await t.test('reject extra properties, unknown IDs, bad values and incomplete C branches',async()=>{
      for(const type of ['A','B','C','D']) {
        await assert.rejects(store(type,{...selections[type],extra:true}),{code:'22023'});
        await assert.rejects(store(type,null),{code:'22023'});
        await assert.rejects(store(type,selections[type],'😀'.repeat(21)),{code:'22023'});
        await assert.rejects(store(type,selections[type],'','😀'.repeat(51)),{code:'22023'});
      }
      await assert.rejects(store('D',{optionId:'unknown'}),{code:'22023'});
      const c={mode:'normal',structure:{kind:'random',branches:[{effects:selections.C.structure.effects},{effects:[]}]}};
      await assert.rejects(store('C',c),{code:'22023'});
      c.structure.branches[1].effects=selections.C.structure.effects;await store('C',c);
      const a={triggerId:'all',effects:Array.from({length:4},()=>({effectId:'heal',targetId:'self',options:{amount:'amount-7'}}))};
      await store('A',a);a.effects[0].options.amount='forged';await assert.rejects(store('A',a),{code:'22023'});
    });
    await t.test('same operation ID does not duplicate; delete removes content and prevents resurrection',async()=>{
      const operation=id(serial++);await store('D',selections.D,'','','1',operation);
      const count=(await list()).length;await store('D',selections.D,'','',1,operation);assert.equal((await list()).length,count);
      await remove(operation,2);assert.equal((await list()).length,count);
      await remove(operation);await remove(operation);assert.equal((await list()).length,count-1);
      await assert.rejects(store('D',selections.D,'','',1,operation),{code:'22023'});
    });
    await db.exec('reset role');assert.deepEqual((await revisions()).rows,before);
    assert.equal((await db.query("select count(*)::integer n from pg_class where relname in ('skill_vault','skill_vault_counters') and relrowsecurity")).rows[0].n,2);
    assert.ok((await db.query("select selection,skill_name,ruby from diesduck_private.skill_vault where deleted_at is not null")).rows.every(r=>JSON.stringify(r.selection)==='{}'&&r.skill_name===''&&r.ruby===''));
  } finally {await db.close();}
});
