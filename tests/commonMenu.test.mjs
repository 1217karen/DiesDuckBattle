import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { menuModel } from "../js/commonMenuModel.js";
import { createAuthController } from "../js/authController.js";
import { createAuthService, registrationInput, authMessages } from "../js/authService.js";
import { registerAccount } from "../supabase/functions/_shared/registration.mjs";
import { createRegistrationHandler } from "../supabase/functions/_shared/registration-handler.mjs";

const base = { ready: true, sessionKnown: true, signedIn: false, accounts: [], enos: [], sessionMessage: "" };
test("guest menu hides select/settings/character/logout but preserves public destinations", () => {
  const model = menuModel(base);
  assert.equal(model.identity, "未ログイン");
  assert.equal(model.loggedIn, false);
  assert.deepEqual(model.items.filter(x => x.href).map(x => x.href), ["index.html", "storage.html"]);
  assert.equal(model.items.filter(x => !x.href).length, 2);
});
test("signed-in menu displays exact DB name and ENo, never HTML markup", () => {
  const m = menuModel({ ...base, signedIn: true, accounts: [{ eno: "77", name: "<b>DBキャラ名</b>" }], enos: ["77"] });
  assert.equal(m.identity, "ENo.77｜<b>DBキャラ名</b>");
  assert.equal(m.items.filter(x => x.href).length, 5);
});
test("missing name, failed profile fetch, unknown session and multiple accounts have explicit states", () => {
  assert.match(menuModel({ ...base, signedIn: true, accounts: [{ eno: "77", name: null }] }).identity, /取得できません/);
  assert.match(menuModel({ ...base, signedIn: true, sessionMessage: "取得できません" }).identity, /取得できません/);
  assert.match(menuModel({ ...base, sessionKnown: false }).identity, /確認できません/);
  const multiple = menuModel({ ...base, signedIn: true, accounts: [{ eno: "77" }, { eno: "88" }], enos: ["77", "88"] });
  assert.match(multiple.identity, /ENo.77.*ENo.88.*今後実装/);
  assert.doesNotMatch(multiple.identity, /｜undefined/);
});
test("profile query obtains names from battlers through account access, missing Battler remains visible", async () => {
  const calls = [];
  const service = createAuthService({ client: { from: table => ({ select: columns => ({ eq: async (...filter) => {
    calls.push([table, columns, filter]);
    return { data: [
      { game_accounts: { eno: "88", battlers: null } },
      { game_accounts: { eno: "77", battlers: { presentation: { name: "DB名" } } } },
    ] };
  } }) }) } });
  assert.deepEqual(await service.accounts({ user: { id: "auth-not-game-id" } }), [
    { eno: "77", name: "DB名" }, { eno: "88", name: null },
  ]);
  assert.match(calls[0][1], /battlers\(presentation\)/);
  assert.deepEqual(calls[0][2], ["auth_user_id", "auth-not-game-id"]);
});
test("subscribers share restore, login and logout state, including names", async () => {
  let callback, state, menu;
  const session = { user: { id: "auth" } };
  const service = {
    watch: cb => { callback = cb; return () => {}; },
    session: async () => session,
    accounts: async () => [{ eno: "77", name: "DB名" }],
    logout: async () => {},
    login: async () => ({ ok: true, session }),
  };
  const controller = createAuthController(service, s => { state = s; });
  controller.subscribe(s => { menu = menuModel(s); });
  assert.equal(menu.identity, "");
  await controller.start(); assert.equal(menu.identity, "ENo.77｜DB名");
  await controller.logout(); assert.equal(menu.identity, "未ログイン");
  await controller.login("77", "123456"); assert.equal(state.accounts[0].name, "DB名");
  callback(null); await new Promise(r => setTimeout(r, 0)); assert.equal(menu.identity, "未ログイン");
  controller.stop();
});
for (const password of ["", "12345", "あいうえお", "😀😀😀😀😀"]) {
  test("short password rejected before client initialization, UUID allocation and INSERT: " + password.length, async () => {
    const input = { characterName: "name", password, confirmation: password };
    assert.equal(registrationInput(input).message, authMessages.password_too_short);
    const dependencies = { client: null, uuid: () => assert.fail("No UUID before validation") };
    assert.deepEqual(await registerAccount(input, dependencies), { status: 400, body: { ok: false, error: "password_too_short" } });
    const handler = createRegistrationHandler({ createAdminClient: () => assert.fail("No admin client") });
    const response = await handler(new Request("https://example.invalid", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "password_too_short");
  });
}
for (const password of ["abc123", " a1   ", "a1あいうえ", "a1😀😀😀😀"]) {
  test("six characters accepted without trimming: " + JSON.stringify(password), () => {
    const input = registrationInput({ characterName: "name", password, confirmation: password });
    assert.equal(input.ok, true); assert.equal(input.body.password, password);
  });
}
test("short password error from deployed server is displayed specifically", async () => {
  const service = createAuthService({ config: { url: "https://example.invalid", publishableKey: "public" },
    fetchImpl: async () => Response.json({ ok: false, error: "password_too_short" }, { status: 400 }) });
  const result = await service.register({ characterName: "name", password: "abc123", confirmation: "abc123" });
  assert.match(result.message, /6文字以上/);
});
test("INDEX actual handlers hide pre-restore menus and manage modal close/focus/password clearing", async () => {
  const elements = new Map();
  function el() {
    return { hidden: true, handlers: {}, dataset: {}, children: [], textContent: "", visible: true,
      addEventListener(k, f) { this.handlers[k] = f; }, focus() { document.focused = this; },
      getClientRects() { return this.visible ? [1] : []; },
      querySelector() { return input; }, replaceChildren(...children) { this.children = children; },
      setAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; this.handlers.close(); } };
  }
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, el()); return elements.get(id); },
    querySelectorAll() { return buttons; }, createElement: el };
  const input = el(), buttons = [el(), el()];
  buttons[0].dataset.authMode = "login"; buttons[1].dataset.authMode = "register";
  let render, mode, cleared = 0;
  const controller = { subscribe(fn) { render = fn; fn({ ...base, ready: false, sessionKnown: false, message: "" }); } };
  const source = (await readFile(new URL("../js/indexPage.js", import.meta.url), "utf8")).replace(/^import .*;\r?\n/gm, "");
  await vm.runInNewContext("(async()=>{" + source + "})()", {
    finishPageLoad() {}, consumeIndexNotice() {}, document, getAuthRuntime: async () => controller, menuModel,
    mountAuthView: () => ({ switchForm: value => { mode = value; }, clearPasswords: () => { cleared++; } }),
  });
  assert.equal(document.getElementById("home-guest").hidden, true);
  render({ ...base, message: "" }); assert.equal(document.getElementById("home-guest").hidden, false);
  buttons[0].handlers.click();
  const dialog = document.getElementById("auth-dialog");
  assert.equal(mode, "login"); assert.equal(dialog.open, true); assert.equal(document.focused, input);
  document.getElementById("auth-close").handlers.click();
  assert.equal(dialog.open, false); assert.equal(document.focused, buttons[0]); assert.equal(cleared, 1);
  buttons[1].handlers.click(); assert.equal(mode, "register");
  // Native dialog Escape invokes close; the same cleanup/return-focus path applies.
  dialog.close(); assert.equal(document.focused, buttons[1]);
  buttons[1].handlers.click(); buttons[1].visible = false;
  render({ ...base, signedIn: true, accounts: [{ eno: "77", name: "DB" }], enos: ["77"], message: "" });
  dialog.close(); assert.equal(document.focused, document.getElementById("home-status"));
  assert.equal(document.getElementById("home-game").hidden, false);
});
test("menu mount is restricted to requested pages and standalone auth shares the same form", async () => {
  for (const page of ["index", "auth", "select", "setting", "character", "storage"]) {
    const html = await readFile(new URL("../" + page + ".html", import.meta.url), "utf8");
    assert.match(html, /id="common-menu"/); assert.match(html, /js\/commonMenu.js/);
  }
  const result = await readFile(new URL("../result.html", import.meta.url), "utf8");
  assert.doesNotMatch(result, /commonMenu|common-menu/);
  for (const file of ["authPage", "indexPage"]) {
    assert.match(await readFile(new URL("../js/" + file + ".js", import.meta.url), "utf8"), /mountAuthView/);
  }
});
