import { codePointLength } from '../supabase/functions/_shared/text-limits.mjs';
import { canonicalEno } from '../supabase/functions/_shared/internal-email.mjs';
export const HOME_MESSAGE_MAX = 60;
export { codePointLength };
export const normalizeHomeMessage = value => value.trim();
const check = value => { if (!value) throw new TypeError('Invalid INDEX messages'); };
const keys = (v, names) => check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v,k)));
const message = v => check(typeof v === 'string' && codePointLength(v) <= HOME_MESSAGE_MAX && v === v.trim());
const iconSlot = v => v === null || (Number.isInteger(v) && v >= 1 && v <= 10);
export function decodeIndexMessages(value, eno) {
  keys(value, ['eno','ownMessage','ownIconSlot','ownDefaultIconUrl','ownIconSlots','others']);
  check(value.eno === eno && canonicalEno(eno) === eno);
  message(value.ownMessage);
  check(iconSlot(value.ownIconSlot) && typeof value.ownDefaultIconUrl === 'string'
    && Array.isArray(value.ownIconSlots) && value.ownIconSlots.length <= 10
    && value.ownIconSlots.every(url => typeof url === 'string'));
  check(Array.isArray(value.others) && value.others.length <= 3);
  const seen = new Set([eno]);
  for (const row of value.others) {
    keys(row, ['eno','battlerName','defaultIconUrl','iconUrl','message']);
    check(typeof row.eno === 'string' && canonicalEno(row.eno) === row.eno && !seen.has(row.eno)); seen.add(row.eno);
    check(typeof row.battlerName === 'string' && typeof row.defaultIconUrl === 'string' && typeof row.iconUrl === 'string');
    message(row.message); check(!!row.message);
  }
  return structuredClone(value);
}
export function createIndexMessageService(client, eno) {
  let generation = 0;
  const failure = saving => ({ok:false,message:saving ? '保存できませんでした。入力内容を確認し、再度お試しください。' : 'ひとことを読み込めませんでした。'});
  async function request(saving, text, chosenSlot = null) {
    const version = generation;
    try {
      check(typeof eno === 'string' && canonicalEno(eno) === eno);
      if (saving) { message(text); check(iconSlot(chosenSlot)); }
      const before = await client.auth.getSession(), id = before.data?.session?.user?.id;
      if (before.error || !id || version !== generation) return failure(saving);
      const response = await client.rpc(saving ? 'set_index_message_v2' : 'get_index_messages_v2',
        {p_eno:eno, ...(saving ? {p_message:text,p_icon_slot:chosenSlot} : {})});
      const after = await client.auth.getSession();
      if (response.error || after.error || after.data?.session?.user?.id !== id || version !== generation) return failure(saving);
      if (!saving) return {ok:true,...decodeIndexMessages(response.data,eno)};
      keys(response.data,['eno','message','iconSlot']);
      check(response.data.eno === eno && iconSlot(response.data.iconSlot));
      message(response.data.message);
      check(response.data.message === text && response.data.iconSlot === chosenSlot);
      return {ok:true,message:response.data.message,iconSlot:response.data.iconSlot};
    } catch { return failure(saving); }
  }
  return {load:()=>request(false), save:(text,slot=null)=>{ const normalized = typeof text === 'string' ? normalizeHomeMessage(text) : text;
    return request(true,normalized,normalized === '' ? null : slot);
  }, invalidate(){ generation++; }};
}
