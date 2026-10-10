import test from "node:test";
import assert from "node:assert/strict";
import { hasName, duckNameIssues, duckNameError } from "../js/nameValidation.js";

test("names require non-whitespace without mutating old data", () => {
  for (const name of ["", " ", "　", "\t\n　", null]) assert.equal(hasName(name), false);
  assert.equal(hasName(" 有効な名前　"), true);
  const build = { ducks: [{id:"one",name:"正常"},{id:"two",name:"　"}] };
  const before = structuredClone(build), issues = duckNameIssues(build);
  assert.equal(issues.length, 1); assert.equal(issues[0].duckId, "two"); assert.equal(issues[0].code, "NAME_REQUIRED");
  assert.deepEqual(build, before);
});

for (const char of ["あ", "a", "😀"]) test("Duck names use a 15 code-point limit: " + char, () => {
  assert.equal(duckNameError(char.repeat(15)), "");
  assert.equal(duckNameError(char.repeat(16)), "アヒル名は15文字まで入力できます。");
});
