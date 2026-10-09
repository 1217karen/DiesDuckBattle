import { codePointLength } from '../supabase/functions/_shared/text-limits.mjs';
import { canonicalEno } from '../supabase/functions/_shared/internal-email.mjs';

export const FEEDBACK_TITLE_MAX = 100;
export const FEEDBACK_BODY_MAX = 2000;
export const FEEDBACK_CATEGORIES = Object.freeze({bug:'不具合',request:'要望',question:'質問・相談'});
export const FEEDBACK_STATUSES = Object.freeze({open:'受付中',confirmed:'確認済',resolved:'対応済',withdrawn:'取り下げ'});
export { codePointLength };
const check = value => { if (!value) throw new TypeError('Invalid feedback data'); };
const keys = (v, names) => check(v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v,k)));
const uuid = v => check(typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v));
const text = (v, max) => check(typeof v === 'string' && v.trim().length > 0 && codePointLength(v) <= max);
const flag = v => check(typeof v === 'boolean');
const count = v => check(Number.isSafeInteger(v) && v >= 0);
const date = v => check(typeof v === 'string' && Number.isFinite(Date.parse(v)));
export function validateFeedbackInput({category, title, body}, reply = false) {
  text(body, FEEDBACK_BODY_MAX);
  if (!reply) { check(Object.hasOwn(FEEDBACK_CATEGORIES, category)); text(title, FEEDBACK_TITLE_MAX); }
}
export function decodeFeedbackList(value) {
  keys(value,['threads','canPost','isModerator']); flag(value.canPost); flag(value.isModerator);
  check(Array.isArray(value.threads)); const seen = new Set();
  for (const row of value.threads) {
    keys(row,['id','category','title','body','status','createdAt','reactionCount','replyCount','isOwn','hasReacted']);
    uuid(row.id); check(!seen.has(row.id)); seen.add(row.id);
    validateFeedbackInput(row); check(Object.hasOwn(FEEDBACK_STATUSES,row.status)); date(row.createdAt);
    count(row.reactionCount); count(row.replyCount); flag(row.isOwn); flag(row.hasReacted);
  }
  return structuredClone(value);
}
export function decodeFeedbackReplies(value) {
  check(Array.isArray(value)); const seen = new Set();
  for (const row of value) {
    keys(row,['id','body','createdAt','isAuthor','isModerator']); uuid(row.id);
    check(!seen.has(row.id)); seen.add(row.id); text(row.body,FEEDBACK_BODY_MAX);
    date(row.createdAt); flag(row.isAuthor); flag(row.isModerator);
  }
  return structuredClone(value);
}
export function selectFeedback(threads, category='all', status='all', order='newest') {
  return threads.filter(row => (category === 'all' || row.category === category) && (status === 'all' || row.status === status))
    .sort((a,b) => (order === 'reactions' ? b.reactionCount-a.reactionCount : 0)
      || Date.parse(b.createdAt)-Date.parse(a.createdAt) || a.id.localeCompare(b.id));
}

export function createFeedbackService(client, onSessionChange = () => {}) {
  let generation = 0;
  // SDK callbacks stay synchronous: never await getSession/RPC inside the Auth lock.
  const subscription = client.auth.onAuthStateChange?.((event) => {
    if (event === 'TOKEN_REFRESHED') return;
    generation++; onSessionChange();
  })?.data?.subscription;
  const failure = () => ({ok:false,message:'処理を完了できませんでした。通信状況とログイン状態を確認し、再度お試しください。'});
  async function request(name, args, decode, writing=false) {
    const version = generation;
    try {
      const before = await client.auth.getSession(), session = before.data?.session;
      const id = session?.user?.id ?? null;
      if (before.error || (writing && !id) || version !== generation) return failure();
      const response = await client.rpc(name,args);
      const after = await client.auth.getSession(), current = after.data?.session;
      if (version !== generation || (current?.user?.id ?? null) !== id
        || current?.access_token !== session?.access_token) return {ok:false,stale:true};
      if (response.error || after.error) return failure();
      return {ok:true,data:decode(response.data)};
    } catch { return version !== generation ? {ok:false,stale:true} : failure(); }
  }
  const account = eno => { check(typeof eno === 'string' && canonicalEno(eno) === eno); return eno; };
  const yes = v => { check(v === true); return v; };
  const idResult = v => { uuid(v); return v; };
  const validated = fn => { try { return fn(); } catch { return Promise.resolve({ok:false,message:'種別と文字数を確認してください。タイトルは100文字、本文は2000文字までです。'}); } };
  return {
    list: (eno=null) => validated(() => request('list_feedback_threads',{p_eno:eno === null ? null : account(eno)},decodeFeedbackList)),
    replies: id => validated(() => { uuid(id); return request('list_feedback_replies',{p_thread_id:id},decodeFeedbackReplies); }),
    create: (eno,input) => validated(() => { validateFeedbackInput(input); return request('create_feedback_thread',
      {p_eno:account(eno),p_category:input.category,p_title:input.title.trim(),p_body:input.body.trim()},idResult,true); }),
    reply: (eno,id,body) => validated(() => { uuid(id); validateFeedbackInput({body},true); return request('create_feedback_reply',
      {p_eno:account(eno),p_thread_id:id,p_body:body.trim()},idResult,true); }),
    react: (eno,id) => validated(() => { uuid(id); return request('toggle_feedback_reaction',{p_eno:account(eno),p_thread_id:id},v => {
      keys(v,['hasReacted','reactionCount']); flag(v.hasReacted); count(v.reactionCount); return structuredClone(v);
    },true); }),
    withdraw: (eno,id) => validated(() => { uuid(id); return request('withdraw_feedback_thread',{p_eno:account(eno),p_thread_id:id},yes,true); }),
    status: (id,status) => validated(() => { uuid(id); check(['open','confirmed','resolved'].includes(status)); return request('moderate_feedback_status',{p_thread_id:id,p_status:status},yes,true); }),
    hide: (id,replyId=null) => validated(() => { uuid(id); if (replyId !== null) uuid(replyId); return request('hide_feedback',{p_thread_id:id,p_reply_id:replyId},yes,true); }),
    invalidate() { generation++; },
    dispose() { generation++; subscription?.unsubscribe(); },
  };
}
