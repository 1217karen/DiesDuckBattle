import { onlineFailure } from "./onlinePlayerStorage.js";

const copy = value => structuredClone(value);
const sameScope = (a, b) => a?.authUserId === b?.authUserId && a?.account?.id === b?.account?.id && a?.account?.eno === b?.account?.eno;
const scopeErrors = new Set(["not-signed-in", "no-access", "selection-required", "forbidden", "session-changed"]);

/** A full DTO stays in memory only. Page-specific edits never replace the other page's fields. */
export function createOnlineEditController({ storage, sections, allowDuckPresentationDeletion = false, confirm = () => false, notify = () => {} }) {
  let generation = 0;
  // Keep deletion intent across repeated conflicts without owning the entire presentation.
  const deletedDuckPresentationIds = new Set();
  const listeners = new Set();
  let state = { base: null, draft: null, latest: null, dirty: false, busy: "", blocked: true,
    message: "オンライン設定を読み込んでいます…", status: "loading", dataVersion: 0 };
  const snapshot = () => copy({ ...state, deletedDuckPresentationIds: [...deletedDuckPresentationIds], canEdit: !!state.draft && !state.busy && !state.blocked,
    canSave: !!state.draft && !state.busy && !state.blocked && !state.latest });
  const emit = () => listeners.forEach(listener => listener(snapshot()));
  const fail = result => {
    state.status = result.status; state.message = result.message; state.blocked = true; state.latest = null;
  };
  function invalidate(message = "ログイン先が変わりました。旧アカウントの未保存変更は破棄されました。読み込み直してください。") {
    generation++;
    deletedDuckPresentationIds.clear();
    state = { base: null, draft: null, latest: null, dirty: false, busy: "", blocked: true,
      status: "session-changed", message, dataVersion: state.dataVersion + 1 };
    emit();
  }
  function install(result, draft = result.data, dirty = false) {
    if (!dirty) deletedDuckPresentationIds.clear();
    state.base = copy(result); state.draft = copy(draft); state.latest = null;
    state.dirty = dirty; state.blocked = false; state.status = "ready";
    state.message = dirty ? "最新データを基準に編集を引き継ぎました。内容を確認してから保存してください。" : "オンライン設定を読み込みました。";
    state.dataVersion++;
  }
  async function run(kind, work) {
    if (state.busy) return { ok: false, status: "busy" };
    const ticket = generation; state.busy = kind; emit();
    try { return await work(() => ticket === generation); }
    finally { if (ticket === generation) { state.busy = ""; emit(); } }
  }
  async function safe(work, saving = false) {
    try { return await work(); } catch { return onlineFailure(saving ? "save-unknown" : "load-failed"); }
  }
  async function ask(message) {
    if (state.busy) return false;
    const ticket = generation; state.busy = "confirm"; emit();
    try { return !!await confirm(message) && ticket === generation; }
    catch { return false; }
    finally { if (ticket === generation) { state.busy = ""; emit(); } }
  }
  function scopeFailure(result) {
    if (scopeErrors.has(result.status)) invalidate(result.message + (state.draft ? " 旧アカウントの編集内容を非表示にし、未保存変更を破棄しました。" : ""));
    else fail(result);
  }
  const api = {
    snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    invalidate,
    sessionChanged(userId) {
      if (state.base && userId !== state.base.authUserId) invalidate();
      // In-flight initial loads have no base yet; invalidate those too on sign-out/user change.
      else if (!state.base && state.busy) invalidate("ログイン状態が変わりました。読み込み直してください。");
    },
    edit(patch, { deleteDuckPresentationIds = [] } = {}) {
      if (!snapshot().canEdit) return false;
      if (Object.keys(patch).some(key => !sections.includes(key))) return false;
      if (!Array.isArray(deleteDuckPresentationIds)) return false;
      if (deleteDuckPresentationIds.length && (!allowDuckPresentationDeletion || !sections.includes("build")
        || !Array.isArray(patch.build?.ducks) || deleteDuckPresentationIds.some(id => typeof id !== "string"
          || !state.draft.build.ducks.some(d => d.id === id) || patch.build.ducks.some(d => d.id === id)))) return false;
      const draft = { ...state.draft, ...copy(patch) };
      if (deleteDuckPresentationIds.length) {
        draft.presentation = copy(state.draft.presentation);
        for (const id of deleteDuckPresentationIds) {
          delete draft.presentation.ducks[id];
          deletedDuckPresentationIds.add(id);
        }
      }
      state.draft = draft; state.dirty = true; emit(); return true;
    },
    async load() {
      if (state.busy) return { ok: false, status: "busy" };
      if (state.dirty && !await ask("未保存変更を破棄して、サーバーから読み込み直しますか？")) return { ok: false, status: "cancelled" };
      return run("load", async current => {
        const result = await safe(() => storage.load());
        if (!current()) return { ok: false, status: "stale" };
        if (result.ok) {
          install(result);
        } else scopeFailure(result);
        return result;
      });
    },
    async checkScope() {
      if (state.busy || !state.base) return;
      return run("scope", async current => {
        const result = await safe(() => storage.resolveAccount());
        if (!current()) return;
        if (!result.ok) scopeFailure(result);
        else if (!sameScope(state.base, result)) invalidate();
        // Only a successful explicit reload/compare resolves a previous failure.
        return result;
      });
    },
    async save() {
      if (!snapshot().canSave) return { ok: false, status: "blocked" };
      return run("save", async current => {
        const result = await safe(() => storage.save(copy(state.base), copy(state.draft)), true);
        if (!current()) return { ok: false, status: "stale" };
        if (!result.ok) { scopeFailure(result); return result; }
        if (!sameScope(state.base, result)) { invalidate(); return onlineFailure("session-changed"); }
        state.base = copy(result); state.draft = copy(result.data); state.dirty = false;
        deletedDuckPresentationIds.clear();
        state.status = "ready"; state.message = "";
        try { notify({ kind: "success", message: "保存しました。" }); } catch { /* Notification is not part of the save. */ }
        return result;
      });
    },
    async compare() {
      if (!state.base) return api.load();
      return run("compare", async current => {
        const result = await safe(() => storage.load());
        if (!current()) return { ok: false, status: "stale" };
        if (!result.ok) { scopeFailure(result); return result; }
        if (!sameScope(state.base, result)) { invalidate(); return onlineFailure("session-changed"); }
        state.latest = copy(result); state.blocked = true;
        state.message = "ドラフトと最新データを比較してください。採用するまで保存しません。";
        return result;
      });
    },
    async adoptLatest(keepEdits = false) {
      if (!state.latest || state.busy) return false;
      const question = keepEdits
        ? "最新データへ、この画面の編集項目を引き継ぎます。同じ項目にある他の編集は置き換わります。" +
          (deletedDuckPresentationIds.size ? "表示設定は最新を保持し、削除したDuckの表示設定・プロフィール情報だけを削除します。" : "") +
          "比較内容を確認しましたか？（まだ保存しません）"
        : "未保存変更を破棄して、確認したサーバーの最新データを開きますか？";
      if (!await ask(question)) return false;
      const result = state.latest, draft = copy(result.data);
      if (keepEdits) for (const key of sections) draft[key] = copy(state.draft[key]);
      if (keepEdits) for (const id of deletedDuckPresentationIds) delete draft.presentation.ducks[id];
      install(result, draft, keepEdits); emit(); return true;
    },
    async canLeave() {
      if (state.busy) { state.message = "オンライン処理中です。完了してからログアウトしてください。"; emit(); return false; }
      return !state.dirty || await ask("未保存変更を破棄してログアウトしますか？");
    },
  };
  return api;
}
