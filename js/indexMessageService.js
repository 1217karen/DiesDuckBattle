import { codePointLength } from '../supabase/functions/_shared/text-limits.mjs';
import { canonicalEno } from '../supabase/functions/_shared/internal-email.mjs';
export const HOME_MESSAGE_MAX = 60;
export { codePointLength };
export const normalizeHomeMessage = value => value.trim();
const check = value => { if (!value) throw new TypeError('Invalid INDEX messages'); };
const keys = (v, names) => check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v,k)));
const message = v => check(typeof v === 'string' && codePointLength(v) <= HOME_MESSAGE_MAX && v === v.trim());
export function decodeIndexMessages(value, eno) {
  keys(value, ['eno','ownMessage','others']); check(value.eno === eno && canonicalEno(eno) === eno);
  message(value.ownMessage); check(Array.isArray(value.others) && value.others.length <= 3);
  const seen = new Set([eno]);
  for (const row of value.others) {
    keys(row, ['eno','battlerName','defaultIconUrl','message']);
    check(typeof row.eno === 'string' && canonicalEno(row.eno) === row.eno && !seen.has(row.eno)); seen.add(row.eno);
    check(typeof row.battlerName === 'string' && typeof row.defaultIconUrl === 'string');
    message(row.message); check(!!row.message);
  }
  return structuredClone(value);
}
export function createIndexMessageService(client, eno) {
  let generation = 0;
  const failure = saving => ({ok:false,message:saving ? '保存できませんでした。入力内容を確認し、再度お試しください。' : 'ひとことを読み込めませんでした。'});
  async function request(saving, text) {
    const version = generation;
    try {
      check(typeof eno === 'string' && canonicalEno(eno) === eno);
      if (saving) { message(text); }
      const before = await client.auth.getSession(), id = before.data?.session?.user?.id;
      if (before.error || !id || version !== generation) return failure(saving);
      const response = await client.rpc(saving ? 'set_index_message' : 'get_index_messages', {p_eno:eno, ...(saving ? {p_message:text} : {})});
      const after = await client.auth.getSession();
      if (response.error || after.error || after.data?.session?.user?.id !== id || version !== generation) return failure(saving);
      if (!saving) return {ok:true,...decodeIndexMessages(response.data,eno)};
      keys(response.data,['eno','message']); check(response.data.eno === eno); message(response.data.message);
      check(response.data.message === text);
      return {ok:true,message:response.data.message};
    } catch { return failure(saving); }
  }
  return {load:()=>request(false), save:text=>request(true,typeof text === 'string' ? normalizeHomeMessage(text) : text), invalidate(){ generation++; }};
}
