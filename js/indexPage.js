import { getAuthRuntime } from "./authRuntime.js";
import { mountAuthView } from "./authView.js";
import { menuModel } from "./commonMenuModel.js";
import { consumeIndexNotice } from "./indexNotice.js";

consumeIndexNotice();

const dialog = document.getElementById("auth-dialog");
const root = document.getElementById("auth-root");
let view, opener;
for (const button of document.querySelectorAll("[data-auth-mode]")) {
  button.addEventListener("click", () => {
    opener = button;
    view.switchForm(button.dataset.authMode);
    dialog.showModal(); // Native modal provides focus trapping and Escape handling.
    root.querySelector(button.dataset.authMode === "login" ? "#login-eno" : "#character-name").focus();
  });
}
document.getElementById("auth-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  view?.clearPasswords();
  const target = opener?.getClientRects().length ? opener : document.getElementById("home-status");
  target.focus();
});
try {
  const controller = await getAuthRuntime();
  view = mountAuthView(root, controller, {
    onLoginSuccess() {
      if (dialog.open) dialog.close();
      document.getElementById("home-status").focus();
    },
  });
  let menuBuilt = false;
  controller.subscribe(state => {
    const known = state.ready && state.sessionKnown;
    document.getElementById("home-guest").hidden = !known || state.signedIn;
    document.getElementById("home-game").hidden = !known || !state.signedIn;
    document.getElementById("home-status").textContent = !known ? state.sessionMessage
      : state.signedIn ? menuModel(state).identity : "ログイン、または新規登録してはじめましょう。";
    const feedback = document.getElementById("home-feedback");
    feedback.textContent = state.registeredEno ? "登録済みのENo：" + state.registeredEno + "。ENoを控えてください。" : state.messageSource === "logout" ? state.message : "";
    if (!menuBuilt && known && state.signedIn) {
      menuBuilt = true;
      document.getElementById("home-game").replaceChildren(...menuModel(state).items.filter(item => item.href !== "index.html").map(item => {
        const el = document.createElement(item.href ? "a" : "span");
        el.className = "home__link"; el.textContent = item.label;
        if (item.href) el.href = item.href; else el.setAttribute("aria-disabled", "true");
        return el;
      }));
    }
  });
} catch {
  document.getElementById("home-status").textContent = "認証機能を読み込めませんでした。通信状況を確認して再読み込みしてください。";
}
