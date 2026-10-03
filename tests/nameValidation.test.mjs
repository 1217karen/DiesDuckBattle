import test from "node:test";
import assert from "node:assert/strict";
import { hasName, duckNameIssues } from "../js/nameValidation.js";

test("names require non-whitespace without mutating old data", () => {
  for (const name of ["", " ", "　", "\t\n　", null]) assert.equal(hasName(name), false);
  assert.equal(hasName(" 有効な名前　"), true);
  const build = { ducks: [{id:"one",name:"正常"},{id:"two",name:"　"}] };
  const before = structuredClone(build), issues = duckNameIssues(build);
  assert.equal(issues.length, 1); assert.equal(issues[0].duckId, "two"); assert.equal(issues[0].code, "NAME_REQUIRED");
  assert.deepEqual(build, before);
});
