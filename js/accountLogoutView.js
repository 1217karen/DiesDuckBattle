/** One chooser for menu, home and authentication-page logout buttons. */
export function chooseLogoutMethod({ document = globalThis.document } = {}) {
  if (!document) return Promise.resolve(null);
  return new Promise(resolve => {
    const previous = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "account-switch-dialog account-logout-dialog";
    dialog.setAttribute("aria-labelledby", "account-logout-title");
    const title = document.createElement("h2");
    title.id = "account-logout-title"; title.textContent = "ログアウト方法を選択";
    dialog.append(title);
    let result = null, closing = false;
    const finish = choice => {
      if (closing) return;
      closing = true; result = choice; dialog.close();
    };
    for (const [choice, text, description] of [
      ["game", "ゲームからログアウトする", "未ログイン状態に戻ります。追加済みのアカウントはこの端末に保持されます。"],
      ["unlink", "現在使用中のアカウントの連携を解除する", "この端末のアカウント一覧から現在のENoを外して、未ログイン状態に戻ります。ほかの追加済みアカウントは保持されます。"],
    ]) {
      const button = document.createElement("button"), help = document.createElement("p");
      button.type = "button"; button.textContent = text;
      help.id = `account-logout-${choice}-help`; help.textContent = description;
      button.setAttribute("aria-describedby", help.id);
      button.addEventListener("click", () => finish(choice));
      dialog.append(button, help);
    }
    const note = document.createElement("p");
    note.textContent = "ゲームからのログアウトでは、この端末に認証情報が残ります。サーバー上の認証を失効させる操作や、共用端末での完全なログアウトではありません。連携解除はアカウント削除とは異なります。";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.textContent = "キャンセル";
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (previous?.isConnected) previous.focus();
      resolve(result);
    }, { once: true });
    dialog.append(note, cancel); document.body.append(dialog); dialog.showModal(); cancel.focus();
  });
}
