import { migrateSelection } from "../js/selectionNormalization.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyPlayerBuild, createEmptyDuck, addDuck, duplicateDuck, updateDuck,
  deleteDuck, updateBattler, clonePlayerBuild } from "../js/playerBuildModel.js";
import { createPlayerBuildStorage, PLAYER_BUILD_STORAGE_KEY as KEY } from "../js/playerBuildStorage.js";
import { createASkillCatalog } from "../js/aSkillCatalog.js";
import { createBSkillCatalog } from "../js/bSkillCatalog.js";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { D_SKILL_OPTIONS } from "../js/dSkillCatalog.js";

function memoryStorage(raw = null) {
  const values = new Map(raw === null ? [] : [[KEY, raw]]);
  return { writes: 0, getItem: key => values.get(key) ?? null,
    setItem(key, value) { this.writes++; values.set(key, value); } };
}
const duck = id => createEmptyDuck({ idFactory: () => id });
const initial = () => addDuck(createEmptyPlayerBuild(), duck("first"));
const aSelection = { triggerId: "exact:0", effects: [{ effectId: "damage", targetId: "enemy", options: {amount: "5"}, chanceOptionId: "70" }] };
const cLeaf = { effectId: "damage", targetId: "enemy", options: { amount: "damageAmount-50" }, chanceOptionId: "50" };
const cSelection = { mode: "normal", structure: { kind: "flat", effects: [cLeaf] } };

test("missing storage returns independent empty v2 without writing", () => {
  const memory = memoryStorage(), storage = createPlayerBuildStorage(memory);
  const a = storage.load(), b = storage.load();
  assert.deepEqual(a, { ok: true, status: "empty", build: {
    schemaVersion: 2, battler: { bSelection: null, dSelection: null }, ducks: [] } });
  assert.notEqual(a.build, b.build);
  assert.notEqual(a.build.battler, b.build.battler);
  assert.equal(memory.writes, 0);
});

test("empty Duck has complete draft shape; factory called only once", () => {
  let calls = 0;
  const value = createEmptyDuck({ idFactory: () => { calls++; return "stable"; } });
  assert.deepEqual(value, { id: "stable", name: "", stats: { AT: null, DF: null, SP: null },
    diceFrame: null, dice: [0, 0, 0, 0, 0, 0], aSelection: null, cSelection: null });
  const build = addDuck(createEmptyPlayerBuild(), value);
  value.dice[0] = 4;
  assert.equal(build.ducks[0].dice[0], 0);
  assert.equal(calls, 1);
});

test("production UUIDs are fresh including after deletion", () => {
  const a = createEmptyDuck(), b = createEmptyDuck();
  assert.match(a.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const removed = deleteDuck(addDuck(createEmptyPlayerBuild(), a), a.id);
  const added = addDuck(removed);
  assert.equal(new Set([a.id, b.id, added.ducks[0].id]).size, 3);
});

test("more than three Ducks, B/D and A/C round-trip with detached references", () => {
  const memory = memoryStorage(), storage = createPlayerBuildStorage(memory);
  let build = createEmptyPlayerBuild();
  for (const id of ["A", "B", "C", "D", "E"]) build = addDuck(build, { ...duck(id), name: `型${id}`, aSelection, cSelection });
  build = updateBattler(build, { bSelection: { type: "trait", traitId: "draft", options: {} }, dSelection: { optionId: "add-self-0" } });
  assert.deepEqual(storage.save(build), { ok: true, status: "saved" });
  const loaded = createPlayerBuildStorage(memory).load();
  assert.equal(loaded.status, "loaded");
  assert.deepEqual(loaded.build, build);
  assert.notEqual(loaded.build, build);
  loaded.build.ducks[0].cSelection.structure.effects[0].options.amount = "changed";
  loaded.build.battler.bSelection.options.statusId = "changed";
  assert.deepEqual(storage.load().build, build);
  assert.equal(memory.writes, 1);
});

test("editing preserves ID and detaches patch, other Ducks and Battler", () => {
  const original = addDuck(initial(), duck("second"));
  const patch = { name: "速攻型", stats: { AT: 5, DF: 2, SP: 2 }, aSelection, cSelection };
  const edited = updateDuck(original, "first", patch);
  assert.equal(edited.ducks[0].id, "first");
  assert.equal(edited.ducks[0].name, "速攻型");
  assert.deepEqual(edited.ducks[1], original.ducks[1]);
  edited.ducks[0].aSelection.effects[0].effectId = "changed";
  edited.ducks[1].dice[0] = 6;
  edited.battler.dSelection = {};
  assert.equal(patch.aSelection.effects[0].effectId, "damage");
  assert.equal(original.ducks[1].dice[0], 0);
  assert.equal(original.battler.dSelection, null);
  assert.throws(() => updateDuck(original, "first", { id: "changed" }), TypeError);
});

test("duplication changes only ID and deeply detaches both Ducks", () => {
  const original = updateDuck(initial(), "first", { name: "基本型", aSelection, cSelection });
  const duplicated = duplicateDuck(original, "first", { idFactory: () => "copy" });
  assert.deepEqual(duplicated.ducks[1], { ...original.ducks[0], id: "copy" });
  duplicated.ducks[1].cSelection.structure.effects[0].options.amount = "changed";
  duplicated.ducks[0].dice[0] = 6;
  assert.equal(duplicated.ducks[0].cSelection.structure.effects[0].options.amount, "damageAmount-50");
  assert.equal(duplicated.ducks[1].dice[0], 0);
  assert.equal(original.ducks[0].dice[0], 0);
  assert.throws(() => duplicateDuck(original, "first", { idFactory: () => "first" }), TypeError);
});

test("delete removes only requested Duck; missing ID operations fail without mutation", () => {
  const original = updateBattler(addDuck(initial(), duck("second")), { dSelection: { optionId: "add-enemy-0" } });
  const deleted = deleteDuck(original, "first");
  assert.deepEqual(deleted.ducks, [original.ducks[1]]);
  assert.deepEqual(deleted.battler, original.battler);
  deleted.ducks[0].stats.SP = 9;
  assert.equal(original.ducks[1].stats.SP, null);
  for (const operation of [deleteDuck, duplicateDuck, (b, id) => updateDuck(b, id, {})]) {
    assert.throws(() => operation(original, "missing"), RangeError);
  }
  assert.equal(original.ducks.length, 2);
});

test("drafts and game-illegal choices remain persistable", () => {
  const storage = createPlayerBuildStorage(memoryStorage());
  let build = updateDuck(initial(), "first", { stats: { AT: -100, DF: null, SP: 999 },
    diceFrame: "future-frame", dice: [99, 99, 99, 99, 99, 99], aSelection: { triggerId: null, effects: [] },
    cSelection: { mode: null, structure: { kind: "random", branches: [{ effects: [null] }] } } });
  build = updateBattler(build, { bSelection: { type: null, options: { statusId: null } }, dSelection: {} });
  assert.equal(storage.save(build).ok, true);
  assert.deepEqual(storage.load().build, build);
});

test("current catalog selection DTOs persist unchanged across all categories and C structures", () => {
  const storage = createPlayerBuildStorage(memoryStorage());
  let build = initial();
  const roundTrip = () => { assert.equal(storage.save(build).ok, true); assert.deepEqual(storage.load().build, build); };
  for (const e of createASkillCatalog().effects) {
    build = updateDuck(build, "first", { aSelection: migrateSelection("A", { triggerId: "exact:0", effects: [{ effectId: e.id,
      ...(e.requiresAmount ? { amountOptionId: e.amountOptions[0].id } : {}), chanceOptionId: "70" }] }, createASkillCatalog()) });
    roundTrip();
  }
  const b = createBSkillCatalog();
  for (const e of [...b.events, ...b.traits]) {
    const options = Object.fromEntries(Object.entries(e.optionAxes).map(([axis, set]) => [axis, b.optionSets[set][0].id]));
    build = updateBattler(build, { bSelection: migrateSelection("B", e.triggerId
      ? { type: "event", triggerId: e.triggerId, conditionId: e.conditionId, effectId: e.effectId, options }
      : { type: "trait", traitId: e.id, options }, b) });
    roundTrip();
  }
  const c = createCSkillCatalog();
  for (const e of c.effects) {
    const leaf = { effectId: e.id, options: Object.fromEntries(Object.entries(e.optionAxes).map(([axis, set]) => [axis, c.optionSets[set][0].id])), chanceOptionId: "70" };
    const branch = { effects: [leaf] };
    for (const structure of [{ kind: "flat", ...branch }, { kind: "random", branches: [branch, branch] },
      { kind: "hpCondition", thresholdOptionId: c.optionSets.hpThreshold[0].id, branches: { met: branch, unmet: branch } }]) {
      build = updateDuck(build, "first", { cSelection: migrateSelection("C", { mode: e.id === "revive-self" ? "special" : "normal", structure }, c) });
      roundTrip();
    }
  }
  for (const e of D_SKILL_OPTIONS) { build = updateBattler(build, { dSelection: { optionId: e.id } }); roundTrip(); }
});

for (const [name, raw, status] of [
  ["broken JSON", "{", "corrupt"], ["unsupported version", '{"schemaVersion":99}', "unsupported-version"],
  ["null", "null", "corrupt"], ["wrong root", "[]", "corrupt"],
  ["missing fields", '{"schemaVersion":1}', "corrupt"],
  ["wrong version type", '{"schemaVersion":"1"}', "corrupt"],
  ["duplicate IDs", JSON.stringify({ ...initial(), ducks: [duck("same"), duck("same")] }), "corrupt"],
]) test(`${name}: load and save report failure without overwrite`, () => {
  const memory = memoryStorage(raw), storage = createPlayerBuildStorage(memory);
  for (let i = 0; i < 2; i++) {
    assert.equal(storage.load().status, status);
    assert.equal(storage.load().build, null);
    assert.deepEqual(storage.save(createEmptyPlayerBuild()), { ok: false, status });
  }
  assert.equal(memory.getItem(KEY), raw);
  assert.equal(memory.writes, 0);
});

test("invalid or non-JSON values and runtime payloads cannot overwrite storage", () => {
  const memory = memoryStorage(), storage = createPlayerBuildStorage(memory);
  storage.save(initial());
  const raw = memory.getItem(KEY);
  const mutations = [
    b => { b.engineState = {}; }, b => { b.battler.bSkills = []; },
    b => { b.ducks[0].aSelection = { trigger: {}, effect: [] }; },
    b => { b.ducks[0].aSelection = { effects: [{ effectId: "damage-enemy", amount: 500 }] }; },
    b => { b.ducks[0].cSelection = { mode: "normal", structure: { kind: "flat", effects: [{ effectId: "x", options: { x: { type: "heal" } } }] } }; },
    b => { b.battler.bSelection = createBSkillCatalog(); },
    b => { b.battler.dSelection = { optionId: "x", effect: {} }; },
    b => { b.ducks[0].stats.AT = NaN; }, b => { b.ducks[0].stats.DF = Infinity; },
    b => { b.ducks[0].aSelection = () => {}; }, b => { b.ducks[0].aSelection = new Date(); },
    b => { b.ducks[0].aSelection = Object.create({ nodeType: 1 }); },
    b => { b.ducks[0].aSelection = { triggerId: undefined }; },
    b => { b.ducks[0].aSelection = { triggerId: 1n }; },
    b => { b.ducks[0].aSelection = { triggerId: Symbol("id") }; },
    b => { b.ducks[0].aSelection = b; },
    b => { b.ducks[0].dice = Array(6); }, b => { b.ducks[0].dice.pop(); },
    b => { b.ducks[0].dice.extra = 1; }, b => { b[Symbol("hidden")] = 1; },
    b => { Object.defineProperty(b, "hidden", { value: 1 }); },
    b => { Object.defineProperty(b.ducks[0], "name", { enumerable: true, get() { throw Error("must not execute"); } }); },
    b => { b.toJSON = () => ({}); },
  ];
  for (const mutate of mutations) {
    const build = initial(); mutate(build);
    assert.equal(storage.save(build).status, "invalid-build");
    assert.equal(memory.getItem(KEY), raw);
  }
  assert.equal(memory.writes, 1);
});

test("storage access/quota errors are returned, never thrown", () => {
  const unavailable = createPlayerBuildStorage({ getItem() { throw Error("denied"); } });
  assert.equal(unavailable.load().status, "storage-error");
  assert.equal(unavailable.save(initial()).status, "storage-error");
  const full = createPlayerBuildStorage({ getItem() { return null; }, setItem() { throw Error("quota"); } });
  assert.equal(full.save(initial()).status, "storage-error");
});

test("invalid model operations reject bad IDs and unknown fields", () => {
  assert.throws(() => createEmptyDuck({ idFactory: () => "" }), TypeError);
  assert.throws(() => addDuck(initial(), duck("first")), TypeError);
  assert.throws(() => updateBattler(initial(), { aSelection }), TypeError);
  assert.throws(() => clonePlayerBuild({ ...initial(), battleResult: {} }), TypeError);
});
