import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {decodeFeedbackList,decodeFeedbackReplies} from '../js/feedbackService.js';
let PGlite;if(process.env.PGLITE_MODULE)({PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE)));

test('feedback RPC security and lifecycle against PostgreSQL',{skip:!PGlite&&'Set PGLITE_MODULE'},async t=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
  for(const f of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())
   await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
  const ids=Array.from({length:3},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
  for(const id of ids){await db.query('insert into auth.users values ($1)',[id]);await db.query('insert into public.game_accounts(id) values ($1)',[id]);await db.query('insert into public.game_account_access(auth_user_id,game_account_id) values ($1,$1)',[id]);}
  await db.query('insert into diesduck_private.feedback_moderators values ($1)',[ids[2]]);
  const as=async(i=null,role=i===null?'anon':'authenticated')=>{await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i===null?'':ids[i]]);};
  const rpc=async(name,args=[]) => (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) data`,args)).rows[0].data;
  const list=eno=>rpc('list_feedback_threads',[eno??null]);
  const create=(eno='1',title='タイトル',body='本文')=>rpc('create_feedback_thread',[eno,'bug',title,body]);
  let thread,reply;
  await t.test('anon can read but cannot perform any write, even with spoofed account',async()=>{
   await as();assert.deepEqual(decodeFeedbackList(await list()),{threads:[],canPost:false,isModerator:false});
   assert.deepEqual(await rpc('list_feedback_replies',[ids[0]]),[]);
   for(const [name,args] of [['create_feedback_thread',['1','bug','title','body']],['create_feedback_reply',['1',ids[0],'body']],['toggle_feedback_reaction',['1',ids[0]]],['withdraw_feedback_thread',['1',ids[0]]],['moderate_feedback_status',[ids[0],'resolved']],['hide_feedback',[ids[0],null]]])
    await assert.rejects(rpc(name,args),{code:'42501'});
   await as(null,'authenticated');await assert.rejects(create(),{code:'42501'});
  });
  await t.test('owner create, Unicode bounds, wrong account and invalid input',async()=>{
   await as(0);thread=await create();assert.equal((await list('1')).threads[0].status,'open');
   await assert.rejects(create('2'),{code:'42501'});await assert.rejects(list('2'),{code:'42501'});
   await create('1','😀'.repeat(100),'😀'.repeat(2000));
   for(const [title,body] of [['😀'.repeat(101),'b'],['t','😀'.repeat(2001)],['','b'],['t',''],['  ','b'],['t',' \n']])await assert.rejects(create('1',title,body),{code:'23514'});
   await assert.rejects(rpc('create_feedback_thread',['1','invalid','t','b']),{code:'23514'});
  });
  await t.test('flat replies, role snapshots, anonymous DTOs without identity',async()=>{
   reply=await rpc('create_feedback_reply',['1',thread,'author reply']);
   await as(1);await rpc('create_feedback_reply',['2',thread,'other reply']);
   await assert.rejects(rpc('create_feedback_reply',['1',thread,'spoof']),{code:'42501'});
   await assert.rejects(rpc('create_feedback_reply',['2',reply,'nested']),{code:'22023'});
   await assert.rejects(rpc('create_feedback_reply',['2',thread,'😀'.repeat(2001)]),{code:'23514'});
   await as(2);await rpc('create_feedback_reply',['3',thread,'moderator reply']);
   await as();const rows=decodeFeedbackReplies(await rpc('list_feedback_replies',[thread]));
   assert.equal(rows.length,3);assert.equal(rows.find(r=>r.body==='author reply').isAuthor,true);
   assert.equal(rows.find(r=>r.body==='other reply').isAuthor,false);assert.equal(rows.find(r=>r.body==='moderator reply').isModerator,true);
   const dto=decodeFeedbackList(await list());assert.equal(dto.threads.find(r=>r.id===thread).replyCount,3);
   for(const secret of [...ids,'auth_user_id','game_account_id','eno'])assert.ok(!JSON.stringify([rows,dto]).includes(secret));
  });
  await t.test('one reaction per account, toggle off and concurrent calls preserve uniqueness',async()=>{
   await as(0);assert.deepEqual(await rpc('toggle_feedback_reaction',['1',thread]),{hasReacted:true,reactionCount:1});
   assert.equal((await list('1')).threads.find(r=>r.id===thread).hasReacted,true);
   assert.deepEqual(await rpc('toggle_feedback_reaction',['1',thread]),{hasReacted:false,reactionCount:0});
   await Promise.all([rpc('toggle_feedback_reaction',['1',thread]),rpc('toggle_feedback_reaction',['1',thread])]);
   assert.equal((await list('1')).threads.find(r=>r.id===thread).reactionCount,0);
   await rpc('toggle_feedback_reaction',['1',thread]);await as(1);await rpc('toggle_feedback_reaction',['2',thread]);
   assert.equal((await list('2')).threads.find(r=>r.id===thread).reactionCount,2);
   await assert.rejects(rpc('toggle_feedback_reaction',['1',thread]),{code:'42501'});
   await db.exec('reset role');
   await assert.rejects(db.query('insert into diesduck_private.feedback_reactions(thread_id,game_account_id) values ($1,$2)',[thread,ids[0]]),{code:'23505'});
  });
  await t.test('only moderators set status; owner can withdraw open/confirmed only; nobody restores withdrawn',async()=>{
   await as(1);await assert.rejects(rpc('withdraw_feedback_thread',['2',thread]),{code:'42501'});
   await assert.rejects(rpc('withdraw_feedback_thread',['1',thread]),{code:'42501'});
   for(const user of [0,1]){await as(user);for(const status of ['confirmed','resolved'])await assert.rejects(rpc('moderate_feedback_status',[thread,status]),{code:'42501'});await assert.rejects(rpc('hide_feedback',[thread,null]),{code:'42501'});}
   await as(2);await rpc('moderate_feedback_status',[thread,'resolved']);
   await as(0);await assert.rejects(rpc('withdraw_feedback_thread',['1',thread]),{code:'42501'});
   await as(2);await rpc('moderate_feedback_status',[thread,'open']);await rpc('moderate_feedback_status',[thread,'confirmed']);
   await as(0);await rpc('withdraw_feedback_thread',['1',thread]);
   const row=(await list('1')).threads.find(r=>r.id===thread);assert.equal(row.status,'withdrawn');assert.equal(row.body,'本文');assert.equal(row.reactionCount,2);assert.equal(row.replyCount,3);
   const open=await create();await rpc('withdraw_feedback_thread',['1',open]);
   await assert.rejects(rpc('withdraw_feedback_thread',['1',thread]),{code:'42501'});
   await as(2);for(const status of ['open','confirmed','resolved'])await assert.rejects(rpc('moderate_feedback_status',[thread,status]),{code:'42501'});
  });
  await t.test('withdrawn closes ordinary replies and both reaction directions; moderator may reply but never reopen',async()=>{
   await as(0);const closed=await create();await rpc('toggle_feedback_reaction',['1',closed]);await rpc('withdraw_feedback_thread',['1',closed]);
   for(const i of [0,1]){
    await as(i);await assert.rejects(rpc('create_feedback_reply',[String(i+1),closed,'no']),{code:'42501'});
    await assert.rejects(rpc('toggle_feedback_reaction',[String(i+1),closed]),{code:'42501'});
   }
   await as(2);const managementReply=await rpc('create_feedback_reply',['3',closed,'運営からの補足']);
   await assert.rejects(rpc('toggle_feedback_reaction',['3',closed]),{code:'42501'});
   for(const status of ['open','confirmed','resolved'])await assert.rejects(rpc('moderate_feedback_status',[closed,status]),{code:'42501'});
   await as();const dto=decodeFeedbackList(await list()).threads.find(r=>r.id===closed);
   assert.equal(dto.body,'本文');assert.equal(dto.status,'withdrawn');assert.equal(dto.reactionCount,1);
   assert.equal(decodeFeedbackReplies(await rpc('list_feedback_replies',[closed]))[0].isModerator,true);
   await as(2);await rpc('hide_feedback',[closed,managementReply]);await rpc('hide_feedback',[closed,null]);
  });
  await t.test('hidden rows retained but not exposed, including parent reply endpoint and all roles',async()=>{
   await as(2);await rpc('hide_feedback',[thread,reply]);
   for(const i of [null,0,2]){await as(i);assert.ok(!(await rpc('list_feedback_replies',[thread])).some(r=>r.body==='author reply'));assert.equal((await list()).threads.find(r=>r.id===thread).replyCount,2);}
   await as(2);await rpc('hide_feedback',[thread,null]);
   for(const i of [null,0,2]){await as(i);assert.ok(!(await list()).threads.some(r=>r.id===thread));assert.deepEqual(await rpc('list_feedback_replies',[thread]),[]);}
   await as(0);await assert.rejects(rpc('create_feedback_reply',['1',thread,'no']),{code:'22023'});await assert.rejects(rpc('toggle_feedback_reaction',['1',thread]),{code:'22023'});
   await db.exec('reset role');assert.equal((await db.query('select body from diesduck_private.feedback_replies where id=$1',[reply])).rows[0].body,'author reply');
   assert.equal((await db.query('select body from diesduck_private.feedback_threads where id=$1',[thread])).rows[0].body,'本文');
  });
  await t.test('table ACL, private helpers, no edit/delete RPC, RLS and empty search paths',async()=>{
   for(const i of [null,0,2]){
    await as(i);
    for(const table of ['feedback_threads','feedback_replies','feedback_reactions','feedback_moderators'])for(const sql of [`select * from diesduck_private.${table}`,`delete from diesduck_private.${table}`])await assert.rejects(db.exec(sql),{code:'42501'});
    await assert.rejects(db.exec("update diesduck_private.feedback_threads set body='attack'"),{code:'42501'});
    await assert.rejects(db.exec("update diesduck_private.feedback_replies set body='attack'"),{code:'42501'});
    await assert.rejects(db.query("insert into diesduck_private.feedback_threads(game_account_id,category,title,body) values ($1,'bug','attack','attack')",[ids[0]]),{code:'42501'});
    await assert.rejects(db.query("insert into diesduck_private.feedback_replies(thread_id,game_account_id,body) values ($1,$2,'attack')",[thread,ids[0]]),{code:'42501'});
    await assert.rejects(db.query('insert into diesduck_private.feedback_reactions(thread_id,game_account_id) values ($1,$2)',[thread,ids[2]]),{code:'42501'});
    await assert.rejects(db.query('insert into diesduck_private.feedback_moderators values ($1)',[ids[0]]),{code:'42501'});
    await assert.rejects(db.exec('select diesduck_private.feedback_is_moderator()'),{code:'42501'});
   }
   await db.exec('reset role');
   const funcs=(await db.query("select p.proname,p.prosecdef,p.proconfig,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like '%feedback%' and n.nspname in ('public','diesduck_private')")).rows;
   assert.ok(funcs.every(f=>!/(edit|delete|update)/.test(f.proname)));
   assert.ok(funcs.every(f=>f.proconfig.includes('search_path=""')));
   assert.ok(funcs.filter(f=>f.nspname==='public').every(f=>!f.prosecdef));
   const tables=(await db.query("select relrowsecurity from pg_class where relname in ('feedback_threads','feedback_replies','feedback_reactions','feedback_moderators')")).rows;
   assert.equal(tables.length,4);assert.ok(tables.every(r=>r.relrowsecurity));
  });
  await t.test('account deletion keeps thread/reply records, clears ownership, removes only its votes and preserves moderation',async()=>{
   await as(0);const preserved=await create('1','残すタイトル','残す本文');
   const authorReply=await rpc('create_feedback_reply',['1',preserved,'投稿者の返信']);await rpc('toggle_feedback_reaction',['1',preserved]);
   await as(1);const otherReply=await rpc('create_feedback_reply',['2',preserved,'他の返信']);await rpc('toggle_feedback_reaction',['2',preserved]);
   await as(2);await rpc('toggle_feedback_reaction',['3',preserved]);
   const before=(await list()).threads.find(r=>r.id===preserved);
   // Delete the reply author first: NULL reply vs a still-existing thread account.
   await db.exec('reset role');await db.query('delete from public.game_accounts where id=$1',[ids[1]]);
   assert.deepEqual((await db.query('select body,game_account_id from diesduck_private.feedback_replies where id=$1',[otherReply])).rows[0],{body:'他の返信',game_account_id:null});
   await as();assert.equal(decodeFeedbackReplies(await rpc('list_feedback_replies',[preserved])).find(r=>r.id===otherReply).isAuthor,false);
   assert.equal((await list()).threads.find(r=>r.id===preserved).reactionCount,2);
   await db.exec('reset role');await db.query('delete from public.game_accounts where id=$1',[ids[0]]);
   assert.deepEqual((await db.query('select body,game_account_id from diesduck_private.feedback_threads where id=$1',[preserved])).rows[0],{body:'残す本文',game_account_id:null});
   assert.deepEqual((await db.query('select body,game_account_id from diesduck_private.feedback_replies where id=$1',[authorReply])).rows[0],{body:'投稿者の返信',game_account_id:null});
   for(const i of [null,0,1,2]){
    await as(i);const dto=decodeFeedbackList(await list(i===2?'3':null)).threads.find(r=>r.id===preserved);
    for(const key of ['title','body','category','status','createdAt'])assert.equal(dto[key],before[key]);
    assert.equal(dto.isOwn,false);assert.equal(dto.reactionCount,1);assert.equal(dto.replyCount,2);
    const replies=decodeFeedbackReplies(await rpc('list_feedback_replies',[preserved]));assert.equal(replies.length,2);assert.ok(replies.every(r=>r.isAuthor===false));
   }
   await as(0);await assert.rejects(rpc('withdraw_feedback_thread',['1',preserved]),{code:'42501'});
   await as(2);await assert.rejects(rpc('withdraw_feedback_thread',['3',preserved]),{code:'42501'});
   await rpc('moderate_feedback_status',[preserved,'confirmed']);
   const modReply=await rpc('create_feedback_reply',['3',preserved,'削除後の管理返信']);
   assert.equal(decodeFeedbackReplies(await rpc('list_feedback_replies',[preserved])).find(r=>r.id===modReply).isAuthor,false);
   await rpc('hide_feedback',[preserved,otherReply]);await rpc('hide_feedback',[preserved,null]);
  });
 }finally{await db.close();}
});
