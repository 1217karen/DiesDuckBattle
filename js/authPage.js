import { supabasePublicConfig } from "./supabasePublicConfig.js";
import { createAuthService } from "./authService.js";
import { createAuthController } from "./authController.js";

const byId = id => document.getElementById(id);
const passwords = () => document.querySelectorAll('input[type="password"]');
let registeredEno = "", controller;
function switchForm(mode) {
  passwords().forEach(input => { input.value = ""; });
  for (const name of ["register", "login"]) {
    byId(name + "-form").hidden = name !== mode;
    byId("show-" + name).setAttribute("aria-pressed", String(name === mode));
  }
}
function render(state) {
  const disabled = !state.ready || !!state.busy;
  document.querySelectorAll("fieldset").forEach(el => { el.disabled = disabled; });
  for (const name of ["register", "login"]) {
    byId("show-" + name).disabled = disabled;
    byId(name + "-form").setAttribute("aria-busy", String(state.busy === name));
    byId(name + "-form").querySelector('button[type="submit"]').textContent =
      state.busy === name ? "送信中…" : name === "register" ? "登録する" : "ログインする";
  }
  byId("logout").hidden = !state.signedIn;
  byId("logout").disabled = disabled;
  byId("go-login").disabled = disabled;
  byId("session-message").textContent = state.sessionMessage;
  byId("current-eno").hidden = state.enos.length !== 1;
  byId("current-eno").textContent = state.enos.length === 1 ? "ENo." + state.enos[0] : "";
  byId("account-list").replaceChildren(...state.enos.map(eno => {
    const item = document.createElement("li"); item.textContent = "ENo." + eno; return item;
  }));
  byId("account-list").hidden = state.enos.length <= 1;
  byId("form-message").textContent = state.message;
  if (state.registeredEno) {
    const newlyRegistered = registeredEno !== state.registeredEno;
    registeredEno = state.registeredEno;
    byId("registered").hidden = false;
    byId("registered-eno").textContent = "ENo." + registeredEno;
    if (newlyRegistered) byId("registered").focus();
  }
}
byId("show-register").onclick = () => switchForm("register");
byId("show-login").onclick = () => switchForm("login");
byId("go-login").onclick = () => {
  switchForm("login"); byId("login-eno").value = registeredEno; byId("login-eno").focus();
};
byId("copy-eno").onclick = async () => {
  try { await navigator.clipboard.writeText(registeredEno); byId("copy-status").textContent = "ENoをコピーしました。"; }
  catch { byId("copy-status").textContent = "コピーできませんでした。表示されたENoを手動で控えてください。"; }
};
byId("register-form").onsubmit = async event => {
  event.preventDefault();
  const input = { characterName: byId("character-name").value,
    password: byId("register-password").value, confirmation: byId("confirm-password").value };
  passwords().forEach(el => { el.value = ""; });
  await controller?.register(input);
};
byId("login-form").onsubmit = async event => {
  event.preventDefault();
  const password = byId("login-password").value;
  passwords().forEach(el => { el.value = ""; });
  await controller?.login(byId("login-eno").value, password);
};
byId("logout").onclick = () => { passwords().forEach(el => { el.value = ""; }); void controller?.logout(); };
window.addEventListener("pagehide", () => { passwords().forEach(el => { el.value = ""; }); });
try {
  // Exact version, browser ESM. No build tool or server modules are imported.
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.117.2?bundle");
  const client = createClient(supabasePublicConfig.url, supabasePublicConfig.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
      storageKey: "diesduck-auth-session" },
  });
  controller = createAuthController(createAuthService({ client, config: supabasePublicConfig }), render);
  await controller.start();
} catch {
  byId("session-message").textContent = "認証機能を読み込めませんでした。通信状況を確認して再読み込みしてください。";
}
