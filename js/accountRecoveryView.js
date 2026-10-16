/** Recovery is not login or account selection; it remains available in guest mode. */
export function createAccountRecoveryView({ document, controller }) {
  const panel = document.createElement("aside");
  panel.className = "account-recovery"; panel.hidden = true;
  panel.setAttribute("aria-label", "端末の未完了処理");
  document.body.append(panel);
  let key;
  return { update(state) {
    const next = JSON.stringify([state.signedIn, state.pendingAccounts, state.deletionRecoveries, state.busy, state.message]);
    if (key === next) return; key = next;
    panel.replaceChildren();
    panel.hidden = !!state.signedIn || !(state.pendingAccounts?.length || state.deletionRecoveries?.length);
    if (panel.hidden) return;
    const text = value => { const p = document.createElement("p"); p.textContent = value; panel.append(p); };
    const button = (label, run) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = label;
      b.disabled = !!state.busy; b.addEventListener("click", run); panel.append(b);
    };
    for (const entry of state.pendingAccounts ?? []) button(`ENo.${entry.eno}の未完了ログインを清掃`, () => void controller.cleanupPending(entry.slot));
    for (const entry of state.deletionRecoveries ?? []) {
      if (entry.state === "deletion-confirmed") {
        text(`ENo.${entry.eno}の削除成功応答を記録しています。この端末のログイン情報の清掃が未完了です。`);
        button("端末側の処理を完了する", () => void controller.cleanupDeleted({ ...entry }));
      } else text(`ENo.${entry.eno}の削除結果は不明です。削除要求は再送しません。通信状況とサーバー側の状態の確認が必要です。`);
    }
    if (state.message) text(state.message);
  } };
}
