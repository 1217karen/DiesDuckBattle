import { createOnlinePlayerStorage, onlineFailure } from './onlinePlayerStorage.js';
import { isOnlineUuid } from './onlinePlayerDto.js';
import { canonicalEno } from '../supabase/functions/_shared/internal-email.mjs';
import { isThemeColor, THEME_KEYS } from './profileThemeController.js';

export const introductionIsBlank = body => body.replace(/<\/?(?:b|i|u|rb|rt|small|big)>/gi, '').trim() === '';
export const introductionImageUrlValid = url => url === '' || url.length <= 2048 && /^https?:\/\/\S+$/i.test(url);
const slotValid = slot => slot === null || Number.isInteger(slot) && slot >= 1 && slot <= 10;
const revisionValid = n => typeof n === 'string' && /^[1-9][0-9]*$/.test(n) && BigInt(n) <= 9223372036854775807n;
export function decodeIntroductions(data) {
  if (!Array.isArray(data)) throw Error('Invalid introductions');
  for (const row of data) {
    if (!isOnlineUuid(row.id) || typeof row.body !== 'string' || [...row.body].length > 500
      || introductionIsBlank(row.body) || !slotValid(row.iconSlot) || typeof row.imageUrl !== 'string'
      || !introductionImageUrlValid(row.imageUrl) || !revisionValid(row.revision)
      || !Number.isFinite(Date.parse(row.createdAt)) || !Number.isFinite(Date.parse(row.updatedAt))
      || !isOnlineUuid(row.author?.accountId) || typeof row.author.name !== 'string'
      || typeof row.author.iconUrl !== 'string' || typeof row.author.defaultIconUrl !== 'string'
      || !THEME_KEYS.every(k => isThemeColor(row.author.theme?.[k]))) throw Error('Invalid introduction');
    canonicalEno(row.author.eno);
  }
  return structuredClone(data);
}
const failure = (error, write = false) => onlineFailure(
  ['PGRST202', '42883'].includes(error?.code) ? 'migration-required' :
  error?.code === '42501' ? 'forbidden' : error?.code === '40001' ? 'conflict' :
  ['22023', '23514', '23503', '22P02'].includes(error?.code) ? 'invalid-data' : write ? 'save-unknown' : 'load-failed');

export function createProfileIntroductionService(client, storage = createOnlinePlayerStorage(client)) {
  const current = async identity => {
    const s = await client.auth.getSession();
    return !s.error && (s.data?.session?.user?.id ?? null) === identity;
  };
  return {
    resolveWriter: () => storage.resolveAccount(),
    loadWriter: accountId => storage.load({ gameAccountId: accountId }),
    async list(targetId) {
      try {
        const before = await client.auth.getSession();
        if (before.error || !isOnlineUuid(targetId)) return onlineFailure('load-failed');
        const result = await client.rpc('list_profile_introductions', { p_target_account_id: targetId });
        if (!await current(before.data?.session?.user?.id ?? null)) return onlineFailure('session-changed');
        if (result.error) return failure(result.error);
        return { ok: true, records: decodeIntroductions(result.data) };
      } catch { return onlineFailure('load-failed'); }
    },
    async save(writer, targetId, original, draft) {
      let submitted = false;
      try {
        if (!isOnlineUuid(targetId) || typeof draft.body !== 'string' || [...draft.body].length > 500) return onlineFailure('invalid-data');
        const blank = introductionIsBlank(draft.body);
        if (blank && !original || !blank && (!slotValid(draft.iconSlot) || !introductionImageUrlValid(draft.imageUrl))) return onlineFailure('invalid-data');
        const scope = await storage.resolveAccount();
        if (!scope.ok) return scope;
        if (scope.account.id !== writer.account.id || scope.authUserId !== writer.authUserId
          || !await current(writer.authUserId)) return onlineFailure('session-changed');
        if (scope.account.id === targetId) return onlineFailure('forbidden');
        submitted = true;
        const result = await client.rpc('save_profile_introduction', { p_author_account_id: scope.account.id,
          p_target_account_id: targetId, p_expected_id: original?.id ?? null, p_expected_revision: original?.revision ?? null,
          p_body: draft.body, p_icon_slot: blank ? null : draft.iconSlot, p_image_url: blank ? '' : draft.imageUrl.trim() });
        if (!await current(writer.authUserId)) return onlineFailure('session-changed');
        if (result.error) return failure(result.error, true);
        if (!isOnlineUuid(result.data?.id) || !revisionValid(result.data?.revision) || result.data.deleted !== blank) return onlineFailure('save-unknown');
        return { ok: true, deleted: blank };
      } catch { return onlineFailure(submitted ? 'save-unknown' : 'load-failed'); }
    },
  };
}
