import test from "node:test";
import assert from "node:assert/strict";
import { createPresentationImage, fitBattlersToAvoidOverlap } from "../js/selectPresentation.js";

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
