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
function showBattlerImages(battler = {}) {
  setImageFromCandidates(standing, [battler.standingImageUrl], FIXED_IMAGES.battlerStanding);
  setImageFromCandidates(icon, [battler.defaultIconUrl], FIXED_IMAGES.battlerIcon);
}
showBattlerImages();
let imageAccount = null, imageRevision = 0;
function updateBattlerImages(state) {
  const account = state.ready ? menuModel(state).currentAccount : null;
  const eno = account?.eno ?? null;
  if (eno === imageAccount) return;
  imageAccount = eno;
  const revision = ++imageRevision;
  showBattlerImages();
  if (!eno) return;
  void (async () => {
    try {
      const storage = createOnlinePlayerStorage(await getSupabaseClient());
      const result = await storage.load();
      if (revision === imageRevision && result.ok && result.account.eno === eno) {
        showBattlerImages(result.data.presentation.battler);
      }
    } catch { /* Keep the existing fixed images when online data is unavailable. */ }
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
