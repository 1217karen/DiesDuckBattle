import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");

// Read these flat rules and width media groups without depending on declaration order.
const compact = value => value.replace(/\s+/g, "");
function rules(css, width = Infinity) {
  const result = new Map();
  function visit(source) {
    const pattern = /([^{}]+)\{/g;
    let match;
    while ((match = pattern.exec(source))) {
      let end = pattern.lastIndex, depth = 1;
      while (depth && end < source.length) {
        if (source[end] === "{") depth++;
        if (source[end] === "}") depth--;
        end++;
      }
      assert.equal(depth, 0, "balanced CSS block");
      const selector = match[1].trim(), body = source.slice(pattern.lastIndex, end - 1);
      pattern.lastIndex = end;
      if (selector.startsWith("@media")) {
        const bound = selector.match(/^@media\s*\(\s*(min|max)-width\s*:\s*(\d+)px\s*\)$/);
        assert.ok(bound, "supported width condition: " + selector);
        if (bound[1] === "max" ? width <= Number(bound[2]) : width >= Number(bound[2])) visit(body);
      } else {
        assert.ok(!selector.startsWith("@"), "supported style rule: " + selector);
        for (const name of selector.split(",").map(value => value.trim())) {
          const declarations = result.get(name) ?? new Map();
          for (const declaration of body.split(";")) {
            const colon = declaration.indexOf(":");
            if (colon >= 0) declarations.set(declaration.slice(0, colon).trim(), compact(declaration.slice(colon + 1)));
          }
          result.set(name, declarations);
        }
      }
    }
  }
  visit(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  return result;
}
function expectStyle(css, selector, expected, width) {
  const actual = rules(css, width).get(selector);
  assert.ok(actual, selector);
  for (const [property, value] of Object.entries(expected)) {
    assert.equal(actual.get(property), compact(value), selector + " " + property + " at " + width);
  }
}

test("ordinary pages opt into the shared shell before their own CSS and retain entry/menu/theme scripts", async () => {
  for (const [page, shell] of [["setting","setting-shell"],["character","character-shell"],["rulebook","rulebook-shell"],["character-list","character-list-shell"],["storage","wrap"]]) {
    const html = await read(page + ".html");
    assert.match(html, new RegExp('<main data-page-content class="' + shell + ' page-shell'));
    assert.ok(html.indexOf('css/common-theme.css') < html.indexOf('css/common-page.css'));
    assert.ok(html.indexOf('css/common-page.css') < html.indexOf('css/' + page + '.css'));
    for (const script of ["siteTheme.js","pageEntry.js","commonMenu.js"]) assert.ok(html.includes('js/' + script), page + ' ' + script);
    const header = html.match(/<header class="[^"]*page-header[^"]*">([\s\S]*?)<\/header>/)?.[1];
    assert.ok(header, page);
    assert.match(header, /<h1 class="[^"]*page-title[^"]*">[^<]+<\/h1>/);
    assert.doesNotMatch(header, /page-eyebrow/);
    if (["setting", "character"].includes(page)) {
      assert.match(header, /<p>[^<]+<\/p>/);
    }
    assert.match(html, /class="[^"]*page-title/);
  }
  for (const page of ["result", "profile"]) assert.doesNotMatch(await read(page + ".html"), /common-page\.css|page-shell/);
});
test("common shell owns surface, gutter, shadow, viewport height and responsive dimensions", async () => {
  const css = await read("css/common-page.css");
  for (const cls of ["page-shell","page-header","page-eyebrow","page-title","page-muted","page-panel"]) assert.ok(css.includes('.' + cls));
  expectStyle(css, ".page-shell", {
    width: "calc(100% - 12px)", "max-width": "var(--page-max-width, 1080px)",
    "min-height": "calc(100svh - var(--common-menu-height, 52px))",
    background: "var(--shell-surface)", "box-shadow": "0 0 28px #00000018",
    color: "var(--text)", padding: "var(--page-padding, 20px 28px)"
  }, 701);
  expectStyle(css, ".page-shell", { padding: "var(--page-padding-narrow, 26px 16px)" }, 700);
  for (const page of ["setting","character","rulebook","character-list"]) {
    const own = await read("css/" + page + ".css");
    assert.doesNotMatch(compact(own), /background:var\(--shell-surface\)|min-height:calc\(100svh|box-shadow:0028px/);
  }
  expectStyle(await read("css/character-list.css"), ".character-list-shell", { "--page-max-width": "1240px" });
});
test("history keeps filter, pager and error IDs and uses the theme for ordinary controls and rows", async () => {
  const html = await read("storage.html"), css = await read("css/storage.css");
  for (const id of ["eno","outcome","favorites","order","accountNotice","favoriteError","list","empty","error","prev","pageInfo","next"]) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  expectStyle(css, ".row", { background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)", "border-radius": "12px" });
  expectStyle(css, ":root", { "--border": "var(--line)" });
  for (const selector of [".tools input", ".tools select", ".btn"]) expectStyle(css, selector, { background: "var(--panel)", color: "var(--text)" });
  expectStyle(css, ".error", { color: "var(--warn)" });
  assert.doesNotMatch(css, /#fff(?:\W|$)|#111(?:\W|$)|#f6f6f7/);
  for (const [outcome, color] of [["win", "#ffe78a"], ["lose", "#d4c2d8"], ["draw", "#e2e2e2"]]) expectStyle(css, ".badge." + outcome, { background: color });
  expectStyle(css, ".badge", { color: "#20282C" });
  expectStyle(css, ".row", { "grid-template-columns": "auto minmax(0,1fr) auto minmax(0,1fr) auto" }, 760);
  expectStyle(css, ".row", { "grid-template-columns": "minmax(0,1fr) auto minmax(0,1fr)" }, 420);
});
test("editor save bars, rulebook tabs and character-list columns retain their own layout", async () => {
  for (const page of ["setting","character"]) {
    expectStyle(await read("css/" + page + ".css"), ".save-bar", { position: "static", bottom: "0" });
    assert.match(await read(page + ".html"), /class="save-bar"/);
  }
  assert.match(await read("rulebook.html"), /role="tablist"/);
  const list = await read("css/character-list.css");
  for (const width of [881, 1440]) expectStyle(list, ".character-list-grid", { display: "grid", "grid-template-columns": "repeat(2, minmax(0, 1fr))", width: "100%", "max-width": "1068px", "margin-inline": "auto", gap: "18px 28px" }, width);
  for (const width of [880, 761, 760, 390, 320]) expectStyle(list, ".character-list-grid", { "grid-template-columns": "minmax(0, 1fr)", width: "100%", "max-width": "520px", "margin-inline": "auto", gap: "18px 28px" }, width);
  expectStyle(list, ".character-list-filters", { display: "flex" }, 761);
  for (const width of [760, 390, 320]) expectStyle(list, ".character-list-filters", { display: "grid", "grid-template-columns": "repeat(2, minmax(0, 1fr))" }, width);
});
