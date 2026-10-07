import test from "node:test";
import assert from "node:assert/strict";
import { renderChoices } from "../js/selectTray.js";

function gridFixture() {
  const document = { createElement(tag) {
    return { tag, ownerDocument: document, children: [], attributes: {}, handlers: {},
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = nodes; },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(key, fn) { this.handlers[key] = fn; },
    };
  } };
  return document.createElement("div");
}

test("incomplete opponents remain visible with a label but cannot be picked", () => {
  const grid=gridFixture(),picked=[];
  renderChoices(grid,[{id:'one',eno:'1',name:'未完成プレイヤー',ready:false,reasons:[]}],null,id=>picked.push(id),{kind:'opponents'});
  const button=grid.children[0].children[0];assert.equal(button.disabled,true);
  assert.ok(button.children.some(e=>e.textContent==='戦闘設定未完成'));
  button.handlers.click();assert.deepEqual(picked,[]);
});

test("Duck cards use matching presentation icons, names, fallback, readiness and pressed state", () => {
  const grid = gridFixture(), picked = [];
  const choices = [
    { id: "one", name: "ぴよ", ready: true, status: "設定済み", reasons: [] },
    { id: "two", name: "未完成Duck", ready: false, status: "未完成", reasons: ["Aを設定してください"] },
  ];
  const presentation = { ducks: { one: { iconUrl: "one.png" }, other: { iconUrl: "private.png" } } };
  const before = structuredClone(presentation);
  renderChoices(grid, choices, "one", id => picked.push(id), { kind: "self", presentation });
  const [one, two] = grid.children.map(card => card.children[0]);
  assert.equal(one.children[0].src, "one.png");
  assert.equal(one.children[0].alt, "");
  assert.equal(one.children[1].textContent, "ぴよ");
  assert.equal(one.children.length, 2);
  assert.equal(one.attributes["aria-label"], "アヒル「ぴよ」を選択");
  assert.equal(one.attributes["aria-pressed"], "true");
  assert.equal(two.attributes["aria-pressed"], "false");
  assert.equal(two.disabled, true);
  assert.equal(two.children[0].src, "/img/D00.png");
  one.children[0].handlers.error(); assert.equal(one.children[0].src, "/img/D00.png");
  assert.equal(grid.children[1].children[1].children[0].textContent, "理由を確認");
  assert.equal(grid.children[1].children[1].children[1].children[0].textContent, "Aを設定してください");
  one.handlers.click(); assert.deepEqual(picked, ["one"]);
  assert.deepEqual(presentation, before);
});

test("opponent cards show only default Battler icon, separate ENo and Battler name", () => {
  const grid = gridFixture();
  const choices = ["icon.png", "", undefined].map((defaultIconUrl, i) => ({
    id: String(i), eno: String(i + 1), name: "バトラー" + i, defaultIconUrl,
    publicDuckId: "duck", duckName: "非表示Duck", ready: true, reasons: [],
  }));
  renderChoices(grid, choices, "0", () => {}, { kind: "opponents" });
  for (let i = 0; i < choices.length; i++) {
    const button = grid.children[i].children[0];
    assert.equal(button.children.length, 3);
    assert.equal(button.children[0].src, i ? "/img/B00_icon.png" : "icon.png");
    assert.equal(button.children[1].textContent, `ENo.${i + 1}`);
    assert.equal(button.children[1].className, "trayItem__eno");
    assert.equal(button.children[2].textContent, choices[i].name);
    assert.equal(button.attributes["aria-label"], `ENo.${i + 1} バトラー${i} を選択`);
    assert.equal(button.attributes["aria-pressed"], String(i === 0));
    assert.equal(button.disabled, false);
  }
  const icon = grid.children[0].children[0].children[0];
  icon.handlers.error(); assert.equal(icon.src, "/img/B00_icon.png");
});
