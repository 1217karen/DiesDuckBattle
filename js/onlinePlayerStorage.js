import { encodeOnlinePlayer, decodeOnlinePlayer, isOnlineUuid } from "./onlinePlayerDto.js";
import { canonicalEno } from "../supabase/functions/_shared/internal-email.mjs";

const messages = Object.freeze({
  "not-signed-in": "ログインしてください。", "no-access": "アクセスできるアカウントがありません。",
  "selection-required": "複数のENoがあります。保存対象を明示的に選択してください。",
  forbidden: "このアカウントにはアクセスできません。", "session-changed": "ログイン状態が変わりました。読み込み直してください。",
  conflict: "他の画面で更新されています。編集中の内容を保ち、サーバーの最新データを確認してください。",
  "invalid-data": "保存データの形式を確認してください。", "unsupported-data": "サーバーデータを読み取れません。上書きせず確認してください。",
  "migration-required": "オンライン保存のDB準備が完了していません。",
  "load-failed": "読み込みに失敗しました。通信状況を確認してください。",
  "save-failed": "保存に失敗しました。編集中の内容を保って確認してください。",
  "save-unknown": "保存結果を確認できません。保存済みの可能性があるため、再送せず最新データを読み込んで確認してください。",
});
export const onlineFailure = status => ({ ok: false, status, message: messages[status] });
const validRevision = value => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 9223372036854775807n;
function errorStatus(error, saving) {
  if (["PGRST202", "42883", "42703"].includes(error?.code)) return "migration-required";
  if (["40001", "40P01"].includes(error?.code)) return "conflict";
  if (error?.code === "42501") return "forbidden";
  if (["22023", "22P02", "23505", "23503", "23514"].includes(error?.code)) return "invalid-data";
  // Unknown transport errors may represent an already committed write. Never retry.
  return saving ? "save-unknown" : "load-failed";
}

/** Inject the existing publishable-key, signed-in Supabase client. No local storage or admin credentials. */
export function createOnlinePlayerStorage(client) {
  async function access(gameAccountId) {
    const { data, error } = await client.auth.getSession();
    if (error) return onlineFailure("load-failed");
    const userId = data?.session?.user?.id;
    if (!userId) return onlineFailure("not-signed-in");
    const rows = await client.from("game_account_access").select("game_account_id,game_accounts!inner(eno::text)").eq("auth_user_id", userId);
    if (rows.error || !Array.isArray(rows.data)) return onlineFailure("load-failed");
    const accounts = rows.data.map(row => ({ id: row.game_account_id, eno: canonicalEno(row.game_accounts.eno) }));
    if (!accounts.length) return onlineFailure("no-access");
    if (gameAccountId === undefined && accounts.length > 1) return { ...onlineFailure("selection-required"), accounts };
    const account = gameAccountId === undefined ? accounts[0] : accounts.find(a => a.id === gameAccountId);
    if (!account || !isOnlineUuid(account.id)) return onlineFailure("forbidden");
    return { ok: true, account, authUserId: userId };
  }
  async function unchanged(userId) {
    const { data, error } = await client.auth.getSession();
    return !error && data?.session?.user?.id === userId;
  }
  return {
    async load({ gameAccountId } = {}) {
      try {
        const scope = await access(gameAccountId); if (!scope.ok) return scope;
        const { data, error } = await client.rpc("load_online_player", { p_game_account_id: scope.account.id });
        if (error) return onlineFailure(errorStatus(error, false));
        if (!await unchanged(scope.authUserId)) return onlineFailure("session-changed");
        if (!data) return onlineFailure("forbidden");
        if (data.gameAccountId !== scope.account.id || data.eno !== scope.account.eno || !validRevision(data.revision)) return onlineFailure("unsupported-data");
        try { return { ...scope, status: "loaded", revision: data.revision, data: decodeOnlinePlayer(data) }; }
        catch { return onlineFailure("unsupported-data"); }
      } catch { return onlineFailure("load-failed"); }
    },
    async save(base, data, { gameAccountId } = {}) {
      let payload;
      try { payload = encodeOnlinePlayer(data); } catch { return onlineFailure("invalid-data"); }
      if (!base?.ok || !validRevision(base.revision)) return onlineFailure("invalid-data");
      let saving = false;
      try {
        const scope = await access(gameAccountId); if (!scope.ok) return scope;
        if (scope.authUserId !== base.authUserId || scope.account.id !== base.account?.id) return onlineFailure("session-changed");
        saving = true;
        const result = await client.rpc("save_online_player", { p_game_account_id: scope.account.id,
          p_expected_revision: base.revision, p_payload: payload });
        if (result.error) return onlineFailure(errorStatus(result.error, true));
        if (!await unchanged(scope.authUserId)) return onlineFailure("session-changed");
        if (!validRevision(result.data?.revision)) return onlineFailure("save-unknown");
        return { ...scope, status: "saved", revision: result.data.revision, data: decodeOnlinePlayer(payload) };
      } catch { return onlineFailure(saving ? "save-unknown" : "load-failed"); }
    },
  };
}
