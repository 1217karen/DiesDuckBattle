import { displayCache } from "./authDisplayCache.js";
import { menuModel } from "./commonMenuModel.js";

// State never contains a password, Auth email, token, or full SDK error.
export function createAuthController(service, render, notifySuccess = () => {}) {
  let revision = 0, stopped = false, unsubscribe = () => {};
  let currentUser = null, accountsPending = null, accountsKnown = false, authEvents = 0;
  const listeners = new Set([render]);
  const logoutGuards = new Set();
  const state = { ready: false, sessionKnown: false, busy: "", signedIn: false, accountsResolved: false, enos: [], accounts: [], sessionMessage: "",
    message: "", messageSource: "", registeredEno: "", logoutSucceeded: false };
  const snapshot = () => ({ ...state, enos: [...state.enos], accounts: state.accounts.map(a => ({ ...a })) });
  const emit = () => { if (!stopped) listeners.forEach(listener => listener(snapshot())); };
  async function applySession(session, event = "") {
    if (stopped) return;
    const user = session?.user?.id ?? null;
    const sameUser = !!user && state.signedIn && user === currentUser;
    // SDK owns the session/token; only the user ID is compared in runtime memory.
    if (sameUser && (accountsPending || (accountsKnown && ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "RESTORE", "LOGIN"].includes(event)))) {
      return accountsPending;
    }
    const version = ++revision;
    currentUser = user;
    if (!sameUser) { accountsKnown = false; state.accountsResolved = false; state.enos = []; state.accounts = []; }
    state.ready = sameUser && accountsKnown;
    if (!session) displayCache.clear();
    state.signedIn = !!session;
    if (session) state.logoutSucceeded = false;
    state.sessionKnown = true;
    if (!sameUser) state.sessionMessage = session ? "" : "ログインしていません。";
    emit();
    const fetchAccounts = async () => {
      try {
        if (session) {
          const accounts = await service.accounts(session);
          if (version !== revision || stopped) return;
          const enos = accounts.map(account => account.eno);
          accountsKnown = true;
          state.accountsResolved = true;
          state.accounts = accounts;
          state.enos = enos;
          state.sessionMessage = enos.length === 0 ? "アクセスできるゲームアカウントがありません。管理者に状況を確認してください。"
            : enos.length === 1 ? "ログイン中" : "複数のENoへアクセスできます。アカウント切り替えは今後実装します。";
        }
      } catch {
        if (version !== revision || stopped) return;
        state.sessionMessage = "ENoを取得できませんでした。通信状況を確認して再読み込みしてください。";
      }
      if (version === revision) {
        state.ready = true;
        if (session && accountsKnown) displayCache.write(menuModel(state));
        emit();
      }
    };
    const pending = fetchAccounts();
    accountsPending = pending;
    try { await pending; } finally { if (accountsPending === pending) accountsPending = null; }
  }
  async function action(kind, work) {
    if (!state.ready || state.busy || stopped) return;
    state.busy = kind; state.message = ""; state.messageSource = kind;
    if (kind === "logout") state.logoutSucceeded = false;
    emit();
    try { return await work(); }
    catch { state.message = "処理を完了できませんでした。通信状況を確認してください。"; }
    finally { state.busy = ""; emit(); }
  }
  return {
    beforeLogout(guard) { logoutGuards.add(guard); return () => logoutGuards.delete(guard); },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    async start() {
      const version = authEvents;
      unsubscribe = service.watch((session, event) => { authEvents++; void applySession(session, event); });
      try {
        const session = await service.session();
        if (version === authEvents && !stopped) await applySession(session, "RESTORE");
        else await accountsPending;
      } catch {
        if (version === authEvents && !stopped) {
          state.ready = true; state.sessionMessage = "ログイン状態を確認できませんでした。再読み込みしてください。"; emit();
        }
      }
    },
    register: input => action("register", async () => {
      const result = await service.register(input);
      if (result.ok) { state.registeredEno = result.eno; state.message = "登録が完了しました。ENoを控えてください。"; }
      else state.message = result.message;
    }),
    login: (eno, password) => action("login", async () => {
      const result = await service.login(eno, password);
      if (result.ok) {
        state.registeredEno = "";
        await applySession(result.session, "LOGIN");
        try { notifySuccess("ログインしました。"); } catch { /* Notifications cannot change auth outcome. */ }
      }
      else state.message = result.message;
      return { ok: result.ok };
    }),
    logout: () => action("logout", async () => {
      for (const guard of logoutGuards) if (!await guard()) return;
      try { await service.logout(); state.logoutSucceeded = true; await applySession(null); }
      catch { state.message = "ログアウトできませんでした。通信状況を確認してもう一度お試しください。"; }
    }),
    stop() { stopped = true; revision++; unsubscribe(); },
  };
}
