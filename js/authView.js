import { battlerNameError } from "./nameValidation.js";
import { authMarkup } from "./authMarkup.js";

export function mountAuthView(root, controller, { onLoginSuccess = () => {},
  onRegistrationSuccess = onLoginSuccess, registrationToast = true } = {}) {
  root.innerHTML = authMarkup;
const byId = id => root.querySelector("#" + id);
const passwords = () => root.querySelectorAll('input[type="password"]');
let registeredEno = "";
const nameInput = byId("character-name");
function validateName() {
  const message = battlerNameError(nameInput.value);
  nameInput.setAttribute("aria-invalid", String(!!message));
  byId("character-name-error").textContent = message;
  byId("register-form").querySelector('button[type="submit"]').disabled = !!message;
  return !message;
}
nameInput.addEventListener("input", validateName);
function switchForm(mode) {
  passwords().forEach(input => { input.value = ""; });
  for (const name of ["register", "login"]) {
    byId(name + "-form").hidden = name !== mode;
    byId("show-" + name).setAttribute("aria-pressed", String(name === mode));
  }
}
function render(state) {
  const disabled = !state.ready || !!state.busy;
  root.querySelectorAll("fieldset").forEach(el => { el.disabled = disabled; });
  for (const name of ["register", "login"]) {
    byId("show-" + name).disabled = disabled;
    byId(name + "-form").setAttribute("aria-busy", String(state.busy === name));
    byId(name + "-form").querySelector('button[type="submit"]').textContent =
      state.busy === name ? "送信中…" : name === "register" ? "登録する" : "ログインする";
  }
  validateName();
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
  // 表示上の区別のみ。登録済みENoの案内はエラーとして扱わない。
  byId("form-message").dataset.kind = state.message && !state.busy &&
    (state.messageSource === "login" || state.messageSource === "logout" ||
      (state.messageSource === "register" && !state.registeredEno)) ? "error" : "";
  if (!state.registeredEno) {
    // Clear every derivative of the old registration ENo, including handoff input.
    if (registeredEno && byId("login-eno").value === registeredEno) byId("login-eno").value = "";
    registeredEno = "";
    byId("registered").hidden = true;
    byId("registered-eno").textContent = "";
    byId("copy-status").textContent = "";
  } else {
    const newlyRegistered = registeredEno !== state.registeredEno;
    if (newlyRegistered) {
      if (registeredEno && byId("login-eno").value === registeredEno) byId("login-eno").value = "";
      byId("copy-status").textContent = "";
    }
    registeredEno = state.registeredEno;
    byId("registered").hidden = false;
    byId("registered-eno").textContent = "ENo." + registeredEno;
    if (newlyRegistered && root.getClientRects().length) byId("registered").focus();
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
  if (!validateName()) return;
  const consent = byId("terms-consent");
  if (!consent.checked) {
    consent.reportValidity();
    consent.focus();
    return;
  }
  const input = { characterName: byId("character-name").value,
    password: byId("register-password").value, confirmation: byId("confirm-password").value };
  passwords().forEach(el => { el.value = ""; });
  const result = await controller?.register(input, { notify: registrationToast });
  if (result?.ok) consent.checked = false;
  if (result?.ok && result.signedIn) onRegistrationSuccess(result);
};
byId("login-form").onsubmit = async event => {
  event.preventDefault();
  const password = byId("login-password").value;
  passwords().forEach(el => { el.value = ""; });
  const result = await controller?.login(byId("login-eno").value, password);
  if (result?.ok) onLoginSuccess();
};
byId("logout").onclick = () => { passwords().forEach(el => { el.value = ""; }); void controller?.logout(); };
window.addEventListener("pagehide", () => { passwords().forEach(el => { el.value = ""; }); });
const unsubscribe = controller.subscribe(render);
return { switchForm, clearPasswords: () => passwords().forEach(el => { el.value = ""; }), destroy: unsubscribe };
}
