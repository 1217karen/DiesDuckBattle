import { showToast } from "./toast.js";
import { getSupabaseClient } from "./authRuntime.js";
import { createSkillVaultStorage } from "./skillVaultStorage.js";
import { createSkillVaultController } from "./skillVaultController.js";
import { captureVaultSkill, presentVaultSkill } from "./skillVaultModel.js";
import { calculateASkillResources } from "./aSkillResources.js";

export function createSkillVaultView({ context, apply, storage, notify = showToast }) {
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const button = (text, action, className) => {
    const element = node("button", text, className); element.type = "button";
    element.addEventListener("click", action); return element;
  };
  const open = new Set(), roots = new Map();
  let activeDialog = null, dialogContext = null;
  const sameContext = token => {
    const current = context(token.type);
    return current.canEdit && current.key === token.key;
  };
  function description(type, selection, owner) {
    const text = presentVaultSkill(type, selection).text;
    if (type !== "A" || !text) return text;
    try {
      const resources = calculateASkillResources(owner, selection);
      return resources.netCost == null ? text : `${text}\n現在のアヒルでの必要pt：${resources.netCost}`;
    } catch { return text; }
  }
  const controller = createSkillVaultController({
    storage: storage ?? Object.fromEntries(["list", "store", "remove"].map(method => [method, async (...args) =>
      createSkillVaultStorage(await getSupabaseClient())[method](...args)])),
    onChange: () => update(),
    onSuccess: notify,
  });
  function sync(next) {
    controller.setScope(next.base && next.draft && !next.blocked ? {
      authUserId: next.base.authUserId, gameAccountId: next.base.account.id,
    } : null);
    update();
  }
  function update() {
    if (activeDialog && !sameContext(dialogContext)) activeDialog.close();
    for (const [type, root] of roots) fill(type, root);
  }
  // Distinguish the skill's effect sentence from explanatory dialog copy.
  const skillParagraph = text => ({ text });
  function dialog(token, title, paragraphs, actions) {
    activeDialog?.close();
    const element = node("dialog", null, "confirm-dialog skill-vault-dialog");
    const heading = node("h3", title); heading.id = "skill-vault-heading";
    element.setAttribute("aria-labelledby", heading.id);
    const row = node("div", null, "skill-vault-actions");
    for (const action of actions) {
      const control = button(action.text, () => {
        if (control.disabled || !sameContext(token)) { element.close(); return; }
        // Close before any async request; controller locks all vault controls synchronously.
        element.close(); action.run?.();
      }, action.className);
      control.disabled = !!action.disabled; row.append(control);
    }
    element.append(heading, ...paragraphs.map(part => typeof part === "string"
      ? node("p", part) : node("p", part.text, "skill-vault-skill-text")), row);
    element.addEventListener("close", () => {
      element.remove(); if (activeDialog === element) { activeDialog = null; dialogContext = null; }
    }, { once: true });
    activeDialog = element; dialogContext = token;
    document.body.append(element); element.showModal();
  }
  function confirmStore(type) {
    const token = { ...context(type), type }, entry = captureVaultSkill(type, token.owner);
    if (!entry || controller.snapshot().busy) return;
    dialog(token, "スキルを保管しますか？", [
      `「${entry.name || "無名のスキル"}」を保管しますか？`,
      ...(entry.ruby ? [`ルビ：${entry.ruby}`] : []), skillParagraph(description(type, entry.selection, token.owner)),
      "保管したスキルは、あとから読み込むことができます。現在の戦闘設定は保存されません。",
    ], [{ text: "キャンセル" }, { text: "保管する", className: "primary", run: () => {
      // Capture the draft at confirmation, not the server DTO or a previous render.
      const current = captureVaultSkill(type, context(type).owner);
      if (sameContext(token) && current) void controller.store(current);
    } }]);
  }
  function inspect(type, entry) {
    if (entry.type !== type || controller.snapshot().busy) return;
    const token = { ...context(type), type };
    const loadable = !!captureVaultSkill(type, { [`${type.toLowerCase()}Selection`]: entry.selection,
      skillLabels: { [type]: { name: entry.name, ruby: entry.ruby } } });
    const skillText = description(type, entry.selection, token.owner);
    dialog(token, entry.displayName, [`対象スキル種別：${type}`, `スキル名：${entry.name || "（空欄）"}`,
      `ルビ：${entry.ruby || "（空欄）"}`,
      skillText ? skillParagraph(skillText) : "現在のルールでは表示・読み込みできない選択肢が含まれています。元の保管データは維持されます。",
      `読み込むと現在の${type}スキルに上書きします。設定画面の『保存』ボタンを押すまで、変更は保存されません。`,
    ], [{ text: "読み込む", className: "primary", disabled: !loadable, run: () => apply(type, entry, token) },
      { text: "キャンセル" }, { text: "削除する", className: "skill-vault-delete", run: () => {
        dialog(token, "削除の確認", [`『${entry.displayName}』をスキル保管庫から削除しますか？`,
          "この操作は取り消せません。現在編集中のスキル設定には影響しません。"],
        [{ text: "キャンセル" }, { text: "削除する", className: "skill-vault-delete-confirm", run: () => void controller.remove(entry.id) }]);
      } }]);
  }
  function fill(type, root) {
    const snapshot = controller.snapshot(), current = context(type);
    const locked = snapshot.busy || !snapshot.ready || !!snapshot.uncertain || !current.canEdit;
    const store = button("このスキルを保管", () => confirmStore(type)); store.id = `vault-${type}-store`;
    store.disabled = locked || !captureVaultSkill(type, current.owner);
    const details = node("details"); details.id = `vault-${type}`; details.open = open.has(type);
    details.addEventListener("toggle", () => { if (details.open) open.add(type); else open.delete(type); });
    details.append(node("summary", "スキル保管庫"));
    const list = node("div", null, "skill-vault-list");
    for (const entry of snapshot.entries.filter(entry => entry.type === type)) {
      const item = button(entry.displayName, () => inspect(type, entry)); item.disabled = locked; list.append(item);
    }
    if (!list.children.length) list.append(node("p", snapshot.ready ? "保管されているスキルはありません。" : "保管庫を取得してください。"));
    const refresh = button("一覧を再取得", () => void controller.refresh()); refresh.disabled = snapshot.busy || !current.canEdit;
    details.append(list, refresh);
    if (snapshot.uncertain) {
      const retry = button("同じ操作を確認して再実行", () => {
        const token = { ...context(type), type };
        dialog(token, "操作の再確認", ["同じ操作IDで再実行します。保管が完了している場合は重複追加しません。"],
          [{ text: "キャンセル" }, { text: "再実行", run: () => void controller.retry() }]);
      });
      retry.disabled = snapshot.busy; details.append(retry);
    }
    const status = node("p", snapshot.busy ? "スキル保管庫と通信中…" : snapshot.message, "skill-vault-status");
    status.setAttribute("role", "status");
    root.replaceChildren(store, details, status);
  }
  return { sync, update, controller,
    append(box, type) {
      const root = node("div", null, "skill-vault"); roots.set(type, root); box.append(root); fill(type, root);
    },
  };
}
