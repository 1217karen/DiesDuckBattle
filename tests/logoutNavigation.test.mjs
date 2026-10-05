import { displayCache } from "../js/authDisplayCache.js";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createAuthController } from "../js/authController.js";
import { requireLoginPage } from "../js/authPageGuard.js";
import { consumeIndexNotice } from "../js/indexNotice.js";
import { menuModel } from "../js/commonMenuModel.js";

const menuCode = (await readFile(new URL("../js/commonMenu.js", import.meta.url), "utf8")).replace(/^import .*;\r?\n/gm, "");
async function screen(page, { guardFirst = false } = {}) {
  const redirects = [], notifications = [], classes = new Set(), nodes = new Map();
  let watch, state, accepted = true, fail = false, calls = 0, duringLogout = async () => {};
  class Element {
    constructor(tag = "div") { this.tagName = tag; this.children = []; this.handlers = {}; this.isConnected = true; }
    setAttribute(key, value) { this[key] = value; }
    removeAttribute(key) { delete this[key]; }
    addEventListener(event, fn) { this.handlers[event] = fn; }
    replaceChildren(...children) { this.children.forEach(node => { node.isConnected = false; }); this.children = children; }
    append(node) { this.children.push(node); }
    focus() {}
  }
  for (const selector of ["details", "summary", "nav", "[data-identity]", "[data-feedback]", ".common-menu__nav", ".common-menu__account", "[data-account-menu]", "[data-account-arrow]", "account-summary"]) nodes.set(selector, new Element());
  nodes.set(".common-menu__nav", nodes.get("details"));
  nodes.get(".common-menu__nav").querySelector = () => nodes.get("summary");
  nodes.get(".common-menu__account").querySelector = () => nodes.get("account-summary");
  const root = new Element();
  root.querySelector = selector => selector === "[data-account-menu] button" ? nodes.get("[data-account-menu]").children.find(node => node.tagName === "button") : nodes.get(selector);
  const document = {
    getElementById: () => root, createElement: tag => new Element(tag), addEventListener() {},
    body: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } },
  };
  const location = { replace: url => redirects.push(url) };
  const auth = createAuthController({
    watch(fn) { watch = fn; return () => {}; }, session: async () => ({ user: { id: "user" } }),
    accounts: async () => [{ eno: "7", name: "name" }],
    logout: async () => { calls++; if (fail) throw new Error("network"); await duringLogout(); },
  }, next => { state = next; }, message => notifications.push(message));
  await auth.start();
  auth.beforeLogout(async () => accepted);
  const protectedPage = ["select", "setting", "character"].includes(page);
  const guard = () => requireLoginPage({ getRuntime: async () => auth, document, location });
  if (protectedPage && guardFirst) await guard();
  await vm.runInNewContext(`(async()=>{${menuCode}})()`, { document, location, menuModel, displayCache, getAuthRuntime: async () => auth });
  if (protectedPage && !guardFirst) await guard();
  return { auth, redirects, notifications, classes, state: () => state, calls: () => calls,
    feedback: () => nodes.get("[data-feedback]"),
    click: () => root.querySelector("[data-account-menu] button").handlers.click(), external: () => watch(null),
    accept: value => { accepted = value; }, fail: value => { fail = value; },
    during: fn => { duringLogout = fn; } };
}

for (const page of ["index", "storage", "auth", "select", "setting", "character"]) {
  for (const guardFirst of [false, true]) {
    if (guardFirst && !["select", "setting", "character"].includes(page)) continue;
    test(`${page}: actual menu logout replaces with notice after success, regardless of guard subscription order (${guardFirst})`, async () => {
      const s = await screen(page, { guardFirst });
      let finish;
      s.during(async () => {
        s.external(); // Model Supabase's SIGNED_OUT event arriving before signOut resolves.
        await new Promise(resolve => { finish = resolve; });
      });
      const logout = s.click();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(s.state().signedIn, false); assert.equal(s.state().busy, "logout");
      assert.deepEqual(s.redirects, []); assert.deepEqual(s.notifications, []);
      finish(); await logout;
      assert.ok(s.redirects.length > 0);
      assert.ok(s.redirects.every(url => url === "index.html?notice=logged-out"));
      assert.deepEqual(s.notifications, []); assert.equal(s.state().logoutSucceeded, true);
      const notices = [], urlChanges = [];
      consumeIndexNotice({ location: { href: new URL(s.redirects[0], "https://example.test/").href },
        history: { state: null, replaceState(_state, _title, url) { urlChanges.push(url); } }, toast: value => notices.push(value) });
      assert.deepEqual(notices, [{ kind: "success", message: "ログアウトしました。" }]);
      assert.deepEqual(urlChanges, ["/index.html"]);
    });
  }
}

for (const page of ["index", "storage", "select", "setting", "character"]) {
  test(`${page}: cancelled logout and failed logout preserve signed-in state, page and feedback without success toast`, async () => {
    const s = await screen(page);
    s.accept(false); await s.click();
    assert.equal(s.calls(), 0); assert.equal(s.state().signedIn, true);
    assert.deepEqual(s.redirects, []); assert.deepEqual(s.notifications, []);
    s.accept(true); s.fail(true); await s.click();
    assert.equal(s.calls(), 1); assert.equal(s.state().signedIn, true);
    assert.equal(s.state().logoutSucceeded, false);
    assert.deepEqual(s.redirects, []); assert.deepEqual(s.notifications, []);
    assert.match(s.feedback().textContent, /ログアウトできませんでした/);
  });
}

for (const page of ["select", "setting", "character"]) {
  test(`${page}: external sign-out after cancelled/failed action ignores stale messageSource`, async () => {
    const s = await screen(page); s.accept(false); await s.click();
    s.accept(true); s.fail(true); await s.click();
    assert.equal(s.state().messageSource, "logout");
    s.external();
    assert.deepEqual(s.redirects, ["index.html"]); assert.deepEqual(s.notifications, []);
  });
}

test("public page external sign-out does not claim local logout success", async () => {
  const s = await screen("storage"); s.external();
  assert.deepEqual(s.redirects, []); assert.deepEqual(s.notifications, []);
});

test("a sign-out event during an unsuccessful logout never gets a success notice", async () => {
  const s = await screen("setting");
  s.during(async () => { s.external(); throw new Error("logout outcome failed"); });
  await s.click();
  assert.deepEqual(s.redirects, ["index.html"]); assert.equal(s.state().logoutSucceeded, false);
  assert.deepEqual(s.notifications, []);
});
