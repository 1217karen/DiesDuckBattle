import { getAuthRuntime } from "./authRuntime.js";
import { menuModel } from "./commonMenuModel.js";

const root = document.getElementById("common-menu");
root.innerHTML = '<details><summary><span class="common-menu__icon" aria-hidden="true">☰</span><span data-identity role="status">ログイン状態を確認中…</span><span class="common-menu__label">メニュー</span></summary><nav aria-label="共通メニュー"></nav><p data-feedback role="status" hidden></p></details>';
const details = root.querySelector("details"), summary = root.querySelector("summary");
root.addEventListener("keydown", event => {
  if (event.key === "Escape") { details.open = false; summary.focus(); }
});
document.addEventListener("click", event => {
  if (!root.contains(event.target)) details.open = false;
});
try {
  const controller = await getAuthRuntime();
  let lastMenuKey = "";
  controller.subscribe(state => {
    const model = menuModel(state);
    const label = root.querySelector("[data-identity]");
    label.textContent = model.identity; label.title = model.identity;
    // Do not replace focused links on token refresh or account-name updates.
    const menuKey = String(model.loggedIn);
    if (lastMenuKey !== menuKey) {
      lastMenuKey = menuKey;
      const items = model.items.map(item => {
        const el = document.createElement(item.href ? "a" : "span");
        el.textContent = item.label;
        if (item.href) el.href = item.href; else el.setAttribute("aria-disabled", "true");
        return el;
      });
      if (model.loggedIn) {
        const button = document.createElement("button");
        button.type = "button"; button.textContent = "ログアウト";
        button.addEventListener("click", async () => {
          await controller.logout();
          // Restore focus when the logout button itself disappears.
          if (!button.isConnected) { details.open = false; summary.focus(); }
        });
        items.push(button);
      }
      root.querySelector("nav").replaceChildren(...items);
    }
    const logout = root.querySelector("nav button");
    if (logout) logout.disabled = !!state.busy;
    const feedback = root.querySelector("[data-feedback]");
    const error = state.messageSource === "logout" ? state.message : "";
    feedback.hidden = !error; feedback.textContent = error;
  });
} catch {
  root.querySelector("[data-identity]").textContent = "ログイン状態を確認できません";
  const link = document.createElement("a"); link.href = "index.html"; link.textContent = "ホーム";
  root.querySelector("nav").append(link);
}
