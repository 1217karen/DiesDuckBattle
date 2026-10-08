import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {decodeIndexMessages} from '../js/indexMessageService.js';
let PGlite;if(process.env.PGLITE_MODULE)({PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE)));
test('INDEX message database ACL, bounds, random public projection and revision independence',{skip:!PGlite&&'Set PGLITE_MODULE'},async t=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;`);
 for(const f of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
 const ids=Array.from({length:6},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
 for(const id of ids)await db.query(`insert into auth.users values ($1);`,[id]);
 for(const id of ids){await db.query('insert into public.game_accounts(id) values ($1)',[id]);await db.query('insert into public.game_account_access(auth_user_id,game_account_id) values ($1,$1)',[id]);await db.query(`insert into public.battlers(game_account_id,presentation) values ($1,'{"name":"name","defaultIconUrl":"/icon.png","profile":{"message":"SECRET"},"quotes":"SECRET"}')`,[id]);}
 const as=async(role='authenticated',id=ids[0])=>db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${id}',false);`);
 const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0].data;
 const set=(text,eno='1')=>value('select public.set_index_message($1,$2) data',[eno,text]);
 const get=()=>value('select public.get_index_messages(1) data');
 await t.test('owner save, overwrite, Unicode 60/61, blank reset and unchanged player revision',async()=>{
 const revision=await value('select save_revision::text data from public.game_accounts where eno=1');
 await as();assert.equal((await get()).ownMessage,'');assert.equal((await set('first')).message,'first');assert.equal((await set('second')).message,'second');assert.equal((await get()).ownMessage,'second');
 assert.equal((await set('😀'.repeat(60))).message,'😀'.repeat(60));await assert.rejects(set('😀'.repeat(61)),{code:'22023'});
 for(const text of ['', ' \n\t　', '\u00a0\uFEFF', '\v']){await set(text);assert.equal((await get()).ownMessage,'');}
 await set('value');assert.equal((await get()).ownMessage,'value');
 await db.exec('reset role');assert.equal(await value('select save_revision::text data from public.game_accounts where eno=1'),revision);
 assert.equal(await value('select count(*)::int data from public.game_account_messages where game_account_id=$1',[ids[0]]),1);
 });
 await t.test('deny arbitrary owner, direct DML/read, unauthenticated and multi-account access',async()=>{
 await as();await assert.rejects(set('attack','2'),{code:'42501'});await assert.rejects(value('select public.get_index_messages(2) data'),{code:'42501'});
 for(const sql of [`select * from public.game_account_messages`,`insert into public.game_account_messages values ('${ids[1]}','attack',now())`,`update public.game_account_messages set message='attack'`,`delete from public.game_account_messages`])await assert.rejects(db.exec(sql),{code:'42501'});
 await as('anon','');await assert.rejects(get(),{code:'42501'});await assert.rejects(set('no'),{code:'42501'});
 await as('authenticated','');await assert.rejects(get(),{code:'42501'});await assert.rejects(set('no'),{code:'42501'});
 await db.exec('reset role');await db.query('insert into public.game_account_access(auth_user_id,game_account_id) values ($1,$2)',[ids[0],ids[1]]);
 await as();await assert.rejects(get(),{code:'42501'});await assert.rejects(set('no'),{code:'42501'});await db.exec('reset role');await db.query('delete from public.game_account_access where auth_user_id=$1 and game_account_id=$2',[ids[0],ids[1]]);
 });
 await t.test('random max three excluding own/unset; only four public fields; cascade and no player revision changes',async()=>{
 await as();assert.equal((await get()).others.length,0);
 await as('authenticated',ids[1]);await set('only one','2');await as();assert.equal((await get()).others.length,1);
 for(let i=1;i<5;i++){await as('authenticated',ids[i]);await set('message'+i,String(i+1));}
 await as();await db.exec('select setseed(0.25)');const seen=new Set();for(let i=0;i<20;i++){const data=decodeIndexMessages(await get(),'1');assert.equal(data.others.length,3);for(const row of data.others){seen.add(row.eno);assert.notEqual(row.eno,'1');assert.notEqual(row.eno,'6');assert.deepEqual(Object.keys(row).sort(),['battlerName','defaultIconUrl','eno','message']);}assert.doesNotMatch(JSON.stringify(data),/SECRET|updated_at|game_account_id|profile|quotes/);}
 assert.equal(seen.size,4);
 await db.exec('reset role');await db.query('delete from public.game_accounts where id=$1',[ids[1]]);assert.equal(await value('select count(*)::int data from public.game_account_messages where game_account_id=$1',[ids[1]]),0);
 });
 }finally{await db.close();}
});
