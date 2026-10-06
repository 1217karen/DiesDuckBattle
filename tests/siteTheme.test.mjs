import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const code = await readFile(new URL("../js/siteTheme.js", import.meta.url), "utf8");
function load(value, { readThrows = false, writeThrows = false, missing = false } = {}) {
  const writes = [];
  const context = { document: { documentElement: { dataset: {} } } };
  if (!missing) context.localStorage = {
    getItem(key) { assert.equal(key, "diesduck-site-theme"); if (readThrows) throw Error("blocked"); return value; },
    setItem(key, next) { if (writeThrows) throw Error("quota"); value = next; writes.push([key, next]); },
  };
  vm.runInNewContext(code, context);
  return { context, writes, value: () => value, api: context.diesDuckSiteTheme };
}
for (const [stored, expected] of [[null, "light"], ["dark", "dark"], ["light", "light"], ["", "light"], ["DARK", "light"], ["invalid", "light"]]) {
  test("stored site preference " + JSON.stringify(stored), () => {
    const f = load(stored);
    assert.equal(f.context.document.documentElement.dataset.theme, expected);
    assert.equal(f.api.read(), expected);
    assert.deepEqual(f.writes, []);
  });
}
for (const theme of ["light", "dark"]) test("save then reload " + theme, () => {
  const f = load(null);
  assert.equal(f.api.set(theme), theme);
  assert.equal(f.context.document.documentElement.dataset.theme, theme);
  assert.deepEqual(f.writes, [["diesduck-site-theme", theme]]);
  assert.equal(load(f.value()).context.document.documentElement.dataset.theme, theme);
});
for (const options of [{ readThrows: true }, { writeThrows: true }, { readThrows: true, writeThrows: true }, { missing: true }]) {
  test("unavailable storage does not break initialization or immediate changes " + JSON.stringify(options), () => {
    const f = load(null, options);
    assert.equal(f.context.document.documentElement.dataset.theme, "light");
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
  }
  for (const page of ["profile", "index", "auth", "select"]) {
    assert.doesNotMatch(await readFile(new URL("../" + page + ".html", import.meta.url), "utf8"), /siteTheme\.js/);
  }
  assert.doesNotMatch(code, /presentation|supabase|profile|sessionStorage/i);
});
test("radio CSS overrides generic full-width and minimum-height inputs in its own scope", async () => {
  const css = await readFile(new URL("../css/character.css", import.meta.url), "utf8");
  assert.match(css, /\.site-theme-options\s*\{[^}]*display:flex/);
  assert.match(css, /\.site-theme-options label\s*\{[^}]*flex-direction:row/);
  assert.match(css, /\.site-theme-options input\[type="radio"\]\s*\{[^}]*width:20px[^}]*height:20px[^}]*min-height:20px/);
});
