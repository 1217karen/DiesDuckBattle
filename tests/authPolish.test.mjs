import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createAuthController } from "../js/authController.js";
import { menuModel } from "../js/commonMenuModel.js";
import { authMarkup } from "../js/authMarkup.js";
import { registrationInput, authMessages, createAuthService } from "../js/authService.js";
import { registrationPasswordError } from "../supabase/functions/_shared/registration-password.mjs";
import { registerAccount } from "../supabase/functions/_shared/registration.mjs";
import { createRegistrationHandler } from "../supabase/functions/_shared/registration-handler.mjs";

const cases = [
  ["a1234", "password_too_short"], ["a1😀😀😀", "password_too_short"],
  ["abcdef", "password_alphanumeric_required"], ["123456", "password_alphanumeric_required"],
  ["Ａ１２３４５", "password_alphanumeric_required"], ["      ", "password_alphanumeric_required"],
  ["abc123", null], ["ABC123", null], ["a1!@#$", null], ["a1😀😀😀😀", null],
  [" a1   ", null], ["a1あいうえ", null],
];
for (const [password, expected] of cases) test("shared password boundary: " + JSON.stringify(password), async () => {
  assert.equal(registrationPasswordError(password), expected);
  const input = { characterName: "name", password, confirmation: password };
  const browser = registrationInput(input);
  if (!expected) { assert.equal(browser.ok, true); assert.equal(browser.body.password, password); return; }
  assert.equal(browser.message, authMessages[expected]);
  assert.deepEqual(await registerAccount(input, {
    client: new Proxy({}, { get() { assert.fail("DB/Auth must not be touched"); } }),
    uuid() { assert.fail("UUID must not be allocated"); },
  }), { status: 400, body: { ok: false, error: expected } });
  const handler = createRegistrationHandler({ createAdminClient() { assert.fail("Admin initialization forbidden"); } });
  const response = await handler(new Request("https://example.invalid", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }));
  assert.equal(response.status, 400); assert.equal((await response.json()).error, expected);
});
test("server character requirement has a specific Japanese message", async () => {
  const service = createAuthService({ config: { url: "https://example.invalid", publishableKey: "public" },
    fetchImpl: async () => Response.json({ ok: false, error: "password_alphanumeric_required" }, { status: 400 }) });
  const response = await service.register({ characterName: "name", password: "abc123", confirmation: "abc123" });
  assert.equal(response.message, authMessages.password_alphanumeric_required);
});

// Run the real view and INDEX handlers with a minimal DOM; no SDK/network/account creation.
const source = async name => (await readFile(new URL("../js/" + name + ".js", import.meta.url), "utf8"))
  .replace(/^import .*;\r?\n/gm, "").replace("export function mountAuthView", "function mountAuthView");
async function screen({ standalone = false } = {}) {
  const elements = new Map(), copied = [];
  let last, succeed = false, nextEno = "77";
  const document = { focused: null, getElementById: id => get(id), querySelectorAll: () => buttons,
    createElement: () => element() };
  function element(id = "") {
    return { id, value: "", textContent: "", hidden: false, disabled: false, dataset: {}, handlers: {}, children: [],
      setAttribute() {}, addEventListener(event, fn) { this.handlers[event] = fn; },
      focus() { document.focused = this; }, replaceChildren(...children) { this.children = children; },
      getClientRects() { return (id.startsWith("opener") && get("home-guest").hidden) ? [] : [1]; },
      querySelector(selector) { return selector.startsWith("#") ? get(selector.slice(1)) : element(); },
      querySelectorAll(selector) { return selector.includes("password") ? passwords : []; },
      showModal() { this.open = true; }, close() { this.open = false; this.handlers.close?.(); },
    };
  }
  function get(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); }
  const buttons = [get("opener-login"), get("opener-register")];
  buttons[0].dataset.authMode = "login"; buttons[1].dataset.authMode = "register";
  const passwords = [get("register-password"), get("confirm-password"), get("login-password")];
  const controller = createAuthController({
    watch: () => () => {}, session: async () => null,
    accounts: async () => [{ eno: "88", name: "DB名" }],
    register: async () => ({ ok: true, eno: nextEno }),
    login: async () => succeed ? { ok: true, session: { user: { id: "other-auth" } } }
      : { ok: false, message: "ENoまたはパスワードを確認してください。" }, logout: async () => {},
  }, state => { last = state; });
  await controller.start();
  const context = { document, window: { addEventListener() {} }, navigator: { clipboard: { writeText: async v => copied.push(v) } },
    authMarkup, menuModel, getAuthRuntime: async () => controller, controller };
  const code = await source("authView") + (standalone ? '\nmountAuthView(document.getElementById("auth-root"), controller);' : await source("indexPage"));
  await vm.runInNewContext("(async()=>{" + code + "})()", context);
  const submit = async id => get(id).onsubmit({ preventDefault() {} });
  return { get, buttons, controller, copied, submit, focused: () => document.focused, state: () => last,
    succeed: () => { succeed = true; }, next: eno => { nextEno = eno; } };
}

test("registration stays visible; failed login keeps panel and dialog; successful other ENo clears all derivatives", async () => {
  const s = await screen(); s.buttons[1].handlers.click();
  await s.submit("register-form");
  assert.equal(s.get("auth-dialog").open, true);
  assert.equal(s.get("registered").hidden, false); assert.match(s.get("home-feedback").textContent, /77/);
  s.get("go-login").onclick(); assert.equal(s.get("login-eno").value, "77");
  await s.get("copy-eno").onclick(); assert.deepEqual(s.copied, ["77"]);
  await s.submit("login-form");
  assert.equal(s.get("auth-dialog").open, true); assert.equal(s.state().registeredEno, "77");
  assert.match(s.get("form-message").textContent, /確認/);
  s.get("login-eno").value = "88"; s.get("login-password").value = "password-is-not-retained";
  s.succeed(); await s.submit("login-form");
  assert.equal(s.get("auth-dialog").open, false); assert.equal(s.state().registeredEno, "");
  assert.equal(s.get("registered").hidden, true); assert.equal(s.get("registered-eno").textContent, "");
  assert.equal(s.get("copy-status").textContent, ""); assert.doesNotMatch(s.get("home-feedback").textContent, /77/);
  assert.match(s.get("home-status").textContent, /ENo.88｜DB名/);
  assert.equal(s.get("login-password").value, "");
  // Hidden controls must no longer retain the previous copy/handoff target.
  await s.get("copy-eno").onclick(); assert.equal(s.copied.at(-1), "");
  s.get("go-login").onclick(); assert.equal(s.get("login-eno").value, "");
  await s.controller.logout(); s.next("99"); s.buttons[1].handlers.click(); await s.submit("register-form");
  assert.equal(s.get("auth-dialog").open, true); assert.equal(s.get("registered").hidden, false);
  assert.match(s.get("registered-eno").textContent, /99/); assert.match(s.get("home-feedback").textContent, /99/);
  await s.get("copy-eno").onclick(); s.get("go-login").onclick(); s.next("100");
  await s.submit("register-form");
  assert.equal(s.get("login-eno").value, ""); assert.equal(s.get("copy-status").textContent, "");
  assert.match(s.get("registered-eno").textContent, /100/);
});

test("success callback closes only INDEX modal and focuses visible status", async () => {
  const s = await screen(); s.buttons[0].handlers.click(); s.succeed();
  await s.submit("login-form");
  assert.equal(s.get("auth-dialog").open, false);
  assert.equal(s.focused(), s.get("home-status"));
  // A fresh modal then manual close still follows the opener/password cleanup path.
  await s.controller.logout(); s.buttons[0].handlers.click(); s.get("login-password").value = "secret";
  s.get("auth-close").handlers.click(); assert.equal(s.get("login-password").value, "");
  assert.equal(s.get("auth-dialog").open, false);
  assert.equal(s.focused(), s.buttons[0]);
});

test("standalone form needs no dialog; successful login clears prefilled registration ENo", async () => {
  const s = await screen({ standalone: true }); await s.submit("register-form");
  s.get("go-login").onclick(); s.succeed(); await s.submit("login-form");
  assert.equal(s.get("registered").hidden, true); assert.equal(s.get("login-eno").value, "");
  assert.equal(s.state().registeredEno, "");
});
