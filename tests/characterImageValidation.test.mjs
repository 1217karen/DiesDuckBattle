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

for (const [w,h,status] of [[480,480,"valid"],[480,40,"valid"],[480,240,"valid"],[479,240,"warning"],[320,160,"warning"],[481,200,"invalid"],[480,481,"invalid"],[800,100,"invalid"]]) {
  test(`C cut-in ${w}x${h}: ${status}`,()=>{
    const state=validateImageDimensions("cutin",w,h);
    assert.equal(state.status,status);assert.match(state.message,new RegExp(`${w}×${h}`));
    assert.equal(imageValidationSummary([state]).canSave,status!=="invalid");
    if(status==="warning")assert.match(state.message,/横幅が480px未満/);
  });
}
test("cut-in warning saves, but any loading/invalid or failed URL prevents saving",()=>{
  let state;const begin=createImageValidation("cutin",s=>state=s);
  begin("small").load(320,160);assert.equal(imageValidationSummary([state]).canSave,true);
  for(const status of ["loading","invalid"])assert.equal(imageValidationSummary([state,{status}]).canSave,false);
  begin("bad").error();assert.equal(state.status,"invalid");
  assert.equal(imageValidationSummary([state]).canSave,false);
});
