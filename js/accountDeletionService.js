import { canonicalEno } from "../supabase/functions/_shared/internal-email.mjs";
import { isOnlineUuid } from "./onlinePlayerDto.js";

export const deletionMessages = {
  denied: "削除対象を安全に確認できません。複数ENo・共有アクセス・ログイン状態を確認し、ページを読み込み直してください。",
  changed: "ログイン状態または削除対象が変わったため、操作を中断しました。ページを読み込み直してください。",
  failed: "削除できませんでした。データは削除成功として扱われていません。時間をおいて確認してください。",
  unknown: "通信が途切れたため、削除結果を確認できません。自動で再送しません。ページを読み込み直してログイン状態を確認してください。",
  unavailable: "削除機能を準備できませんでした。通信状況とサーバーの準備を確認してください。",
  cleanup: "アカウントの削除は完了しましたが、この端末のログアウト処理が完了していません。『ログアウトを完了』を押してください。",
};
const fail = status => ({ ok: false, status, message: deletionMessages[status] });
export function createAccountDeletionService(client) {
  async function user() {
    const { data, error } = await client.auth.getSession();
    if (error) throw Error("Session unavailable");
    return data?.session?.user?.id ?? null;
  }
  const same = async id => await user() === id;
  return {
    async prepare(expected) {
      try {
        const authUserId = await user();
        if (!authUserId || !expected || canonicalEno(expected.eno) !== expected.eno || !expected.name?.trim()) return fail("denied");
        const { data, error } = await client.rpc("prepare_account_deletion", { p_eno: expected.eno });
        if (!await same(authUserId)) return fail("changed");
        if (error) return fail(["42501", "22023"].includes(error.code) ? "denied" : "unavailable");
        if (!data || !isOnlineUuid(data.gameAccountId) || data.authUserId !== authUserId
          || data.eno !== expected.eno || data.name !== expected.name) return fail("changed");
        return { ok: true, target: { gameAccountId: data.gameAccountId, authUserId, eno: data.eno, name: data.name } };
      } catch { return fail("unavailable"); }
    },
    async remove(target) {
      let sent = false;
      try {
        if (!target || !isOnlineUuid(target.gameAccountId) || !isOnlineUuid(target.authUserId)
          || canonicalEno(target.eno) !== target.eno || typeof target.name !== "string" || !await same(target.authUserId)) return fail("changed");
        sent = true;
        const { data, error } = await client.rpc("delete_own_account", {
          p_game_account_id: target.gameAccountId, p_auth_user_id: target.authUserId,
          p_eno: target.eno, p_name: target.name,
        });
        // Server success is accepted only for this exact transaction target. A
        // different logged-in user must never be signed out by a delayed result.
        const current = await user();
        if (current && current !== target.authUserId) return fail("changed");
        if (error) return fail(["42501", "22023"].includes(error.code) ? "changed"
          : /^(23|40|P0)/.test(error.code ?? "") ? "failed" : "unknown");
        if (data?.deleted !== true || data.gameAccountId !== target.gameAccountId
          || data.authUserId !== target.authUserId || data.eno !== target.eno) return fail("unknown");
        return { ok: true };
      } catch { return fail(sent ? "unknown" : "changed"); }
    },
    async cleanup(target) {
      try {
        const current = await user();
        if (current && current !== target.authUserId) return fail("changed");
        if (current) {
          const { error } = await client.auth.signOut({ scope: "local" });
          if (error) return fail("cleanup");
        }
        if (await user()) return fail("changed");
        return { ok: true };
      } catch { return fail("cleanup"); }
    },
  };
}
