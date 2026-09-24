import test from "node:test";
import assert from "node:assert/strict";
import { validateImageDimensions, createImageValidation, imageValidationSummary } from "../js/characterImageValidation.js";

for (const [kind, width, height, status] of [
  ["standing",500,800,"valid"], ["standing",400,800,"valid"], ["standing",500,600,"valid"],
  ["standing",501,800,"invalid"], ["standing",500,801,"invalid"],
  ["icon",250,250,"valid"], ["icon",180,250,"valid"], ["icon",250,180,"valid"],
  ["icon",251,250,"invalid"], ["icon",250,251,"invalid"],
]) test(`${kind} ${width}x${height}: ${status}`, () => {
  const result = validateImageDimensions(kind, width, height);
  assert.equal(result.status, status);
  assert.ok(result.message.includes(`${width}×${height}`));
  if (status === "invalid") assert.ok(result.message.includes(kind === "standing" ? "500×800" : "250×250"));
});

test("empty URL is valid; loading is unresolved and prevents save; stale callbacks cannot overwrite", () => {
  let state;
  const begin = createImageValidation("icon", next => { state = next; });
  begin(""); assert.equal(state.status, "valid");
  const a = begin("A"); assert.equal(state.status, "loading");
  assert.equal(imageValidationSummary([state]).canSave, false);
  const b = begin("B");
  a.load(500,500); a.error(); assert.equal(state.status, "loading");
  b.load(250,250); assert.equal(state.status, "valid");
  a.error(); assert.equal(state.status, "valid");
  const c = begin("C"); begin(""); c.load(500,500); assert.equal(state.status, "valid");
});

test("any invalid field blocks saving until fixed; failed load is invalid", () => {
  let state;
  const begin = createImageValidation("standing", next => { state = next; });
  begin("bad").error(); assert.equal(state.status, "invalid");
  assert.match(state.message, /サイズを確認できません/);
  assert.equal(imageValidationSummary([{status:"valid"},state]).canSave, false);
  begin("fixed").load(500,800);
  assert.equal(imageValidationSummary([{status:"valid"},state]).canSave, true);
});
