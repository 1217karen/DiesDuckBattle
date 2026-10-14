const copy = value => structuredClone(value);
const scopeKey = scope => scope ? `${scope.authUserId}/${scope.gameAccountId}` : "";
export function createSkillVaultController({ storage, onChange = () => {}, idFactory = () => crypto.randomUUID() }) {
  let scope = null, generation = 0;
  let state = { entries: [], busy: false, ready: false, uncertain: null, message: "" };
  const snapshot = () => copy(state);
  const emit = () => onChange(snapshot());
  function setScope(next) {
    if (scopeKey(next) === scopeKey(scope)) return;
    generation++; scope = copy(next);
    state = { entries: [], busy: false, ready: false, uncertain: null, message: "" }; emit();
    if (scope) void refresh();
  }
  async function run(operation, pending = null) {
    if (!scope || state.busy) return false;
    const ticket = generation, target = copy(scope);
    state.busy = true; emit();
    let result;
    try { result = await operation(target); }
    catch { result = { ok: false, status: pending ? "unknown" : "failed" }; }
    if (ticket !== generation) return false;
    state.busy = false;
    if (result.ok) {
      state.entries = copy(result.entries); state.ready = true;
      const unknown = state.uncertain;
      const reconciled = unknown && (unknown.kind === "store"
        ? state.entries.some(e => e.id === unknown.entry.id) : !state.entries.some(e => e.id === unknown.id));
      if (pending || reconciled) state.uncertain = null;
      state.message = pending ? pending.kind === "store" ? "スキルを保管しました。" : "スキルを削除しました。"
        : reconciled ? "サーバーで操作の完了を確認しました。" : state.uncertain
          ? "操作の完了を確認できません。同じ操作を再確認して実行できます。" : "";
    } else {
      if (pending && result.status === "unknown") state.uncertain = copy(pending);
      if (result.status === "session-changed") {
        generation++; scope = null; state.entries = []; state.ready = false; state.uncertain = null;
        state.message = "ログイン状態または対象ENoが変わりました。設定画面を読み込み直してください。";
      } else state.message = state.uncertain
        ? "通信が途切れたため操作の成否が不明です。『一覧を再取得』でサーバーの状態を確認してください。"
        : "スキル保管庫の通信に失敗しました。通信状況とDBの準備を確認し、一覧を再取得してください。";
    }
    emit(); return result.ok;
  }
  function refresh() { return run(target => storage.list(target)); }
  function perform(pending) {
    return run(target => pending.kind === "store" ? storage.store(target, pending.entry) : storage.remove(target, pending.id), pending);
  }
  return { snapshot, setScope, refresh,
    store(entry) {
      if (!state.ready || state.uncertain) return false;
      return perform({ kind: "store", entry: { ...copy(entry), id: idFactory() } });
    },
    remove(id) {
      if (!state.ready || state.uncertain || !state.entries.some(e => e.id === id)) return false;
      return perform({ kind: "delete", id });
    },
    retry() { return state.uncertain ? perform(copy(state.uncertain)) : false; },
  };
}
