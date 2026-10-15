import { getSupabaseClient } from "./authRuntime.js";
import { displayCache } from "./authDisplayCache.js";
import { createAccountDeletionService, deletionMessages } from "./accountDeletionService.js";

export function deletionAccount(state) {
  if (!state?.ready || !state.sessionKnown || !state.signedIn || !state.accountsResolved || state.busy
    || state.accounts?.length !== 1) return null;
  const account = state.accounts[0];
  return typeof account.eno === "string" && /^[1-9]\d*$/.test(account.eno) && account.name?.trim()
    ? { eno: account.eno, name: account.name } : null;
}
const key = account => account ? `${account.eno}/${account.name}` : "";

/** Dialog state is transient. Only the final button can invoke remove(). */
export function createAccountDeletionView({ controller, getService, onBusy = () => {},
  clearCache = () => displayCache.clear(), navigate = () => location.replace("index.html?notice=account-deleted") }) {
  let account = null, target = null, dialog = null, stage = "", generation = 0, busy = false, deleted = false;
  let servicePromise;
  const service = () => servicePromise ??= getService ? Promise.resolve(getService())
    : controller.createDeletionService ? Promise.resolve(controller.createDeletionService())
    : getSupabaseClient().then(client => createAccountDeletionService(client));
  const el = (tag, text) => { const node = document.createElement(tag); if (text != null) node.textContent = text; return node; };
  const button = (text, action) => {
    const node = el("button", text); node.type = "button";
    node.addEventListener("click", () => { if (!node.disabled) action(); }); return node;
  };
  const launch = button("アカウントを削除", () => void open());
  launch.className = "common-menu__delete-account"; launch.disabled = true; launch.hidden = true;
  const separator = el("hr"); separator.className = "common-menu__account-separator"; separator.hidden = true;
  const feedback = el("p"); feedback.className = "account-deletion-feedback"; feedback.hidden = true; feedback.setAttribute("role", "alert");
  function message(text) { feedback.textContent = text; feedback.hidden = !text; }
  function lock(value) {
    busy = value; launch.disabled = value || !account || deleted;
    if (value && dialog) {
      for (const node of dialog.querySelectorAll("button, input")) node.disabled = true;
      dialog.setAttribute("aria-busy", "true");
    }
    onBusy(value);
  }
  function close() {
    if (busy) return;
    generation++; dialog?.close(); target = null; stage = "";
  }
  function show(title, paragraphs, actions = null, checkbox = false) {
    const previous = dialog; dialog = null; previous?.close();
    const node = el("dialog"); dialog = node; node.className = "account-deletion-dialog";
    const heading = el("h2", title); heading.id = "account-deletion-title";
    node.setAttribute("aria-labelledby", heading.id);
    const content = paragraphs.map(text => el("p", text));
    content[0]?.classList.add("account-deletion-identity");
    const controls = el("div"); controls.className = "account-deletion-actions";
    const cancel = button(actions ? "キャンセル" : "閉じる", close); controls.append(cancel);
    const accept = actions ? button(actions.label, actions.run) : null;
    if (accept) { accept.className = "account-deletion-confirm"; controls.append(accept); }
    node.append(heading, ...content);
    if (checkbox) {
      const label = el("label"); label.className = "account-deletion-consent";
      const input = el("input"); input.type = "checkbox"; input.checked = false;
      input.addEventListener("change", () => { accept.disabled = busy || !input.checked; });
      label.append(input, el("span", "上記の内容を確認し、アカウントの削除に同意します。")); node.append(label);
      accept.disabled = true;
    }
    const status = el("p"); status.setAttribute("role", "status"); status.className = "account-deletion-status";
    node.append(status, controls);
    node.addEventListener("cancel", event => { event.preventDefault(); if (!busy) close(); });
    node.addEventListener("close", () => {
      node.remove();
      if (dialog === node) { dialog = null; if (!busy) { generation++; target = null; stage = ""; } }
    });
    document.body.append(node); node.showModal(); cancel.focus();
    return { node, accept, cancel, status };
  }
  async function open() {
    if (!account || busy || deleted || dialog) return;
    const ticket = ++generation, expected = { ...account }; message(""); lock(true);
    let result;
    try { result = await (await service()).prepare(expected); }
    catch { result = { ok: false, message: deletionMessages.unavailable }; servicePromise = null; }
    if (ticket !== generation) return;
    lock(false);
    if (!result.ok || key(account) !== key(expected)) {
      const text = result.message || deletionMessages.changed;
      message(text); show("削除対象を確認できませんでした", [text]); return;
    }
    target = result.target; stage = "consent";
    show("アカウントの削除", [`ENo.${target.eno}　${target.name}を削除します。`,
      "アカウントを削除すると、登録したバトラーやアヒルの情報はすべて削除され、復元できなくなります。",
      "過去の戦闘履歴は削除されません。"], { label: "削除する", run: () => {
      if (stage !== "consent" || busy || !target || key(account) !== key(target)) return;
      stage = "final";
      show("本当に削除しますか？", [`ENo.${target.eno}　${target.name}を完全に削除します。`, "この操作は取り消せません。"],
        { label: "削除を実行", run: () => void execute() });
    } }, true);
  }
  async function finish(ticket, expected) {
    const result = await (await service()).cleanup(expected);
    if (ticket !== generation) return;
    if (!result.ok) {
      lock(false); message(result.message);
      if (result.status === "changed") { dialog?.close(); controller.endAccountDeletion?.(); return; }
      const switching = controller.snapshot?.().accountSwitching;
      show("ログアウト処理の確認", [result.message], { label: switching ? "端末側の処理を完了する" : "ログアウトを完了", run: () => {
        if (busy) return; lock(true); void finish(ticket, expected);
      } });
      // Recovery metadata now owns this target. Do not block healthy accounts until reload.
      if (switching) controller.endAccountDeletion?.();
      return;
    }
    clearCache(); await controller.accountDeleted?.(); clearCache(); navigate();
  }
  async function execute() {
    if (busy || deleted || stage !== "final" || !target || key(account) !== key(target)) return;
    const ticket = generation, expected = { ...target }; lock(true);
    controller.beginAccountDeletion?.();
    dialog.querySelector("[role=status]").textContent = "削除処理中です…";
    let result;
    try { result = await (await service()).remove(expected); }
    catch { result = { ok: false, message: deletionMessages.unknown }; }
    if (ticket !== generation) return;
    if (!result.ok) {
      lock(false); dialog?.close(); target = null; stage = ""; controller.endAccountDeletion?.();
      message(result.message); show("削除結果の確認", [result.message]); return;
    }
    deleted = true; stage = "cleanup";
    await finish(ticket, expected);
  }
  controller.beforeLogout?.(() => !busy);
  return { launch, separator, feedback, get busy() { return busy; },
    update(state) {
      const next = deletionAccount(state);
      launch.hidden = separator.hidden = !state.sessionKnown || !state.signedIn;
      // SIGNED_OUT during our successful cleanup is expected. Do not discard the
      // acknowledged deletion before clearing this browser's auth state.
      if (deleted && stage === "cleanup" && !state.signedIn) return;
      if (key(account) !== key(next)) {
        servicePromise = null;
        generation++; account = next; target = null; stage = ""; dialog?.close(); lock(false);
        controller.endAccountDeletion?.();
        message("");
      }
      launch.disabled = busy || !account || deleted;
      launch.title = !account ? "削除対象のENoを確実に特定できる場合のみ操作できます。" : "";
    },
  };
}
