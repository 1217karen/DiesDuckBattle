export const isAccountSwitch = action => ["select", "add", "reauthenticate"].includes(action);
export const accountSwitchBusyMessage = "処理中です。完了してからアカウントを切り替えてください。";
export function accountSwitchBlock(action, { busy, dirty }) {
  if (!isAccountSwitch(action)) return null;
  const message = busy ? accountSwitchBusyMessage
    : dirty ? "未保存の変更があります。保存してからアカウントを切り替えてください。" : null;
  return message ? { ok: false, code: busy ? "operation-in-progress" : "unsaved-changes", message } : null;
}
