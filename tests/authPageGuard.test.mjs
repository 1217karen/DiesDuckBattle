import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, readdir } from "node:fs/promises";
import { requireLoginPage } from "../js/authPageGuard.js";
import { consumeIndexNotice } from "../js/indexNotice.js";
import { createAuthController } from "../js/authController.js";

const source = name => readFile(new URL(`../js/${name}.js`, import.meta.url), "utf8");
function environment() {
  const classes = new Set(["auth-required-pending"]), redirects = [];
  return { classes, redirects,
    document: { body: { classList: { add: v => classes.add(v), remove: v => classes.delete(v) } } },
    location: { replace: url => redirects.push(url) } };
}
const loading = { ready: false, sessionKnown: false, signedIn: false };
const signedIn = { ready: false, sessionKnown: true, signedIn: true };
const signedOut = { ready: true, sessionKnown: true, signedIn: false };
function runtime(initial = loading) {
  let listener, disposed = 0;
  return { auth: { subscribe(fn) { listener = fn; fn(initial); return () => { disposed++; }; } },
    emit: state => listener(state), disposed: () => disposed };
}

test("loading stays hidden and unresolved; confirmed signed-in admits and reveals; signed-out redirects once", async () => {
  const env = environment(), r = runtime(); let allowed = false;
  const pending = requireLoginPage({ ...env, getRuntime: async () => r.auth }).then(() => { allowed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(allowed, false); assert.ok(env.classes.has("auth-required-pending"));
  assert.deepEqual(env.redirects, []);
  r.emit(signedIn); await pending;
  assert.equal(allowed, true); assert.equal(env.classes.has("auth-required-pending"), false);
  r.emit(signedOut); r.emit(signedOut);
  assert.deepEqual(env.redirects, ["index.html"]); assert.equal(r.disposed(), 1);
  assert.ok(env.classes.has("auth-required-pending"));
});

test("initial signed-out replaces with fixed notice and never admits", async () => {
  const env = environment(), r = runtime(signedOut);
  await assert.rejects(requireLoginPage({ ...env, getRuntime: async () => r.auth }), /Login required/);
  assert.deepEqual(env.redirects, ["index.html?notice=login-required"]);
  assert.ok(env.classes.has("auth-required-pending")); assert.equal(r.disposed(), 1);
});

test("runtime rejection and controller restore failure both fail closed", async () => {
  for (const getRuntime of [async () => { throw new Error("SDK failed"); },
    async () => runtime({ ...loading, ready: true }).auth]) {
    const env = environment();
    await assert.rejects(requireLoginPage({ ...env, getRuntime }));
    assert.ok(env.classes.has("auth-required-pending"));
    assert.deepEqual(env.redirects, ["index.html"]);
  }
});

test("actual auth state redirects only after successful logout; editor cancellation/failure stays signed-in; external sign-out redirects", async () => {
  for (const page of ["select", "setting", "character"]) {
    for (const external of [false, true]) {
      const env = environment(); let watch, accepted = page === "select", fail = false, calls = 0;
      const auth = createAuthController({
        watch(fn) { watch = fn; return () => {}; }, session: async () => ({ user: { id: "user" } }),
        accounts: async () => [], logout: async () => { calls++; if (fail) throw new Error("logout failed"); },
      }, () => {});
      await auth.start(); await requireLoginPage({ ...env, getRuntime: async () => auth });
      auth.beforeLogout(async () => accepted);
      if (!accepted) {
        await auth.logout(); assert.equal(calls, 0); assert.deepEqual(env.redirects, []);
      }
      if (external) watch(null);
      else {
        accepted = true; fail = true; await auth.logout(); assert.deepEqual(env.redirects, []);
        fail = false; await auth.logout();
      }
      assert.deepEqual(env.redirects, [external ? "index.html" : "index.html?notice=logged-out"]);
    }
  }
  assert.match(await source("onlineEditor"), /auth\.beforeLogout\(\(\) => controller\.canLeave\(\)\)/);
});

test("index consumes known notice once, preserves other query/hash and history state; arbitrary notices are ignored", () => {
  for (const notice of ["login-required", "logged-out", "unknown", "__proto__", "constructor", "<img src=x onerror=alert(1)>"]) {
    const location = { href: "https://example.test/index.html?foo=one&notice=" + encodeURIComponent(notice) + "&bar=two#section" };
    const toasts = [], changes = [], state = { keep: true };
    const history = { state, replaceState(value, _title, url) {
      assert.equal(value, state); changes.push(url); location.href = new URL(url, location.href).href;
    } };
    consumeIndexNotice({ location, history, toast: value => toasts.push(value) });
    consumeIndexNotice({ location, history, toast: value => toasts.push(value) });
    if (notice === "login-required" || notice === "logged-out") {
      assert.deepEqual(toasts, [notice === "login-required" ? { kind: "error", message: "ログインしてください。" }
        : { kind: "success", message: "ログアウトしました。" }]);
      assert.deepEqual(changes, ["/index.html?foo=one&bar=two#section"]);
    } else { assert.deepEqual(toasts, []); assert.deepEqual(changes, []); }
  }
});

test("only the three explicit page entry modules opt in; denied/loading auth cannot touch DOM or online initialization", async () => {
  const guarded = [];
  for (const file of await readdir(new URL("../js/", import.meta.url))) {
    if (file === "authPageGuard.js" || !file.endsWith(".js")) continue;
    if ((await readFile(new URL("../js/" + file, import.meta.url), "utf8")).includes("authPageGuard.js")) guarded.push(file);
  }
  assert.deepEqual(guarded.sort(), ["characterPage.js", "select.js", "settingPage.js"]);
  for (const page of ["select", "settingPage", "characterPage"]) {
    const code = (await source(page)).replace(/^import .*;\r?\n/gm, "");
    const env = environment(), r = runtime();
    let touches = 0;
    const forbidden = new Proxy({}, { get() { touches++; throw new Error("page initialized before auth"); } });
    const running = vm.runInNewContext(`(async()=>{${code}})()`, {
      requireLoginPage: () => requireLoginPage({ ...env, getRuntime: async () => r.auth }),
      document: forbidden, getSupabaseClient() { touches++; }, mountOnlineEditor() { touches++; },
      createSelectState() { touches++; }, createSettingState() { touches++; }, createEmptyPlayerPresentation() { touches++; },
    });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(touches, 0);
    r.emit(signedOut); await assert.rejects(running, /Login required/); assert.equal(touches, 0);
  }
  for (const page of ["select", "setting", "character"]) {
    const html = await readFile(new URL(`../${page}.html`, import.meta.url), "utf8");
    assert.match(html, /<body class="[^"]*auth-required-pending/);
    assert.match(html, /css\/common-menu.css/);
  }
  for (const page of ["index", "storage", "result"]) {
    assert.doesNotMatch(await readFile(new URL(`../${page}.html`, import.meta.url), "utf8"), /auth-required-pending|authPageGuard/);
  }
  assert.match(await source("indexPage"), /consumeIndexNotice\(\)/);
  assert.doesNotMatch(await source("authPageGuard") + await source("indexNotice"), /localStorage|sessionStorage|getSession/);
});
