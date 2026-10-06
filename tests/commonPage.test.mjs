import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");
test("ordinary pages opt into the shared shell before their own CSS and retain entry/menu/theme scripts", async () => {
  for (const [page, shell] of [["setting","setting-shell"],["character","character-shell"],["rulebook","rulebook-shell"],["character-list","character-list-shell"],["storage","wrap"]]) {
    const html = await read(page + ".html");
    assert.match(html, new RegExp('<main data-page-content class="' + shell + ' page-shell'));
    assert.ok(html.indexOf('css/common-theme.css') < html.indexOf('css/common-page.css'));
    assert.ok(html.indexOf('css/common-page.css') < html.indexOf('css/' + page + '.css'));
    for (const script of ["siteTheme.js","siteThemeAuth.js","pageEntry.js","commonMenu.js"]) assert.ok(html.includes('js/' + script), page + ' ' + script);
    assert.match(html, /class="[^"]*page-eyebrow/);
    assert.match(html, /class="[^"]*page-title/);
  }
  for (const page of ["result", "profile"]) assert.doesNotMatch(await read(page + ".html"), /common-page\.css|page-shell/);
});
test("common shell owns surface, gutter, shadow, viewport height and responsive dimensions", async () => {
  const css = await read("css/common-page.css");
  for (const cls of ["page-shell","page-header","page-eyebrow","page-title","page-muted","page-panel"]) assert.ok(css.includes('.' + cls));
  assert.match(css, /width:calc\(100% - 12px\)/);
  assert.match(css, /max-width:var\(--page-max-width, 1080px\)/);
  assert.match(css, /min-height:calc\(100svh - var\(--common-menu-height, 52px\)\)/);
  assert.match(css, /background:var\(--shell-surface\)/);
  assert.match(css, /box-shadow:0 0 28px #00000018/);
  assert.match(css, /@media\(max-width:700px\)/);
  for (const page of ["setting","character","rulebook","character-list"]) {
    const own = await read("css/" + page + ".css");
    assert.doesNotMatch(own, /background:\s*var\(--shell-surface\)|min-height:calc\(100svh|box-shadow:0 0 28px/);
  }
  assert.match(await read("css/character-list.css"), /--page-max-width:1240px/);
});
test("history keeps filter, pager and error IDs and uses the theme for ordinary controls and rows", async () => {
  const html = await read("storage.html"), css = await read("css/storage.css");
  for (const id of ["eno","outcome","favorites","order","accountNotice","favoriteError","list","empty","error","prev","pageInfo","next"]) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  assert.match(css, /\.row\s*\{[^}]*background:var\(--panel\)[^}]*color:var\(--text\)[^}]*border:1px solid var\(--border\)[^}]*border-radius:12px/);
  assert.match(css, /--border:var\(--line\)/);
  assert.match(css, /\.tools input,\.tools select,\.btn\s*\{[^}]*background:var\(--panel\); color:var\(--text\)/);
  assert.match(css, /\.error\s*\{ color:var\(--warn\)/);
  assert.doesNotMatch(css, /#fff(?:\W|$)|#111(?:\W|$)|#f6f6f7/);
  assert.match(css, /\.badge\.win\s*\{ background:#ffe78a/);
  assert.match(css, /\.badge\.lose\s*\{ background:#d4c2d8/);
  assert.match(css, /\.badge\.draw\s*\{ background:#e2e2e2/);
  assert.match(css, /\.badge\s*\{ color:#20282C/);
  for (const width of [760,420]) assert.ok(css.includes('@media(max-width:' + width + 'px)'));
});
test("editor save bars, rulebook tabs and character-list columns retain their own layout", async () => {
  for (const page of ["setting","character"]) {
    assert.match(await read("css/" + page + ".css"), /\.save-bar\s*\{ position:sticky; bottom:0/);
    assert.match(await read(page + ".html"), /class="save-bar"/);
  }
  assert.match(await read("rulebook.html"), /role="tablist"/);
  const list = await read("css/character-list.css");
  assert.match(list, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(list, /@media\(max-width:1140px\).*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(list, /@media\(max-width:760px\).*grid-template-columns:minmax\(0,1fr\)/);
});
