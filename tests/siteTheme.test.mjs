import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createAuthController } from "../js/authController.js";

const code = await readFile(new URL("../js/siteTheme.js", import.meta.url), "utf8");
function load(value, { readThrows = false, writeThrows = false, missing = false } = {}) {
  const writes = [];
  const context = { document: { documentElement: { dataset: {} } } };
  if (!missing) context.localStorage = {
    getItem(key) { assert.equal(key, "diesduck-site-theme"); if (readThrows) throw Error("blocked"); return value; },
    setItem(key, next) { if (writeThrows) throw Error("quota"); value = next; writes.push([key, next]); },
  };
  vm.runInNewContext(code, context);
  let notify;
  context.diesDuckSiteTheme.bindAuth({ subscribe(fn) { notify = fn; fn({ sessionKnown: false, signedIn: false }); return () => {}; } });
  return { context, writes, value: () => value, api: context.diesDuckSiteTheme,
    notify: state => notify(state), login: () => notify({ sessionKnown: true, signedIn: true }) };
}
for (const [stored, expected] of [[null, "light"], ["dark", "dark"], ["light", "light"], ["", "light"], ["DARK", "light"], ["invalid", "light"]]) {
  test("stored site preference " + JSON.stringify(stored), () => {
    const f = load(stored);
    assert.equal(f.context.document.documentElement.dataset.theme, "light");
    assert.equal(f.api.read(), expected);
    f.notify({ sessionKnown: true, signedIn: false });
    assert.equal(f.context.document.documentElement.dataset.theme, "light");
    f.login();
    assert.equal(f.context.document.documentElement.dataset.theme, expected);
    assert.deepEqual(f.writes, []);
  });
}
for (const theme of ["light", "dark"]) test("save then reload " + theme, () => {
  const f = load(null);
  f.login();
  assert.equal(f.api.set(theme), theme);
  assert.equal(f.context.document.documentElement.dataset.theme, theme);
  assert.deepEqual(f.writes, [["diesduck-site-theme", theme]]);
  const reloaded = load(f.value());
  assert.equal(reloaded.context.document.documentElement.dataset.theme, "light");
  reloaded.login();
  assert.equal(reloaded.context.document.documentElement.dataset.theme, theme);
});
for (const options of [{ readThrows: true }, { writeThrows: true }, { readThrows: true, writeThrows: true }, { missing: true }]) {
  test("unavailable storage does not break initialization or immediate changes " + JSON.stringify(options), () => {
    const f = load(null, options);
    assert.equal(f.context.document.documentElement.dataset.theme, "light");
    f.login();
    assert.doesNotThrow(() => f.api.set("dark"));
    assert.equal(f.context.document.documentElement.dataset.theme, "dark");
    assert.equal(f.api.set("invalid"), "light");
  });
}
test("only the six specified pages initialize site theme before CSS; public profile stays independent", async () => {
  for (const page of ["setting", "character", "rulebook", "character-list", "result", "storage"]) {
    const html = await readFile(new URL("../" + page + ".html", import.meta.url), "utf8");
    const script = html.indexOf('<script src="js/siteTheme.js"></script>');
    assert.ok(script > 0 && script < html.indexOf('<link '), page);
    assert.equal((html.match(/js\/siteTheme\.js/g) || []).length, 1);
    assert.match(html, /<script type="module" src="js\/siteThemeAuth\.js"><\/script>/);
  }
  for (const page of ["profile", "index", "auth", "select"]) {
    assert.doesNotMatch(await readFile(new URL("../" + page + ".html", import.meta.url), "utf8"), /siteTheme(?:Auth)?\.js/);
  }
  assert.doesNotMatch(code, /presentation|supabase|profile|sessionStorage/i);
});
test("unknown/guest, logout and re-login change display without deleting the saved dark preference", () => {
  const f = load("dark");
  f.notify({ sessionKnown: false, signedIn: true });
  assert.equal(f.context.document.documentElement.dataset.theme, "light");
  f.notify({ sessionKnown: true, signedIn: false });
  assert.equal(f.context.document.documentElement.dataset.theme, "light");
  f.login(); assert.equal(f.context.document.documentElement.dataset.theme, "dark");
  f.notify({ sessionKnown: true, signedIn: false });
  assert.equal(f.context.document.documentElement.dataset.theme, "light");
  assert.equal(f.value(), "dark"); assert.deepEqual(f.writes, []);
  f.login(); assert.equal(f.context.document.documentElement.dataset.theme, "dark");
  f.notify({ sessionKnown: false, signedIn: true });
  assert.equal(f.context.document.documentElement.dataset.theme, "light");
});
test("guest changes cannot display dark; token/account notifications do not reset an active selection", () => {
  const f = load("dark", { writeThrows: true });
  f.api.set("dark"); assert.equal(f.context.document.documentElement.dataset.theme, "light");
  f.login(); f.api.set("light");
  f.notify({ sessionKnown: true, signedIn: true, ready: false, accountsResolved: false });
  assert.equal(f.context.document.documentElement.dataset.theme, "light");
  f.notify({ sessionKnown: true, signedIn: false });
  f.login(); assert.equal(f.context.document.documentElement.dataset.theme, "dark");
});
test("real Auth controller restore/login/logout notifications drive the theme and preserve profile colors", async () => {
  const f = load("dark"), profileColors = { bg: "#123456", panel: "#abcdef", text: "#112233", accent: "#445566" };
  f.context.document.documentElement.dataset.profileTheme = JSON.stringify(profileColors);
  const controller = createAuthController({
    watch: () => () => {}, session: async () => null, accounts: async () => [],
    login: async () => ({ ok: true, session: { user: { id: "user" } } }), logout: async () => {},
  }, () => {});
  const unsubscribe = f.api.bindAuth(controller);
  await controller.start(); assert.equal(f.context.document.documentElement.dataset.theme, "light");
  await controller.login("1", "local-password"); assert.equal(f.context.document.documentElement.dataset.theme, "dark");
  await controller.logout(); assert.equal(f.context.document.documentElement.dataset.theme, "light");
  await controller.login("1", "local-password"); assert.equal(f.context.document.documentElement.dataset.theme, "dark");
  assert.equal(f.context.document.documentElement.dataset.profileTheme, JSON.stringify(profileColors));
  assert.equal(f.value(), "dark"); assert.deepEqual(f.writes, []);
  unsubscribe(); controller.stop();
});
test("theme Auth bridge uses the shared runtime and handles initialization failure", async () => {
  const bridge = (await readFile(new URL("../js/siteThemeAuth.js", import.meta.url), "utf8")).replace(/^import .*;\r?\n/gm, "");
  let bound;
  const controller = {};
  await vm.runInNewContext(bridge, { getAuthRuntime: async () => controller, diesDuckSiteTheme: { bindAuth(value) { bound = value; } } });
  assert.equal(bound, controller);
  await assert.doesNotReject(vm.runInNewContext(bridge, { getAuthRuntime: async () => { throw Error("offline"); } }));
});
test("radio CSS overrides generic full-width and minimum-height inputs in its own scope", async () => {
  const css = await readFile(new URL("../css/character.css", import.meta.url), "utf8");
  assert.match(css, /\.site-theme-options\s*\{[^}]*display:flex/);
  assert.match(css, /\.site-theme-options label\s*\{[^}]*flex-direction:row/);
  assert.match(css, /\.site-theme-options input\[type="radio"\]\s*\{[^}]*width:20px[^}]*height:20px[^}]*min-height:20px/);
});
