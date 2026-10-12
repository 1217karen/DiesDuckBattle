import "./siteTheme.js";
import { displayCache } from "./authDisplayCache.js";
import { getAuthRuntime } from "./authRuntime.js";
import { menuModel } from "./commonMenuModel.js";

const root = document.getElementById("common-menu");
const details = root.querySelector(".common-menu__nav"), summary = details.querySelector("summary");
const accountDetails = root.querySelector(".common-menu__account"), accountSummary = accountDetails.querySelector("summary");
const accountMenu = root.querySelector("[data-account-menu]");
let accountEnabled = false;
accountSummary.addEventListener("click", event => { if (!accountEnabled) event.preventDefault(); });
for (const [opened, other] of [[details, accountDetails], [accountDetails, details]]) {
  opened.addEventListener("toggle", () => {
    if (opened.open) {
      if (opened === accountDetails && !accountEnabled) opened.open = false;
      else other.open = false;
    }
  });
}
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  const opened = accountDetails.open ? accountDetails : details.open ? details : null;
  if (opened) {
    event.preventDefault(); opened.open = false;
    (opened === accountDetails ? accountSummary : summary).focus();
  }
});
document.addEventListener("click", event => {
  if (!root.contains(event.target)) { details.open = false; accountDetails.open = false; }
});
let displayed = displayCache.read();
const label = root.querySelector("[data-identity]");
if (displayed && label.textContent !== displayed.identity) { label.textContent = displayed.identity; label.title = displayed.identity; }
const publicItems = menuModel({ sessionKnown: false }).items;
const links = document.createElement("div");
links.className = "common-menu__links";
const themeSetting = document.createElement("fieldset"), themeLegend = document.createElement("legend"), themeOptions = document.createElement("div");
themeSetting.className = "common-menu__theme"; themeLegend.textContent = "サイトテーマ";
themeOptions.className = "common-menu__theme-options";
const themeRadios = [];
for (const [value, text] of [["light", "ライト"], ["dark", "ダーク"]]) {
  const label = document.createElement("label"), radio = document.createElement("input");
  radio.type = "radio"; radio.name = "site-theme"; radio.value = value;
  radio.checked = globalThis.diesDuckSiteTheme.read() === value;
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    const selected = globalThis.diesDuckSiteTheme.set(value);
    for (const option of themeRadios) option.checked = option.value === selected;
  });
  themeRadios.push(radio);
  label.append(radio, document.createTextNode(text)); themeOptions.append(label);
}
themeSetting.append(themeLegend, themeOptions);
// Keep controls and their focus/listeners intact when authentication redraws links.
root.querySelector("nav").append(links, themeSetting);
function renderMenu(items) {
  links.replaceChildren(...items.map(item => {
    const link = document.createElement("a");
    link.textContent = item.label; link.href = item.href;
    return link;
  }));
}
// Public navigation is usable even while the authentication SDK is loading.
renderMenu(publicItems);
try {
  const controller = await getAuthRuntime();
  let lastMenuKey = "", redirected = false, profileLink, logoutButton;
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
    accountEnabled = visualLoggedIn;
    accountSummary.setAttribute("aria-disabled", String(!accountEnabled));
    accountSummary.setAttribute("tabindex", accountEnabled ? "0" : "-1");
    root.querySelector("[data-account-arrow]").hidden = !accountEnabled;
    if (!accountEnabled) accountDetails.open = false;
    // Do not replace focused links on token refresh or account-name updates.
    const menuKey = String(visualLoggedIn);
    if (lastMenuKey !== menuKey) {
      lastMenuKey = menuKey;
      renderMenu(visualModel.items);
      profileLink = null; logoutButton = null;
      if (visualLoggedIn) {
        profileLink = document.createElement("a");
        profileLink.textContent = "自分のプロフィールを確認する";
        profileLink.hidden = true;
        const button = document.createElement("button");
        button.type = "button"; button.textContent = "ログアウト";
        button.addEventListener("click", async () => {
          await controller.logout();
          // Restore focus when the logout button itself disappears.
          if (!button.isConnected) { accountDetails.open = false; summary.focus(); }
        });
        logoutButton = button;
        accountMenu.replaceChildren(profileLink, button);
      } else {
        accountMenu.replaceChildren();
      }
    }
    // Update in place: token refresh/name changes must not replace focused account controls.
    if (profileLink) {
      const account = !pending ? model.currentAccount : null;
      profileLink.hidden = !account;
      if (account) profileLink.setAttribute("href", "profile.html?eno=" + encodeURIComponent(account.eno));
      else profileLink.removeAttribute("href");
    }
    if (logoutButton) logoutButton.disabled = !!state.busy;
    const feedback = root.querySelector("[data-feedback]");
    const error = state.messageSource === "logout" ? state.message : "";
    feedback.hidden = !error; feedback.textContent = error;
  });
} catch {
  accountEnabled = false; accountDetails.open = false;
  accountSummary.setAttribute("aria-disabled", "true"); accountSummary.setAttribute("tabindex", "-1");
  root.querySelector("[data-account-arrow]").hidden = true;
  accountMenu.replaceChildren();
  root.querySelector("[data-identity]").textContent = "ログイン状態を確認できません";
  renderMenu(publicItems);
}
