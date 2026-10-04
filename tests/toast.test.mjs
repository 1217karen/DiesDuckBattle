import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createAuthController } from "../js/authController.js";

const code = (await readFile(new URL("../js/toast.js", import.meta.url), "utf8")).replace("export function", "function");
function setup() {
  let now = 0, nextId = 0;
  const timers = new Map(), frames = [];
  class Element {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {};
      const classes = new Set();
      this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) };
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    append(node) { node.parent = this; this.children.push(node); }
    remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
    focus() { assert.fail("toast must not move focus"); }
    set innerHTML(value) { assert.fail("message must use textContent"); }
  }
  const activeElement = new Element("input"), body = new Element("body");
  const document = { body, activeElement, createElement: tag => new Element(tag) };
  const show = vm.runInNewContext(`${code}\nshowToast`, {
    document, requestAnimationFrame: fn => frames.push(fn),
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  }
  return { show, advance, document, activeElement, timers,
    paint() { for (let i = 0; i < 2; i++) frames.splice(0).forEach(fn => fn()); },
    container: () => body.children[0], nodes: () => body.children[0]?.children ?? [] };
}

for (const [kind, duration] of Object.entries({ success: 2000, info: 2500, warning: 3000, error: 3500 })) {
  test(`${kind} defaults to ${duration}ms and removes DOM only after its exit transition`, () => {
    const f = setup(); f.show({ kind, message: "notice" }); const node = f.nodes()[0];
    assert.equal(node.dataset.kind, kind); assert.equal(node.classList.contains("is-visible"), false);
    f.paint(); assert.ok(node.classList.contains("is-visible"));
    f.advance(duration - 1); assert.ok(node.classList.contains("is-visible"));
    f.advance(1); assert.ok(node.classList.contains("is-hiding")); assert.equal(node.classList.contains("is-visible"), false);
    f.advance(219); assert.equal(f.nodes().length, 1);
    f.advance(1); assert.equal(f.nodes().length, 0); assert.equal(f.timers.size, 0);
  });
}

test("optional duration overrides defaults; every invalid duration falls back", () => {
  for (const duration of [5000, 1, 0.5]) {
    const f = setup(); f.show({ kind: "success", message: "custom", duration });
    assert.equal([...f.timers.values()][0].at, duration);
  }
  for (const duration of [undefined, null, 0, -1, NaN, Infinity, -Infinity, "5000", true, {}, []]) {
    const f = setup(); f.show({ kind: "warning", message: "fallback", duration });
    assert.equal([...f.timers.values()][0].at, 3000);
  }
  for (const kind of [undefined, "unknown", "__proto__", "constructor"]) {
    const f = setup(); f.show({ kind, message: "fallback" });
    assert.equal(f.nodes()[0].dataset.kind, "info"); assert.equal([...f.timers.values()][0].at, 2500);
  }
});

test("one body container appends newest at bottom; each toast expires from its own start", () => {
  const f = setup(); f.show({ kind: "info", message: "old" }); f.paint();
  f.advance(1000); f.show({ kind: "info", message: "new" }); f.paint();
  assert.equal(f.document.body.children.length, 1);
  assert.deepEqual(f.nodes().map(node => node.textContent), ["old", "new"]);
  f.advance(1500); assert.ok(f.nodes()[0].classList.contains("is-hiding"));
  assert.ok(f.nodes()[1].classList.contains("is-visible"));
  f.advance(220); assert.deepEqual(f.nodes().map(node => node.textContent), ["new"]);
  f.advance(1000); assert.equal(f.nodes().length, 0);
});

test("fifth toast immediately removes oldest and its timers, even while oldest is exiting", () => {
  for (const exiting of [false, true]) {
    const f = setup(); f.show({ kind: "success", message: "1" }); f.paint();
    if (exiting) f.advance(2000);
    for (const message of ["2", "3", "4", "5"]) f.show({ kind: "info", message });
    f.paint();
    assert.deepEqual(f.nodes().map(node => node.textContent), ["2", "3", "4", "5"]);
    assert.equal(f.timers.size, 4);
    f.advance(2720); assert.equal(f.nodes().length, 0); assert.equal(f.timers.size, 0);
  }
});

test("duplicates neither add nor extend duration; different kind stays separate; removed toast may recur", () => {
  const f = setup(); f.show({ kind: "success", message: "same" }); f.paint();
  f.advance(1000); f.show({ kind: "success", message: "same", duration: 5000 });
  assert.equal(f.nodes().length, 1); assert.equal(f.timers.size, 1);
  f.show({ kind: "error", message: "same" }); assert.equal(f.nodes().length, 2);
  f.advance(1000); assert.ok(f.nodes()[0].classList.contains("is-hiding"));
  f.show({ kind: "success", message: "same" }); assert.equal(f.nodes().length, 2);
  f.advance(220); f.show({ kind: "success", message: "same" });
  assert.deepEqual(f.nodes().map(node => node.dataset.kind), ["error", "success"]);
});

test("invalid messages create no DOM/timers; HTML is literal text; no button, focus or hover handlers", () => {
  const f = setup();
  for (const notice of [undefined, null, {}, { message: 0 }, { message: {} }, { message: "" }, { message: " \t\n　" }]) f.show(notice);
  assert.equal(f.document.body.children.length, 0); assert.equal(f.timers.size, 0);
  const message = '<img src=x onerror="alert(1)">';
  f.show({ kind: "error", message }); f.paint();
  const node = f.nodes()[0], container = f.container();
  assert.equal(node.textContent, message); assert.equal(node.children.length, 0);
  assert.equal(node.tagName, "div"); assert.equal(node.attributes.tabindex, undefined);
  assert.equal(container.attributes["aria-live"], "polite");
  assert.equal(container.attributes["aria-relevant"], "additions");
  assert.equal(f.document.activeElement, f.activeElement);
  f.advance(3720); assert.equal(f.nodes().length, 0);
  assert.equal(f.document.activeElement, f.activeElement);
});

test("existing index notice uses the real toast without changing its API or URL consumption", async () => {
  const f = setup(), changes = [];
  const noticeCode = (await readFile(new URL("../js/indexNotice.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace("export function", "function");
  vm.runInNewContext(`${noticeCode}\nconsumeIndexNotice();`, {
    URL, showToast: f.show, location: { href: "https://example.test/index.html?notice=login-required&keep=1#part" },
    history: { state: null, replaceState(_state, _title, url) { changes.push(url); } },
  });
  assert.equal(f.nodes()[0].textContent, "ログインしてください。");
  assert.equal(f.nodes()[0].dataset.kind, "error");
  assert.deepEqual(changes, ["/index.html?keep=1#part"]);
  f.advance(3720); assert.equal(f.nodes().length, 0);
});

test("common CSS defines bottom stack, four kind colors and 200ms downward fade/slide", async () => {
  const css = await readFile(new URL("../css/common-menu.css", import.meta.url), "utf8");
  assert.match(css, /\.common-toast-container\s*\{[^}]*bottom:16px[^}]*left:50%[^}]*flex-direction:column[^}]*gap:8px[^}]*width:min\(92vw, 420px\)[^}]*pointer-events:none/);
  assert.match(css, /\.common-toast\s*\{[^}]*opacity:0[^}]*translateY\(8px\)[^}]*transition:opacity \.2s ease, transform \.2s ease/);
  assert.match(css, /\.common-toast\.is-visible\s*\{ opacity:1; transform:translateY\(0\)/);
  assert.match(css, /\.common-toast\.is-hiding\s*\{ opacity:0; transform:translateY\(8px\)/);
  for (const kind of ["info", "success", "warning", "error"]) assert.ok(css.includes(`.common-toast[data-kind="${kind}"]`));
  assert.doesNotMatch(css, /\.common-toast button/);
});
test("auth success is an event once, not persistent menu text; restore emits no success; failure remains in form",async()=>{
 const notices=[];let state,ok=false;const session={user:{id:"auth"}};
 const controller=createAuthController({watch:()=>()=>{},session:async()=>null,accounts:async()=>[{eno:"77",name:"DB"}],
 login:async()=>ok?{ok:true,session}:{ok:false,message:"入力を確認"},logout:async()=>{}},s=>{state=s;},m=>notices.push(m));
 await controller.start();assert.deepEqual(notices,[]);await controller.login("77","bad");assert.equal(state.message,"入力を確認");assert.deepEqual(notices,[]);
 ok=true;await controller.login("77","good");assert.equal(state.message,"");assert.deepEqual(notices,["ログインしました。"]);
 await controller.logout();assert.equal(state.message,"");assert.deepEqual(notices,["ログインしました。","ログアウトしました。"]);
});
