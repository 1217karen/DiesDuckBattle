// A page service keeps this fixed context for its lifetime. It never resolves a
// different account's client halfway through a request.
const reads = new Set(["load_online_player", "get_online_random_win_streak", "list_online_opponents",
  "get_online_opponent", "prepare_online_battle", "list_skill_vault", "prepare_account_deletion",
  "get_index_messages", "get_online_profile", "list_online_characters", "get_online_battle_result",
  "list_online_battle_results", "list_feedback_threads", "list_feedback_replies"]);
const writes = new Set(["save_online_player", "save_online_battle_result", "set_online_battle_favorite",
  "store_skill_vault", "delete_skill_vault", "set_index_message", "create_feedback_thread",
  "create_feedback_reply", "toggle_feedback_reaction", "withdraw_feedback_thread"]);
const ownedId = new Set(["load_online_player", "save_online_player", "get_online_random_win_streak",
  "prepare_online_battle", "list_skill_vault", "store_skill_vault", "delete_skill_vault", "set_online_battle_favorite"]);
const ownedEno = new Set(["get_index_messages", "set_index_message", "prepare_account_deletion",
  "create_feedback_thread", "create_feedback_reply", "toggle_feedback_reaction", "withdraw_feedback_thread"]);
const error = code => ({ data: null, error: { code, message: "アカウントの状態を確認できません。再読み込みしてください。" } });
export function createAccountScopedClient({ context, runtime, coordinator }) {
  const { client, account } = context;
  const selectionVersion = runtime.getSelectionVersion();
  const valid = () => {
    const now = runtime.getCurrent();
    return runtime.getSelectionVersion() === selectionVersion && now?.isCurrent()
      && now.client === client && now.account.eno === account.eno
      && now.account.gameAccountId === account.gameAccountId && now.account.authUserId === account.authUserId;
  };
  const recovering = () => {
    const state = runtime.snapshot();
    return runtime.getSelectionVersion() === selectionVersion && (state.phase === "suspended"
      || ["restore", "initialize"].includes(state.busy)
      || (state.phase === "unverified" && ["restore", "initialize"].includes(state.lastAction) && ["verification-unavailable", "stale-operation"].includes(state.code)));
  };
  const auth = {
    async getSession() {
      if (!valid()) return error(recovering() ? "auth-verifying" : "PGRST301");
      const lease = runtime.getCurrent();
      const result = await client.auth.getSession();
      return lease.isCurrent() && valid() && result.data?.session?.user?.id === account.authUserId ? result
        : error(recovering() || (valid() && !lease.isCurrent()) ? "auth-verifying" : "PGRST301");
    },
    onAuthStateChange(callback) {
      let ended = false;
      const subscription = client.auth.onAuthStateChange((event, session) => {
        if (!ended && !recovering()) callback(valid() ? event : "SIGNED_OUT", valid() ? session : null);
      }).data.subscription;
      const stop = runtime.subscribe(state => {
        if (!ended && !state.busy && !recovering() && !valid()) { ended = true; queueMicrotask(() => callback("SIGNED_OUT", null)); }
      });
      return { data: { subscription: { unsubscribe() { ended = true; stop(); subscription.unsubscribe(); } } } };
    },
  };
  return Object.freeze({
    accountContext: Object.freeze({ account, isCurrent: valid, isRecovering: recovering }), auth,
    beforeAccountChange: guard => coordinator.beforeAccountChange(guard),
    // Only the access projection is exposed. Mutation/table APIs are deliberately absent.
    from(table) {
      if (table !== "game_account_access") throw Error("Unsupported account query");
      return { select: columns => ({ async eq(field, id) {
        if (!valid() || field !== "auth_user_id" || id !== account.authUserId) return error("42501");
        const lease = runtime.getCurrent();
        const result = await client.from(table).select(columns).eq(field, id);
        if (!lease.isCurrent() || !valid()) return error("PGRST301");
        return result.error ? result : { ...result, data: result.data?.filter(row => row.game_account_id === account.gameAccountId) };
      } }) };
    },
    async rpc(name, params = {}) {
      if (!valid()) return error("PGRST301");
      if (!reads.has(name) && !writes.has(name)) return error("42501");
      if ((ownedId.has(name) && params.p_game_account_id !== account.gameAccountId)
        || (ownedEno.has(name) && params.p_eno !== account.eno)
        || (name === "save_online_battle_result" && params.p_p1_account_id !== account.gameAccountId)
        || (name === "list_online_battle_results" && params.p_game_account_id != null && params.p_game_account_id !== account.gameAccountId)
        || (name === "list_feedback_threads" && params.p_eno != null && params.p_eno !== account.eno)) return error("42501");
      const result = await coordinator[writes.has(name) ? "write" : "read"](async captured => {
        if (!valid() || captured.client !== client || captured.account.gameAccountId !== account.gameAccountId) throw Error("stale");
        return client.rpc(name, params);
      });
      return result.ok && valid() ? result.value : error(result.code === "write-unknown" ? "write-unknown" : "PGRST301");
    },
  });
}
