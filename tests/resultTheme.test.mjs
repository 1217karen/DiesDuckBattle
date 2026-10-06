import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../css/result.css", import.meta.url), "utf8");
const html = await readFile(new URL("../result.html", import.meta.url), "utf8");
const rule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp('(?:^|\\n)' + escaped + ' \\{([^}]*)\\}'))?.[1] ?? "";
};
test("result loads the shared theme after early site preference scripts and before result CSS", () => {
  const paths = ["js/siteTheme.js","js/siteThemeAuth.js","css/common-theme.css","css/result.css"];
  paths.forEach((path,i) => { assert.ok(html.includes(path)); if (i) assert.ok(html.indexOf(paths[i-1]) < html.indexOf(path)); });
  assert.match(html, /fonts\.googleapis\.com/); assert.match(html, /css\/page-loading\.css/);
  assert.doesNotMatch(html, /common-page\.css/);
  for (const id of ["battle-header","p1BattlerIcon","p2BattlerIcon","p1DuckIcon","p2DuckIcon","p1Name","p2Name","centerTurn","centerHP_P1","centerHP_P2","centerAP_P1","centerAP_P2","centerPhase","logArea","btnBack","btnNext","btnAll"]) assert.match(html, new RegExp('id="'+id+'"'));
});
test("neutral backgrounds, icon borders and placeholders follow the common theme", () => {
  assert.match(rule("body"), /color: var\(--text\)/);
  assert.match(rule("body"), /background-color: var\(--bg\)/);
  assert.match(rule("body"), /background-image: var\(--theme-background-image\)/);
  assert.match(rule(".whiteStripe"), /background: var\(--shell-surface\)/);
  for (const selector of [".header",".footer"]) assert.match(rule(selector), /background: var\(--panel\)/);
  for (const selector of [".battlerIcon, .duckIcon",".quoteIcon"]) {
    assert.match(rule(selector), /background: var\(--ui-surface\)/);
    assert.match(rule(selector), /border: 2px solid var\(--line\)/);
  }
  assert.match(rule(".placeholderIcon"), /color: var\(--muted\)/);
  for (const selector of [".line.soft",".quoteBubble",".miniPanel"]) assert.match(rule(selector), /color-mix\(in srgb, var\(--text\) 3\.5%, transparent\)/);
  for (const selector of [".logDuckIcon",".miniTag"]) assert.match(rule(selector), /background: var\(--ui-surface\)/);
  assert.match(rule(".phaseHeader.system"), /color: #20282c/);
  assert.match(rule(".hpBar"), /background: var\(--ui-hover\)/);
  assert.match(rule(".errorMessage"), /var\(--panel\)/);
  assert.doesNotMatch(css, /#111|#fff(?:\W|$)|#f0f0f0|#cfcfcf|rgba\(0,0,0,/);
});
test("result buttons override shared primary styling while retaining their own sizes and state rules", () => {
  const btn = rule(".btn, .btn.primary");
  assert.match(btn, /background: var\(--ui-surface\); color: var\(--text\)/);
  assert.match(btn, /box-shadow: inset 0 0 0 1px var\(--line\)/);
  assert.match(btn, /border: 0;.*padding: 8px 12px; min-width: 96px/);
  assert.match(rule(".btn:hover, .btn.primary:hover"), /background: var\(--ui-hover\)/);
  assert.match(rule(".btn:active"), /translateY\(1px\)/);
  assert.match(rule(".btn:disabled"), /opacity: \.45/);
  assert.match(css, /@media \(max-width: 700px\)/); assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /\.btn, \.btn\.primary \{ min-width: 92px; padding: 8px 10px/);
  assert.match(css, /\.btn, \.btn\.primary \{ min-width: 96px; padding: 13px 12px/);
});
test("combat backgrounds and HP semantic colors remain unchanged", () => {
  for (const [key,value] of Object.entries({p1:'#e35b5b',p2:'#4a86e8',damage:'#8b3fe6',heal:'#2e9b4f',buff:'#f08a24',debuff:'#7a7a7a'})) assert.ok(css.includes('--'+key+': '+value+';'));
  for (const [selector,color] of [[".phaseHeader.p1","rgba(227,91,91,.6)"],[".phaseHeader.p2","rgba(74,134,232,.6)"],[".line.note","rgba(255,236,140,.35)"],[".line.note.p1","rgba(227,91,91,.18)"],[".line.note.p2","rgba(74,134,232,.18)"],[".line.note.status","rgba(180,130,255,.18)"],[".hpFill.p1","rgba(227,91,91,.7)"],[".hpFill.p2","rgba(74,134,232,.7)"]]) assert.ok(rule(selector).includes(color),selector);
});
test("Light victory is gold and Dark victory retains its silver gradient", () => {
  assert.match(rule(".line.victoryLine"), /rgba\(255,214,102,\.55\),color-mix\(in srgb, var\(--panel\) 75%, transparent\),rgba\(255,214,102,\.55\)/);
  assert.match(rule(".line.victoryLine"), /border: 2px solid rgba\(160,120,0,\.28\)/);
  assert.match(rule(':root[data-theme="dark"] .line.victoryLine'), /background: linear-gradient\(90deg,#59636d,#65717c,#59636d\); border-color: #7d8994; color: #f2f5f7/);
});
test("log bands have no vertical accent borders; HP labels and errors keep theirs", () => {
  for (const selector of [".phaseHeader", ".phaseHeader.p1", ".phaseHeader.p2", ".phaseHeader.system", ".line", ".line.note", ".line.note.p1", ".line.note.p2", ".line.note.status", ".quoteBubble", ".quoteBubble.p1", ".quoteBubble.p2"]) {
    assert.doesNotMatch(rule(selector), /border(?:-(?:left|right|inline)(?:-[\w-]+)?)?\s*:/, selector);
  }
  assert.match(rule(".miniTag.p1"), /border-left: 4px solid var\(--p1\)/);
  assert.match(rule(".miniTag.p2"), /border-left: 4px solid var\(--p2\)/);
  assert.match(rule(".errorMessage"), /border-left: 6px solid var\(--p1\)/);
});
test("only system header and system notes fade their background across the outer ten percent", () => {
  const cases = [
    [".phaseHeader.system", "#b7d7e3"],
    [".phaseBlock.system .line.note", "rgba(255,236,140,.35)"],
    [".phaseBlock.system .line.note.p1", "rgba(227,91,91,.18)"],
    [".phaseBlock.system .line.note.p2", "rgba(74,134,232,.18)"],
    [".phaseBlock.system .line.note.status", "rgba(180,130,255,.18)"],
  ];
  for (const [selector, color] of cases) {
    const declaration = rule(selector);
    assert.ok(declaration.includes(`background: linear-gradient(90deg, transparent 0%, ${color} 10%, ${color} 90%, transparent 100%)`), selector);
    assert.doesNotMatch(declaration, /opacity|mask|border|padding|width|height/);
  }
  for (const selector of [".line.soft", ".line.note", ".line.note.p1", ".line.note.p2", ".line.note.status", ".phaseHeader.p1", ".phaseHeader.p2", ".line.victoryLine", ':root[data-theme="dark"] .line.victoryLine']) {
    assert.doesNotMatch(rule(selector), /transparent 0%|transparent 100%/, selector);
  }
});
