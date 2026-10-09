import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { mountRulebook } from "../js/rulebookPage.js";
import { gameMenuItems, menuModel } from "../js/commonMenuModel.js";

const html = await readFile(new URL("../rulebook.html", import.meta.url), "utf8");
const ids = ["rule", "flow", "stats", "dice", "skills", "attack", "status"];
function fixture(hash = "") {
  const elements = new Map(), handlers = {};
  const document = { getElementById: id => elements.get(id) };
  for (const id of ["tab-guide", "tab-battle", "tab-guidelines", "panel-guide", "panel-battle", "panel-guidelines", ...ids, "guide-start"]) {
    elements.set(id, { id, attrs: {}, handlers: {}, hidden: false,
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(k, v) { this.handlers[k] = v; },
      focus() { document.focused = this; }, scrollIntoView() { this.scrolled = true; },
      contains(node) { return this.id === "panel-battle" ? ids.includes(node.id) : node.id === "guide-start"; },
    });
  }
  const window = { location: { hash }, addEventListener(k, v) { handlers[k] = v; } };
  let finished = 0;
  mountRulebook({ document, window, finish: () => finished++ });
  return { elements, window, handlers, document, finished };
}
for (const [hash, active] of [["", "guide"], ["#guide", "guide"], ["#battle", "battle"], ["#guidelines", "guidelines"], ["#dice", "battle"], ["#guide-start", "guide"], ["#unknown", "guide"]]) {
  test("initial tab for " + (hash || "no hash"), () => {
    const f = fixture(hash);
    for (const name of ["guide", "battle", "guidelines"]) {
      assert.equal(f.elements.get("tab-" + name).attrs["aria-selected"], String(name === active));
      assert.equal(f.elements.get("panel-" + name).hidden, name !== active);
      assert.equal(f.elements.get("tab-" + name).tabIndex, name === active ? 0 : -1);
    }
    assert.equal(f.finished, 1);
  });
}
test("click, hashchange/history and keyboard keep tab state and focus consistent", () => {
  const f = fixture();
  const guide = f.elements.get("tab-guide"), battle = f.elements.get("tab-battle");
  battle.handlers.click(); assert.equal(f.window.location.hash, "#battle");
  assert.equal(battle.attrs["aria-selected"], "true");
  f.window.location.hash = "#guide"; f.handlers.hashchange();
  assert.equal(guide.attrs["aria-selected"], "true");
  let prevented = 0;
  guide.handlers.keydown({ key: "ArrowRight", preventDefault() { prevented++; } });
  assert.equal(f.document.focused, battle); assert.equal(prevented, 1);
  battle.handlers.keydown({ key: "Home", preventDefault() {} }); assert.equal(f.document.focused, guide);
  guide.handlers.keydown({ key: "End", preventDefault() {} }); assert.equal(f.document.focused, f.elements.get("tab-guidelines"));
  battle.handlers.keydown({ key: "ArrowLeft", preventDefault() {} }); assert.equal(f.document.focused, guide);
  f.window.location.hash = "#dice"; f.handlers.hashchange();
  assert.equal(f.elements.get("panel-battle").hidden, false);
  assert.equal(f.elements.get("dice").scrolled, true);
});
test("all seven battle sections retain base prose, emoji and credits", () => {
  const base = execFileSync("git", ["show", "base:rulebook.html"], { cwd: new URL("..", import.meta.url), encoding: "utf8", windowsHide: true });
  const section = (text, id) => text.match(new RegExp('<section id="' + id + '"[^>]*>([\\s\\S]*?)</section>'))[1];
  const prose = text => text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  for (const id of ids) {
    let expected = section(base, id);
    if (id === "rule") expected = expected.replace("好きなバトラーとアヒルを選んで", "バトラーとアヒルで");
    assert.equal(prose(section(html, id)), prose(expected), id);
    assert.match(html, new RegExp('href="#' + id + '"'));
  }
  assert.equal(prose(html.match(/<footer>[\s\S]*?<\/footer>/)[0]), prose(base.match(/<footer>[\s\S]*?<\/footer>/)[0]));
});
test("public page uses the identical common shell, page gate and three accessible panels", async () => {
  const reference = await readFile(new URL("../character-list.html", import.meta.url), "utf8");
  const shell = text => text.match(/<header id="common-menu"[\s\S]*?<\/header>/)[0];
  assert.equal(shell(html), shell(reference));
  for (const path of ["css/common-theme.css", "css/common-menu.css", "css/page-loading.css", "js/pageLoadGate.js", "js/pageEntry.js", "js/commonMenu.js", "js/menuDisplayCache.js"]) assert.ok(html.includes(path));
  assert.match(html, /data-page-src="js\/rulebookPage.js"/);
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 3);
  assert.match(html, /role="tablist"/);
  assert.doesNotMatch(html, /fc2|ローカルストレージ|id="goal"|class="nav"|whiteStripe/);
  assert.match(html, /最終更新：2026\.10/);
  const entry = gameMenuItems.find(item => item.href === "rulebook.html");
  assert.equal(entry.label, "ルールブック"); assert.equal(entry.login, undefined);
  assert.ok(menuModel({ ready: true, sessionKnown: true, signedIn: false, accounts: [] }).items.includes(entry));
});
test("guide has seven simple placeholder sections and matching table of contents", () => {
  for (const id of ["start", "characters", "setting", "display", "battle", "profile", "history"]) {
    assert.match(html, new RegExp('<section id="guide-' + id + '">'));
    assert.match(html, new RegExp('href="#guide-' + id + '"'));
  }
});
