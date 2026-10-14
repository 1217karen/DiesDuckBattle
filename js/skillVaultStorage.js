import { isOnlineUuid } from "./onlinePlayerDto.js";

// Every operation names both the user and the account. DB RPCs recheck access.
export function createSkillVaultStorage(client) {
  async function check(scope) {
    const { data, error } = await client.auth.getSession();
    if (error || !scope?.authUserId || !isOnlineUuid(scope.gameAccountId)
      || data?.session?.user?.id !== scope.authUserId) throw new Error("session-changed");
  }
  async function call(scope, name, args, write = false) {
    let sent = false;
    try {
      await check(scope);
      sent = true;
      const { data, error } = await client.rpc(name, { p_game_account_id: scope.gameAccountId, ...args });
      await check(scope);
      if (error) return { ok: false, status: ["42501", "PGRST301"].includes(error.code) ? "session-changed"
        : ["22023", "23514", "23505", "PGRST202", "42883"].includes(error.code) ? "rejected" : write ? "unknown" : "failed" };
      if (!Array.isArray(data)) return { ok: false, status: write ? "unknown" : "failed" };
      // Retired selection data is retained verbatim. Current rules are checked on load.
      if (data.some(row => !isOnlineUuid(row.id) || row.gameAccountId !== scope.gameAccountId
        || !["A", "B", "C", "D"].includes(row.type) || typeof row.name !== "string"
        || typeof row.ruby !== "string" || typeof row.displayName !== "string" || !row.selection))
        return { ok: false, status: write ? "unknown" : "failed" };
      return { ok: true, entries: structuredClone(data) };
    } catch (error) {
      return { ok: false, status: error.message === "session-changed" ? "session-changed" : sent && write ? "unknown" : "failed" };
    }
  }
  return {
    list: scope => call(scope, "list_skill_vault", {}),
    store: (scope, entry) => call(scope, "store_skill_vault", { p_id: entry.id, p_type: entry.type,
      p_selection: entry.selection, p_name: entry.name, p_ruby: entry.ruby }, true),
    remove: (scope, id) => call(scope, "delete_skill_vault", { p_id: id }, true),
  };
}
