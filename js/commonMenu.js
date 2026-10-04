import { displayCache } from "./authDisplayCache.js";
import { getAuthRuntime } from "./authRuntime.js";
import { menuModel } from "./commonMenuModel.js";

const root = document.getElementById("common-menu");
const details = root.querySelector("details"), summary = root.querySelector("summary");
root.addEventListener("keydown", event => {
  if (event.key === "Escape") { details.open = false; summary.focus(); }
});
document.addEventListener("click", event => {
  if (!root.contains(event.target)) details.open = false;
});
let displayed = displayCache.read();
const label = root.querySelector("[data-identity]");
if (displayed && label.textContent !== displayed.identity) { label.textContent = displayed.identity; label.title = displayed.identity; }
try {
  const controller = await getAuthRuntime();
  let lastMenuKey = "", redirected = false;
  controller.subscribe(state => {
    if (!redirected && state.sessionKnown && !state.signedIn && !state.busy && state.logoutSucceeded) {
      redirected = true;
      location.replace("index.html?notice=logged-out");
    }
    const model = menuModel(state);
    // Keep confirmed display while the real runtime restores session/accounts.
    const pending = (!state.sessionKnown && !state.ready)
      || (state.signedIn && !state.accountsResolved && !state.accounts.length && (!state.ready || displayed?.loggedIn));
    const identity = pending ? (displayed?.identity ?? "") : model.identity;
    if (label.textContent !== identity) { label.textContent = identity; label.title = identity; }
    if (!pending) displayed = { loggedIn: model.loggedIn, identity };
    // Cached state changes presentation only; links remain protected by their page guards.
    const visualLoggedIn = pending ? (displayed?.loggedIn ?? false) : model.loggedIn;
    const visualModel = menuModel({ ...state, sessionKnown: true, signedIn: visualLoggedIn });
    // Do not replace focused links on token refresh or account-name updates.
    const menuKey = String(visualLoggedIn);
    if (lastMenuKey !== menuKey) {
      lastMenuKey = menuKey;
      const items = visualModel.items.map(item => {
        const el = document.createElement(item.href ? "a" : "span");
        el.textContent = item.label;
        if (item.href) el.href = item.href; else el.setAttribute("aria-disabled", "true");
        return el;
      });
      if (visualLoggedIn) {
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
