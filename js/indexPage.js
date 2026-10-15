import { mountIndexMessages } from "./indexMessagesView.js";
import { finishPageLoad } from "./pageLoad.js";
import { getAuthRuntime, getSupabaseClient } from "./authRuntime.js";
import { mountAuthView } from "./authView.js";
import { menuModel } from "./commonMenuModel.js";
import { consumeIndexNotice } from "./indexNotice.js";

import { createOnlinePlayerStorage } from "./onlinePlayerStorage.js";
import { FIXED_IMAGES, setImageFromCandidates } from "./fixedImages.js";

consumeIndexNotice();

const standing = document.getElementById("home-standing");
const icon = document.getElementById("home-icon");
let imageAccount, imageRevision = 0;
function hideBattlerImages() {
  for (const image of [standing, icon]) image.style.visibility = "hidden";
}
function showBattlerImages(battler = {}, revision = imageRevision) {
  for (const [image, url, fallback] of [
    [standing, battler.standingImageUrl, FIXED_IMAGES.battlerStanding],
    [icon, battler.defaultIconUrl, FIXED_IMAGES.battlerIcon],
  ]) {
    // Load fallback candidates off-screen so an old request cannot reveal another account.
    const pendingImage = document.createElement("img");
    pendingImage.onload = async () => {
      if (revision !== imageRevision) return;
      image.src = pendingImage.src;
      try {
        await image.decode();
        if (revision === imageRevision) image.style.visibility = "visible";
      } catch {
        if (revision === imageRevision) pendingImage.onerror?.();
      }
    };
    setImageFromCandidates(pendingImage, [url], fallback);
  }
}
hideBattlerImages();
function updateBattlerImages(state) {
  const account = state.ready ? menuModel(state).currentAccount : null;
  const eno = account?.eno ?? null;
  const key = !state.ready || !state.sessionKnown || (state.signedIn && !state.accountsResolved) ? undefined : eno;
  if (key === imageAccount) return;
  imageAccount = key;
  const revision = ++imageRevision;
  hideBattlerImages();
  if (key === undefined) return;
  if (!eno) { showBattlerImages({}, revision); return; }
  void (async () => {
    try {
      const storage = createOnlinePlayerStorage(await getSupabaseClient());
      const result = await storage.load();
      if (revision !== imageRevision) return;
      showBattlerImages(result.ok && result.account.eno === eno ? result.data.presentation.battler : {}, revision);
    } catch {
      if (revision === imageRevision) showBattlerImages({}, revision);
    }
  })();
}

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
  const messages = mountIndexMessages(document, getSupabaseClient);
  controller.beforeLogout?.(() => messages.canLeave());
  const logout = document.getElementById("home-logout");
  logout.addEventListener("click", () => controller.logout());
  controller.subscribe(state => {
    try {
      const known = state.ready && state.sessionKnown;
      document.getElementById("home-guest").hidden = !known || state.signedIn;
      document.getElementById("home-game").hidden = !known || !state.signedIn;
      document.getElementById("home-status").textContent = !known ? (state.ready ? "認証機能を読み込めませんでした。通信状況を確認して再読み込みしてください。" : "")
        : state.signedIn ? menuModel(state).identity : "ログイン、または新規登録してはじめましょう。";
      const feedback = document.getElementById("home-feedback");
      feedback.textContent = state.registeredEno ? "登録済みのENo：" + state.registeredEno + "。ENoを控えてください。" : state.messageSource === "logout" ? state.message : "";
      document.getElementById("home-identity").textContent = known && state.signedIn ? menuModel(state).identity : "";
      logout.disabled = !known || !state.signedIn || !!state.busy;
      updateBattlerImages(state);
      messages.update(state);
      if (known || state.ready) finishPageLoad();
    } catch {
      document.getElementById("home-status").textContent = "認証機能を読み込めませんでした。通信状況を確認して再読み込みしてください。";
      finishPageLoad();
    }
  });
} catch {
  document.getElementById("home-status").textContent = "認証機能を読み込めませんでした。通信状況を確認して再読み込みしてください。";
  finishPageLoad();
}
