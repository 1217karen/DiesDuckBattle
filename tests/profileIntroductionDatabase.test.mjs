import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { introductionIsBlank, decodeIntroductions } from '../js/profileIntroductionService.js';
let PGlite; if (process.env.PGLITE_MODULE) ({ PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE)));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('introduction DB: RPC permissions, constraints, ordering, dynamic projection and cascading deletion', { skip: !PGlite && 'Set PGLITE_MODULE' }, async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`);
    for (const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())
      await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    for (let n=1;n<=4;n++) {
      await db.query('insert into auth.users values ($1)',[id(n)]);
      await db.query('insert into public.game_accounts(id) values ($1)',[id(n)]);
      await db.query('insert into public.game_account_access(auth_user_id,game_account_id) values ($1,$1)',[id(n)]);
      await db.query('insert into public.battlers(game_account_id,presentation) values ($1,$2)',[id(n),JSON.stringify({name:'作者'+n,defaultIconUrl:'default.png',iconSlots:['slot.png'],profile:{theme:{background:'#010203',panel:'#040506',text:'#ffffff',accent:'#abcdef'}},quotes:'SECRET'})]);
    }
    const as = (n,role='authenticated') => db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${n?id(n):''}',false);`);
    const list = async (target=2) => (await db.query('select public.list_profile_introductions($1) data',[id(target)])).rows[0].data;
    const save = async ({author=1,target=2,original=null,body='紹介文',slot=null,image=''}={}) => (await db.query(
      'select public.save_profile_introduction($1,$2,$3,$4,$5,$6,$7) data',[id(author),id(target),original?.id??null,original?.revision??null,body,slot,image])).rows[0].data;
    await t.test('anonymous public read only; self/spoofed author and direct private writes rejected',async()=>{
      await as(0,'anon');assert.deepEqual(await list(),[]);await assert.rejects(save(),{code:'42501'});
      await as(0);await assert.rejects(save(),{code:'42501'});
      await as(1);await assert.rejects(save({target:1}),{code:'22023'});await assert.rejects(save({author:3}),{code:'42501'});
      for(const sql of ['select * from diesduck_private.profile_introductions','delete from diesduck_private.profile_introductions',"insert into diesduck_private.profile_introductions(author_account_id,target_account_id,body) values ('"+id(1)+"','"+id(2)+"','x')"])
        await assert.rejects(db.exec(sql),{code:'42501'});
    });
    await t.test('JS/SQL agree on blank decoration and Unicode whitespace; 500 code points with tags',async()=>{
      await db.exec('reset role');
      for(const body of ['', ' \n\t', '<b><i> \n</i></b>', '<RB></RB><rt> </rt>', '\u00a0\u1680\u2007\u2028\u202f\u205f\u3000\ufeff', '<script></script>', '<b>x</b>']) {
        const blank=(await db.query('select diesduck_private.introduction_is_blank($1) b',[body])).rows[0].b;
        assert.equal(blank,introductionIsBlank(body),JSON.stringify(body));
      }
      await as(1);
      for(const body of ['', '<b> </b>', '😀'.repeat(501)])await assert.rejects(save({body}),{code:'22023'});
      for(const slot of [0,11])await assert.rejects(save({slot}),{code:'23514'});
      for(const image of ['javascript:alert(1)','data:image/png;base64,x','https://x/ a'])await assert.rejects(save({image}),{code:'23514'});
      const created=await save({body:'😀'.repeat(500),slot:1,image:'https://example.com/a.png'});
      assert.ok(created.id);assert.equal(created.revision,'1');
      await assert.rejects(save(),{code:'40001'});assert.equal((await list()).length,1);
    });
    let first;
    await t.test('only author updates/deletes; edit preserves id/createdAt/order and stale edits fail',async()=>{
      await as(3);await save({author:3});
      await as(1);first=(await list())[0];
      const edited=await save({original:first,body:'<b>改行</b>\n<script>text</script>'});
      const rows=decodeIntroductions(await list());assert.equal(rows.length,2);assert.equal(rows[0].id,first.id);
      assert.equal(rows[0].createdAt,first.createdAt);assert.equal(rows[0].revision,'2');assert.equal(edited.id,first.id);
      await assert.rejects(save({original:first}),{code:'40001'});
      await as(3);await assert.rejects(save({author:1,original:rows[0]}),{code:'42501'});
      await assert.rejects(save({author:3,original:rows[0]}),{code:'40001'});
      await as(2);await assert.rejects(save({author:1,original:rows[0],body:''}),{code:'42501'});
    });
    await t.test('read projects latest author colors/icons only; empty selected slot falls back to current default',async()=>{
      await as(1);let original=(await list())[0];await save({original,slot:1});
      await db.exec('reset role');
      await db.query(`update public.battlers set presentation=jsonb_set(jsonb_set(presentation,'{iconSlots,0}','""'),'{profile,theme,accent}','"#123456"') where game_account_id=$1`,[id(1)]);
      await as(0,'anon');const rows=decodeIntroductions(await list());
      assert.equal(rows[0].author.iconUrl,'default.png');assert.equal(rows[0].author.theme.accent,'#123456');assert.equal(rows[1].author.theme.accent,'#abcdef');
      assert.doesNotMatch(JSON.stringify(rows),/SECRET|quotes|iconSlots|presentation/);
    });
    await t.test('blank deletion ignores image/icon; recreation is new and goes last, old editor cannot overwrite it',async()=>{
      await as(1);const original=(await list())[0];assert.equal((await save({original,body:'<b> \n</b>',slot:99,image:'invalid'})).deleted,true);
      assert.equal((await list()).length,1);const recreated=await save();assert.notEqual(recreated.id,original.id);
      assert.deepEqual((await list()).map(r=>r.author.eno),['3','1']);
      await assert.rejects(save({original}),{code:'40001'});
    });
    await t.test('fixed UUID tie break; removing either account cascades all related introductions',async()=>{
      await db.exec("reset role; update diesduck_private.profile_introductions set created_at='2026-01-01';");
      await as(0,'anon');const rows=await list();assert.deepEqual(rows.map(r=>r.id),rows.map(r=>r.id).sort());
      await db.exec('reset role');await db.query('delete from public.game_accounts where id=$1',[id(1)]);
      await as(0,'anon');assert.equal((await list()).length,1);
      await db.exec('reset role');await db.query('delete from public.game_accounts where id=$1',[id(2)]);
      assert.equal((await db.query('select count(*)::int n from diesduck_private.profile_introductions')).rows[0].n,0);
    });
  } finally { await db.close(); }
});
