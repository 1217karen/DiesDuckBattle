import { getSupabaseClient, getAuthRuntime } from "./authRuntime.js";
import { createOnlinePlayerStorage } from "./onlinePlayerStorage.js";
import { createOnlineEditController } from "./onlineEditController.js";
import { showToast } from "./toast.js";

function confirmEdit(message) {
  return new Promise(resolve => {
    const previous = document.activeElement, dialog = document.createElement("dialog");
    dialog.className = "online-confirm"; dialog.setAttribute("aria-labelledby", "online-confirm-title");
    const title = document.createElement("h2"); title.id = "online-confirm-title"; title.textContent = "編集内容の確認";
    const text = document.createElement("p"); text.textContent = message;
    const cancel = document.createElement("button"), accept = document.createElement("button");
    cancel.type = accept.type = "button"; cancel.textContent = "キャンセル"; accept.textContent = "確認して続ける";
    cancel.addEventListener("click", () => dialog.close()); accept.addEventListener("click", () => dialog.close("confirmed"));
    dialog.addEventListener("close", () => {
      const accepted = dialog.returnValue === "confirmed"; dialog.remove(); resolve(accepted);
      // Wait for the controller to unlock the page before restoring focus.
      queueMicrotask(() => { if (previous?.isConnected) previous.focus(); });
    }, { once: true });
    dialog.append(title, text, cancel, accept); document.body.append(dialog); dialog.showModal(); cancel.focus();
  });
}

/** Browser wiring is shared; editors only hydrate and patch their own DTO sections. */
export async function mountOnlineEditor({ sections, allowDuckPresentationDeletion = false, hydrate, onState = () => {} }) {
  const root = document.getElementById("online-edit-status"), editor = document.getElementById("editor");
  const save = document.getElementById("save"), loadMessage = document.getElementById("load-message");
  const node = (tag, text) => { const el = document.createElement(tag); el.textContent = text; return el; };
  const target = node("strong", "保存対象を確認中…");
  const message = node("p", ""); message.setAttribute("role", "status");
  const actions = node("div", ""); actions.className = "online-actions";
  const reload = node("button", "サーバーから読み直す"), compare = node("button", "最新データと比較する");
  const adopt = node("button", "編集を破棄して最新を開く"), rebase = node("button", "この画面の編集を引き継いで再編集");
  for (const button of [reload, compare, adopt, rebase]) button.type = "button";
  const comparison = node("section", ""); comparison.hidden = true;
  const draftText = node("pre", ""), serverText = node("pre", "");
  const difference = node("p", "");
  const details = node("details", "");
  details.append(node("summary", "比較データを表示（左：ドラフト／右：サーバー最新）"));
  const columns = node("div", ""); columns.className = "online-comparison";
  columns.append(draftText, serverText); details.append(columns);
  comparison.append(difference, details, adopt, rebase); actions.append(reload, compare);
  root.replaceChildren(target, message, actions, comparison);
  let controller, version = -1, stopLogout, authSubscription, knownUser;
  try {
    const client = await getSupabaseClient();
    controller = createOnlineEditController({ storage: createOnlinePlayerStorage(client), sections, allowDuckPresentationDeletion,
      confirm: confirmEdit, notify: showToast });
    controller.subscribe(state => {
      if (state.dataVersion !== version) {
        version = state.dataVersion;
        for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
        hydrate(state.draft);
      }
      editor.hidden = !state.draft;
      editor.inert = !state.canEdit;
      editor.setAttribute("aria-busy", String(!!state.busy));
      save.disabled = !state.canSave;
      target.textContent = state.base ? `保存対象 ENo.${state.base.account.eno} ｜ ${state.draft.battlerName} ｜ revision ${state.base.revision}` : "保存対象未確定";
      message.textContent = state.busy ? `${state.message} 処理中…` : state.message;
      loadMessage.hidden = true;
      reload.disabled = !!state.busy;
      compare.disabled = !!state.busy || !state.base;
      adopt.disabled = rebase.disabled = !!state.busy;
      comparison.hidden = !state.latest;
      if (state.latest) {
        const labels = { build: "戦闘設定", presentation: "表示設定", publicSettings: "公開アヒル", battlerName: "Battler名" };
        const changed = Object.keys(labels).filter(key => JSON.stringify(state.draft[key]) !== JSON.stringify(state.latest.data[key]));
        difference.textContent = changed.length ? `最新データと異なる項目：${changed.map(key => labels[key]).join("、")}。引継ぎ対象：${sections.map(key => labels[key]).join("、")}。` : "ドラフトとサーバーの最新データは同じ内容です。最新を開けば再保存は不要です。";
        if (state.deletedDuckPresentationIds.length) difference.textContent += ` 表示設定は最新を保持し、削除対象Duck ${state.deletedDuckPresentationIds.length}件の表示設定・プロフィール情報のみ削除します。`;
        draftText.textContent = `ドラフト（読込時 revision ${state.base.revision}）\n${JSON.stringify(state.draft, null, 2)}`;
        serverText.textContent = `サーバー（revision ${state.latest.revision}）\n${JSON.stringify(state.latest.data, null, 2)}`;
      } else { draftText.textContent = ""; serverText.textContent = ""; details.open = false; }
      document.getElementById("save-message").textContent = state.dirty ? "未保存の変更があります" : "変更はありません";
      onState(state);
    });
    reload.addEventListener("click", () => void controller.load());
    compare.addEventListener("click", () => void controller.compare());
    adopt.addEventListener("click", () => void controller.adoptLatest(false));
    rebase.addEventListener("click", () => void controller.adoptLatest(true));
    const beforeUnload = event => {
      const state = controller.snapshot();
      if (state.dirty || state.busy === "save") { event.preventDefault(); event.returnValue = ""; }
    };
    const checkScope = () => { if (document.visibilityState !== "hidden") void controller.checkScope(); };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("focus", checkScope);
    document.addEventListener("visibilitychange", checkScope);
    authSubscription = client.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user?.id ?? null;
      const baseUser = controller.snapshot().base?.authUserId;
      if (_event === "SIGNED_OUT" || (knownUser !== undefined && knownUser !== userId) || (baseUser && baseUser !== userId)) {
        controller.invalidate("ログイン先が変わったため、旧アカウントの未保存変更を破棄しました。保存対象を確認して読み込み直してください。");
      }
      knownUser = userId;
      // No asynchronous Supabase API call inside an Auth callback (SDK lock).
    }).data.subscription;
    const auth = await getAuthRuntime();
    stopLogout = auth.beforeLogout(() => controller.canLeave());
    window.addEventListener("pagehide", event => {
      if (event.persisted) return;
      authSubscription.unsubscribe(); stopLogout();
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("focus", checkScope);
      document.removeEventListener("visibilitychange", checkScope);
      controller.invalidate("");
    });
    // A BFCache restore must recheck identity before showing the cached editor.
    window.addEventListener("pageshow", event => { if (event.persisted) void controller.checkScope(); });
    await controller.load();
    return controller;
  } catch {
    editor.hidden = true; save.disabled = true;
    message.textContent = "オンライン設定を準備できませんでした。通信状況を確認し、ページを再読み込みしてください。";
    loadMessage.hidden = true;
    return null;
  }
}
