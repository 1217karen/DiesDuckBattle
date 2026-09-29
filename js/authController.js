// State never contains a password, Auth email, token, or full SDK error.
export function createAuthController(service, render) {
  let revision = 0, stopped = false, unsubscribe = () => {};
  const state = { ready: false, busy: "", signedIn: false, enos: [], sessionMessage: "ログイン状態を確認中…",
    message: "", registeredEno: "" };
  const emit = () => { if (!stopped) render({ ...state, enos: [...state.enos] }); };
  async function applySession(session) {
    const version = ++revision;
    state.signedIn = !!session;
    state.enos = [];
    state.sessionMessage = session ? "アクセスできるENoを確認中…" : "ログインしていません。";
    emit();
    try {
      if (session) {
        const enos = await service.accounts(session);
        if (version !== revision || stopped) return;
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
    state.busy = kind; state.message = ""; emit();
    try { await work(); }
    catch { state.message = "処理を完了できませんでした。通信状況を確認してください。"; }
    finally { state.busy = ""; emit(); }
  }
  return {
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
      if (result.ok) { await applySession(result.session); state.message = "ログインしました。"; }
      else state.message = result.message;
    }),
    logout: () => action("logout", async () => {
      try { await service.logout(); await applySession(null); state.message = "ログアウトしました。"; }
      catch { state.message = "ログアウトできませんでした。通信状況を確認してもう一度お試しください。"; }
    }),
    stop() { stopped = true; revision++; unsubscribe(); },
  };
}
