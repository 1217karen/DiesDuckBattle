import test from "node:test";
import assert from "node:assert/strict";
import { FIXED_IMAGES, setImageWithFallback } from "../js/fixedImages.js";

test("each image kind uses its own local default and registered images take priority", () => {
  for (const fallback of Object.values(FIXED_IMAGES)) {
    for (const url of [undefined, null, "", "  ", "https://example.com/registered.png"]) {
      let fail;
      const img = { addEventListener(type, handler, options) { assert.equal(options.once, true); fail = handler; } };
      setImageWithFallback(img, url, fallback);
      assert.equal(img.src, url?.trim() || fallback);
      fail();
      assert.equal(img.src, fallback);
    }
  }
});
