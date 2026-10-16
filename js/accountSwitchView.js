export function createAccountSwitchView({ document, controller, menu, summary, deletion }) {
  const el = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
  const button = (text, run) => { const node = el("button", text); node.type = "button"; node.addEventListener("click", run); return node; };
  let dialog, latest, renderingKey = "", controls = [];
  const status = el("p"); status.setAttribute("role", "status"); status.className = "account-switch-status";
  function openLogin(eno = "") {
    if (dialog || latest?.busy || deletion.busy) return;
    const previous = document.activeElement;
    dialog = el("dialog"); dialog.className = "account-switch-dialog";
    dialog.setAttribute("aria-labelledby", "account-switch-title");
    const title = el("h2", eno ? `ENo.${eno}に再ログイン` : "別のアカウントを追加"); title.id = "account-switch-title";
    const form = el("form"), fields = el("fieldset");
    const enoLabel = el("label", "ENo"), enoInput = el("input");
    enoInput.type = "text"; enoInput.inputMode = "numeric"; enoInput.autocomplete = "username"; enoInput.required = true; enoInput.value = eno;
    enoLabel.append(enoInput);
    const passwordLabel = el("label", "パスワード"), password = el("input");
    password.type = "password"; password.autocomplete = "current-password"; password.required = true;
    passwordLabel.append(password);
    const feedback = el("p"); feedback.setAttribute("role", "status");
    let submitting = false;
    const close = () => { if (!submitting) { password.value = ""; dialog.close(); } };
    const cancel = button("キャンセル", close), submit = el("button", "ログインする"); submit.type = "submit";
    const actions = el("div"); actions.className = "account-switch-actions"; actions.append(cancel, submit);
    fields.append(enoLabel, passwordLabel, actions); form.append(fields, feedback);
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (submitting) return;
      let secret = password.value; password.value = ""; submitting = true; fields.disabled = true;
      feedback.textContent = "ログインを確認中…";
      const result = await controller.login(enoInput.value, secret); secret = "";
      submitting = false; fields.disabled = false;
      if (result?.ok) close(); // The shared controller owns navigation, including ordinary login.
      else feedback.textContent = controller.snapshot().message || "ログインできませんでした。";
    });
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.addEventListener("close", () => { password.value = ""; dialog.remove(); dialog = null; (previous?.isConnected ? previous : summary).focus(); }, { once: true });
    dialog.append(title, form); document.body.append(dialog); dialog.showModal(); enoInput.focus();
  }
  async function select(entry) {
    if (latest?.busy || deletion.busy) return;
    const result = await controller.select(entry.eno);
    if (result?.code === "reauthentication-required") openLogin(entry.eno);
  }
  function update(state) {
    latest = state;
    const current = state.accounts?.[0];
    const key = JSON.stringify([state.savedAccounts, state.pendingAccounts, state.deletionRecoveries, current?.eno]);
    if (key !== renderingKey) {
      renderingKey = key; controls = [];
      const nodes = [];
      if (current) {
        const profile = el("a", "自分のプロフィールを確認する");
        profile.href = `profile.html?eno=${encodeURIComponent(current.eno)}`;
        nodes.push(profile);
      }
      const section = title => {
        const separator = el("hr"); separator.className = "common-menu__account-separator";
        const heading = el("h3", title); heading.className = "account-switch-heading";
        nodes.push(separator, heading);
      };
      section("アカウント切り替え");
      nodes.push(...(state.savedAccounts ?? []).map(entry => {
        const selected = current?.eno === entry.eno;
        const node = button(`ENo.${entry.eno}｜${entry.name || "名前未取得"}${selected ? "（現在使用中）" : ""}`, () => void select(entry));
        node.className = "account-switch-choice";
        node.dataset.recovery = String((state.deletionRecoveries ?? []).some(item => item.eno === entry.eno));
        node.dataset.current = String(selected); if (selected) node.setAttribute("aria-current", "true");
        controls.push(node); return node;
      }));
      section("アカウント管理");
      const add = button("＋ 別のアカウントを追加", () => openLogin()); add.className = "account-switch-add"; controls.push(add); nodes.push(add);
      if (current) {
        const logout = button("ログアウト", () => void controller.logout()); logout.className = "account-switch-logout"; controls.push(logout);
        nodes.push(logout, deletion.launch, deletion.feedback);
      }
      for (const entry of state.pendingAccounts ?? []) {
        const cleanup = button(`ENo.${entry.eno}の未完了ログインを清掃`, () => void controller.cleanupPending(entry.slot));
        controls.push(cleanup); nodes.push(cleanup);
      }
      for (const item of state.deletionRecoveries ?? []) {
        const confirmed = item.state === "deletion-confirmed";
        nodes.push(el("p", confirmed
          ? `ENo.${item.eno}の削除成功応答を記録しています。この端末のログイン情報の清掃が未完了です。`
          : `ENo.${item.eno}の削除結果は不明です。削除要求は再送しません。通信状況とサーバー側の状態の確認が必要です。`));
        if (confirmed) {
          const cleanup = button("端末側の処理を完了する", () => void controller.cleanupDeleted({ ...item }));
          controls.push(cleanup); nodes.push(cleanup);
        }
      }
      menu.replaceChildren(...nodes, status);
    }
    for (const control of controls) control.disabled = !!state.busy || deletion.busy || control.dataset.current === "true" || control.dataset.recovery === "true";
    status.textContent = state.message || (state.busy ? "処理中…" : "");
  }
  return { update, openLogin };
}
