// State never contains a password, Auth email, token, or full SDK error.
export function createAuthController(service, render, notifySuccess = () => {}) {
  let revision = 0, stopped = false, unsubscribe = () => {};
  const listeners = new Set([render]);
  const state = { ready: false, sessionKnown: false, busy: "", signedIn: false, enos: [], accounts: [], sessionMessage: "ログイン状態を確認中…",
    message: "", messageSource: "", registeredEno: "" };
  const snapshot = () => ({ ...state, enos: [...state.enos], accounts: state.accounts.map(a => ({ ...a })) });
  const emit = () => { if (!stopped) listeners.forEach(listener => listener(snapshot())); };
  async function applySession(session) {
    const version = ++revision;
    state.signedIn = !!session;
    state.sessionKnown = true;
    state.enos = [];
    state.accounts = [];
    state.sessionMessage = session ? "アクセスできるENoを確認中…" : "ログインしていません。";
    emit();
    try {
      if (session) {
        const accounts = await service.accounts(session);
        if (version !== revision || stopped) return;
        const enos = accounts.map(account => account.eno);
        state.accounts = accounts;
        state.enos = enos;
        state.sessionMessage = enos.length === 0 ? "アクセスできるゲームアカウントがありません。管理者に状況を確認してください。"
          : enos.length === 1 ? "ログイン中" : "複数のENoへアクセスできます。アカウント切り替えは今後実装します。";
      }
    } catch {
      if (version !== revision || stopped) return;
      state.sessionMessage = "ENoを取得できませんでした。通信状況を確認して再読み込みしてください。";
    }
    if (version === revision) { state.ready = true; emit(); }
  }
  async function action(kind, work) {
    if (!state.ready || state.busy || stopped) return;
    state.busy = kind; state.message = ""; state.messageSource = kind; emit();
    try { return await work(); }
    catch { state.message = "処理を完了できませんでした。通信状況を確認してください。"; }
    finally { state.busy = ""; emit(); }
  }
  return {
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    async start() {
      unsubscribe = service.watch(session => { void applySession(session); });
      const version = revision;
      try {
        const session = await service.session();
        if (version === revision && !stopped) await applySession(session);
      } catch {
        if (version === revision) {
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
        await applySession(result.session);
        try { notifySuccess("ログインしました。"); } catch { /* Notifications cannot change auth outcome. */ }
      }
      else state.message = result.message;
      return { ok: result.ok };
    }),
    logout: () => action("logout", async () => {
      try { await service.logout(); await applySession(null); try { notifySuccess("ログアウトしました。"); } catch { /* Keep logout successful. */ } }
      catch { state.message = "ログアウトできませんでした。通信状況を確認してもう一度お試しください。"; }
    }),
    stop() { stopped = true; revision++; unsubscribe(); },
  };
}
