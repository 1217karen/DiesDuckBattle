import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, readdir } from "node:fs/promises";
import { displayCache } from "../js/authDisplayCache.js";
import { createAuthController } from "../js/authController.js";
import { requireLoginPage } from "../js/authPageGuard.js";
import { menuModel } from "../js/commonMenuModel.js";
const source = file => readFile(new URL("../" + file, import.meta.url), "utf8");
const bootstrap = await source("js/menuDisplayCache.js");
const menuCode = (await source("js/commonMenu.js")).replace(/^import .*;\r?\n/gm, "");
const key = "diesduck-menu-display-v1";
const signedCache = { version: 1, loggedIn: true, identity: "ENo.12｜Alice" };
const tick = () => new Promise(resolve => setImmediate(resolve));
function storage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key, next) => { value = next; }, removeItem: () => { value = null; } };
}
function useStorage(t, value = null) {
  const old = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const store = storage(value);
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: store });
  t.after(() => { if (old) Object.defineProperty(globalThis, "sessionStorage", old); else delete globalThis.sessionStorage; });
  return store;
}
function dom() {
  class Element {
    constructor(tag) { this.tagName = tag; this.textContent = ""; this.children = []; this.handlers = {}; this.replacements = 0; this.isConnected = true; }
    set innerHTML(_) { assert.fail("header must never be regenerated"); }
    setAttribute(key, value) { this[key] = value; }
    removeAttribute(key) { delete this[key]; }
    addEventListener(event, fn) { this.handlers[event] = fn; }
    replaceChildren(...children) { this.replacements++; this.children = children; }
    append(node) { this.children.push(node); }
    focus() {}
  }
  const nodes = new Map(["details", "summary", "nav", "[data-identity]", "[data-feedback]", ".common-menu__nav", ".common-menu__account", "[data-account-menu]", "[data-account-arrow]", "account-summary"].map(s => [s, new Element(s)]));
  nodes.set(".common-menu__nav", nodes.get("details"));
  nodes.get(".common-menu__nav").querySelector = () => nodes.get("summary");
  nodes.get(".common-menu__account").querySelector = () => nodes.get("account-summary");
  const root = new Element("header");
  root.querySelector = s => s === "[data-account-menu] button" ? nodes.get("[data-account-menu]").children.find(n => n.tagName === "button") : nodes.get(s);
  return { root, nodes, document: { getElementById: () => root, createElement: tag => new Element(tag), addEventListener() {} } };
}
for (const raw of [null, "{", "null", "[]", "{}", JSON.stringify({ ...signedCache, version: 2 }), JSON.stringify({ ...signedCache, loggedIn: "true" }), JSON.stringify({ ...signedCache, identity: 12 }), JSON.stringify({ ...signedCache, access_token: "secret" })]) {
  test("cache/bootstrap ignores absent or invalid schema: " + raw, () => {
    const d = dom(), context = { document: d.document, sessionStorage: storage(raw) };
    vm.runInNewContext(bootstrap, context);
    assert.equal(context.diesDuckMenuDisplayCache.read(), null);
    assert.equal(d.nodes.get("[data-identity]").textContent, "");
  });
}
test("cache bootstrap uses textContent before any Auth/SDK load; writes whitelist only", t => {
  const value = { ...signedCache, identity: "ENo.12｜<img src=x onerror=alert(1)>" };
  const d = dom();
  vm.runInNewContext(bootstrap, { document: d.document, sessionStorage: storage(JSON.stringify(value)) });
  assert.equal(d.nodes.get("[data-identity]").textContent, value.identity);
  const store = useStorage(t);
  displayCache.write({ ...value, access_token: "secret", user: { id: "uuid" } });
  assert.deepEqual(JSON.parse(store.getItem(key)), value);
});
test("blocked storage getter/read/write/delete never breaks page", () => {
  const context = { document: dom().document };
  Object.defineProperty(context, "sessionStorage", { get() { throw Error("blocked"); } });
  vm.runInNewContext(bootstrap, context);
  assert.equal(context.diesDuckMenuDisplayCache.read(), null);
  context.diesDuckMenuDisplayCache.write(signedCache);
  context.diesDuckMenuDisplayCache.clear();
  for (const operation of ["getItem", "setItem", "removeItem"]) {
    const store = storage(); store[operation] = () => { throw Error("blocked"); };
    const ctx = { sessionStorage: store };
    vm.runInNewContext(bootstrap, ctx);
    ctx.diesDuckMenuDisplayCache.read(); ctx.diesDuckMenuDisplayCache.write(signedCache); ctx.diesDuckMenuDisplayCache.clear();
  }
});
function controllerFixture(session = { user: { id: "real-user" } }) {
  let watch, state, count = 0, restore = async () => session, fetch = async () => [{ eno: "12", name: "Alice" }];
  const states = [];
  const auth = createAuthController({
    watch: fn => { watch = fn; return () => {}; }, session: () => restore(),
    accounts: s => { count++; return fetch(s); }, logout: async () => {}, login: async () => ({ ok: true, session }),
  }, s => { state = s; states.push(s); });
  return { auth, states, state: () => state, count: () => count, fire: (s = session, event = "SIGNED_IN") => watch(s, event),
    fetch: fn => { fetch = fn; }, restore: fn => { restore = fn; }, session };
}
for (const first of ["watch", "restore"]) test("initial restore/INITIAL_SESSION dedupe while in flight and completed: " + first, async t => {
  useStorage(t);
  const f = controllerFixture(); let resolveAccounts, resolveSession;
  f.fetch(() => new Promise(resolve => { resolveAccounts = resolve; }));
  if (first === "watch") f.restore(() => new Promise(resolve => { resolveSession = resolve; }));
  const starting = f.auth.start();
  if (first === "watch") { f.fire(f.session, "INITIAL_SESSION"); resolveSession(f.session); }
  await tick();
  f.fire(f.session, "INITIAL_SESSION"); f.fire(f.session, "SIGNED_IN");
  assert.equal(f.count(), 1);
  resolveAccounts([{ eno: "12", name: "Alice" }]); await starting;
  const emissions = f.states.length;
  for (const event of ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"]) f.fire({ ...f.session, access_token: "new-token" }, event);
  await tick();
  assert.equal(f.count(), 1); assert.equal(f.states.length, emissions);
  assert.equal(f.state().accounts[0].name, "Alice");
  assert.deepEqual(displayCache.read(), signedCache);
});
test("background accounts update retains identity and writes changed Battler name; late results after sign-out cannot restore cache", async t => {
  useStorage(t);
  const f = controllerFixture(); await f.auth.start();
  let finish;
  f.fetch(() => new Promise(resolve => { finish = resolve; }));
  f.fire(f.session, "USER_UPDATED");
  assert.equal(menuModel(f.state()).identity, signedCache.identity);
  f.fire(f.session, "TOKEN_REFRESHED"); assert.equal(f.count(), 2);
  finish([{ eno: "12", name: "Bob" }]); await tick();
  assert.equal(displayCache.read().identity, "ENo.12｜Bob");
  f.fire(f.session, "USER_UPDATED"); f.fire(null, "SIGNED_OUT");
  assert.equal(displayCache.read(), null);
  finish([{ eno: "12", name: "Late" }]); await tick();
  assert.equal(f.state().signedIn, false); assert.deepEqual(f.state().accounts, []); assert.equal(displayCache.read(), null);
});
test("login populates cache only after accounts success and successful logout clears without SDK event", async t => {
  useStorage(t);
  const f = controllerFixture(); f.restore(async () => null); await f.auth.start();
  await f.auth.login("12", "password"); assert.deepEqual(displayCache.read(), signedCache);
  await f.auth.logout(); assert.equal(displayCache.read(), null);
});
test("changed runtime user does not reuse previous accounts; old in-flight fetch cannot win", async t => {
  useStorage(t); const f = controllerFixture(); let finish;
  f.fetch(() => new Promise(resolve => { finish = resolve; }));
  const start = f.auth.start(); await tick();
  f.fetch(async () => [{ eno: "22", name: "Other" }]);
  f.fire({ user: { id: "other-user" } }); await tick();
  finish([{ eno: "12", name: "Old" }]); await start;
  assert.equal(f.state().accounts[0].eno, "22"); assert.equal(displayCache.read().identity, "ENo.22｜Other");
});
test("forged display cache cannot admit guard or initialize private data with null real session", async t => {
  useStorage(t, JSON.stringify({ ...signedCache, identity: "ENo.999｜偽物" }));
  const f = controllerFixture(null), classes = new Set(), redirects = []; let initialized = false;
  const guarded = requireLoginPage({ getRuntime: async () => f.auth,
    document: { body: { classList: { add: x => classes.add(x), remove: x => classes.delete(x) } } },
    location: { replace: url => redirects.push(url) },
  }).then(() => { initialized = true; });
  const rejected = assert.rejects(guarded, /Login required/);
  await f.auth.start(); await rejected;
  assert.equal(initialized, false); assert.equal(f.count(), 0);
  assert.deepEqual(redirects, ["index.html?notice=login-required"]); assert.equal(displayCache.read(), null);
});
for (const cached of [null, signedCache]) test("actual menu retains header/nav/summary/links through restore, refresh and name update: " + !!cached, async () => {
  const d = dom(); let render, resolveRuntime;
  const controller = { subscribe: fn => { render = fn; }, logout() {} };
  const running = vm.runInNewContext(`(async()=>{${menuCode}})()`, { document: d.document, location: { replace() {} }, menuModel,
    displayCache: { read: () => cached }, getAuthRuntime: () => new Promise(resolve => { resolveRuntime = resolve; }) });
  assert.equal(d.nodes.get("[data-identity]").textContent, cached?.identity ?? "");
  resolveRuntime(controller); await running;
  const initial = { sessionKnown: false, ready: false, accounts: [], enos: [], signedIn: false };
  render(initial); assert.equal(d.nodes.get("[data-identity]").textContent, cached?.identity ?? "");
  const pending = { ...initial, sessionKnown: true, signedIn: true };
  render(pending); assert.equal(d.nodes.get("[data-identity]").textContent, cached?.identity ?? "");
  const confirmed = { ...pending, ready: true, accountsResolved: true, accounts: [{ eno: "12", name: "Alice" }] };
  render(confirmed);
  const children = [...d.nodes.get("nav").children], replacements = d.nodes.get("nav").replacements;
  render(confirmed); render({ ...confirmed, accounts: [{ eno: "12", name: "Bob" }] });
  assert.equal(d.nodes.get("[data-identity]").textContent, "ENo.12｜Bob");
  assert.equal(d.nodes.get("nav").replacements, replacements);
  assert.deepEqual(d.nodes.get("nav").children, children);
  if (cached) assert.equal(replacements, 1);
  render({ ...confirmed, signedIn: false, accounts: [] });
  assert.equal(d.nodes.get("[data-identity]").textContent, "未ログイン");
});
test("every common-menu HTML has identical prebuilt shell and early cache bootstrap; protected shells visible initially", async () => {
  let expected, count = 0;
  for (const page of await readdir(new URL("../", import.meta.url))) {
    if (!page.endsWith(".html")) continue;
    const html = await source(page);
    if (!html.includes('id="common-menu"')) continue;
    const header = html.match(/<header id="common-menu"[\s\S]*?<\/header>/)[0];
    expected ??= header; assert.equal(header, expected); count++;
    assert.match(header, /<details class="common-menu__nav"><summary aria-label="ゲームメニューを開く">/);
    assert.match(header, /<details class="common-menu__account">/);
    assert.match(header, /data-account-menu/);
    assert.doesNotMatch(header, /common-menu__label|>メニュー</); assert.match(header, /<nav /);
    assert.doesNotMatch(html, /ログイン状態を確認中…|auth-required-pending/);
    assert.ok(html.indexOf('src="js/menuDisplayCache.js"') < html.indexOf('src="js/commonMenu.js"'));
  }
  assert.equal(count, 9);
});

test("getSession failure cannot discard successful INITIAL_SESSION; synchronous initial event wins over stale restore", async t => {
  useStorage(t);
  for (const fails of [false, true]) {
    let state, restores = 0;
    const session = { user: { id: "real" } };
    const auth = createAuthController({
      watch(fn) { fn(session, "INITIAL_SESSION"); return () => {}; },
      async session() { restores++; if (fails) throw Error("restore failed"); return null; },
      accounts: async () => [{ eno: "12", name: "Alice" }],
    }, s => { state = s; });
    await auth.start(); await tick();
    assert.equal(restores, 1); assert.equal(state.signedIn, true); assert.equal(state.accounts[0].name, "Alice");
  }
});

test("failed background accounts request preserves established accounts and cache", async t => {
  useStorage(t); const f = controllerFixture(); await f.auth.start();
  f.fetch(async () => { throw Error("offline"); });
  f.fire(f.session, "USER_UPDATED"); await tick();
  assert.equal(menuModel(f.state()).identity, signedCache.identity);
  assert.deepEqual(displayCache.read(), signedCache);
});

test("cached menu survives failed first accounts fetch but confirmed empty accounts replaces stale identity", async () => {
  const d = dom(); let render;
  await vm.runInNewContext(`(async()=>{${menuCode}})()`, { document: d.document, location: { replace() {} }, menuModel,
    displayCache: { read: () => signedCache }, getAuthRuntime: async () => ({ subscribe: fn => { render = fn; } }) });
  const failed = { sessionKnown: true, ready: true, signedIn: true, accounts: [], enos: [], accountsResolved: false, sessionMessage: "ENoを取得できません" };
  render(failed); assert.equal(d.nodes.get("[data-identity]").textContent, signedCache.identity);
  render({ ...failed, accountsResolved: true, sessionMessage: "アクセスできるゲームアカウントがありません。" });
  assert.match(d.nodes.get("[data-identity]").textContent, /ありません/);
});
