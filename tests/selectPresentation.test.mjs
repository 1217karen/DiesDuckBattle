import test from "node:test";
import assert from "node:assert/strict";
import { createPresentationImage, createSelectPresentation, fitBattlersToAvoidOverlap } from "../js/selectPresentation.js";

test("P2 renderer selects only the public Duck icon and switches standing images with fallback", () => {
  const slots = new Map();
  for (const side of ["p1", "p2"]) for (const kind of ["battler", "duck"]) {
    const fallback = { hidden: false }, images = [];
    slots.set(`#${side}-${kind}-slot`, { images, fallback, querySelector: () => fallback,
      ownerDocument: { createElement: () => ({ remove() { this.removed = true; } }) },
      insertBefore(image) { images.push(image); },
    });
  }
  const render = createSelectPresentation({ querySelector: id => slots.get(id) }, {
    addEventListener() {}, cancelAnimationFrame() {}, requestAnimationFrame() {},
  });
  const standing = slots.get("#p2-battler-slot"), duck = slots.get("#p2-duck-slot");
  render("p2", undefined, undefined);
  assert.equal(standing.images.length, 0);
  for (const id of ["one", "two"]) {
    render("p2", { battler: { standingImageUrl: `${id}-standing.png` },
      ducks: { private: { iconUrl: "private.png" }, [id]: { iconUrl: `${id}-duck.png` } } }, id);
    assert.equal(standing.images.at(-1).src, `${id}-standing.png`);
    assert.equal(duck.images.at(-1).src, `${id}-duck.png`);
    standing.images.at(-1).onload(); duck.images.at(-1).onload();
    assert.equal(standing.fallback.hidden, true);
    assert.equal(duck.fallback.hidden, true);
  }
  assert.equal(standing.images[0].removed, true);
  assert.equal(duck.images[0].removed, true);
  duck.images.at(-1).onerror();
  assert.equal(duck.fallback.hidden, false);
  render("p2", {}, "two");
  assert.equal(standing.fallback.hidden, false);
  assert.equal(duck.fallback.hidden, false);
});

test("display swaps images, preserves fallback on missing/error and ignores stale loads", () => {
  const images = [];
  const container = { ownerDocument: { createElement: () => {
    const image = { remove() { this.removed = true; } }; images.push(image); return image;
  } }, insertBefore() {} };
  const fallback = { hidden: false };
  const show = createPresentationImage(container, fallback, "duckPick__img");
  show(undefined); assert.equal(images.length, 0); assert.equal(fallback.hidden, false);
  show("duck-a.png"); images[0].onload(); assert.equal(fallback.hidden, true);
  show("duck-b.png"); assert.equal(images[0].removed, true); assert.equal(fallback.hidden, false);
  images[0].onload(); assert.equal(fallback.hidden, false);
  images[1].onload(); assert.equal(fallback.hidden, true); assert.equal(images[1].src, "duck-b.png");
  show("duck-b.png"); assert.equal(images.length, 2);
  show("broken.png"); images[2].onerror(); assert.equal(fallback.hidden, false);
  show(""); images[2].onload(); assert.equal(fallback.hidden, false);
});

test("base overlap calculation shrinks both figures equally without enlargement", () => {
  const image = rect => ({ scale: 1, closest() { return { style: { setProperty: (_, value) => { this.scale = Number(value); } } }; }, getBoundingClientRect: () => rect });
  const p1 = image({ left:0,right:300,width:300 });
  const p2 = image({ left:200,right:500,width:300 });
  fitBattlersToAvoidOverlap([p1,p2]);
  assert.equal(p1.scale, p2.scale); assert.ok(p1.scale < 1);
  assert.ok(300 * p1.scale + 16 <= 200);
  fitBattlersToAvoidOverlap([p1]); assert.equal(p1.scale, 1);
});
