import { migrateSelection } from "../js/selectionNormalization.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createPlayerBuildStorage, PLAYER_BUILD_STORAGE_KEY } from "../js/playerBuildStorage.js";
import { createSettingState, changeSetting, selectedDuck, selectedPublicDuckId, SP_OPTIONS, cBranches, createCStructure, duckSummary, battlerSummary } from "../js/settingState.js";
import { calcMaxHPFromStats } from "../js/statsUtil.js";
import { createASkillCatalog } from "../js/aSkillCatalog.js";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";

function setup(raw = null) {
  const memory = { raw, writes: 0, getItem(key) { return key === PLAYER_BUILD_STORAGE_KEY ? this.raw : null; },
    setItem(key, value) { assert.equal(key, PLAYER_BUILD_STORAGE_KEY); this.raw = value; this.writes++; } };
  const storage = createPlayerBuildStorage(memory);
  return { storage, memory, state: createSettingState(storage.load()) };
}
let serial = 0;
const apply = (state, action) => changeSetting(state, action, { idFactory: () => `test-${++serial}` });
const add = state => apply(state, { type: "add" });
const patch = (state, values) => apply(state, { type: "duck", patch: values });
const sp = (state, frame) => apply(state, { type: "sp", frame });

test("empty storage creates editable page state without writing or creating a Duck", () => {
  const { state, memory } = setup();
  assert.equal(state.loadStatus, "empty"); assert.equal(state.dirty, false);
  assert.equal(state.selectedDuckId, null); assert.deepEqual(state.build.ducks, []);
  assert.deepEqual(state.build.battler, { bSelection: null, dSelection: null });
  assert.equal(memory.writes, 0);
});
test("unreadable storage locks page state and cannot be edited", () => {
  for (const raw of ["{", '{"schemaVersion":2}']) {
    const { state, memory } = setup(raw);
    assert.equal(state.build, null); assert.equal(state.selectedDuckId, null);
    assert.throws(() => add(state)); assert.equal(memory.writes, 0); assert.equal(memory.raw, raw);
  }
  assert.equal(createSettingState({ ok: false, status: "storage-error" }).build, null);
});
test("multiple Ducks retain immediate edits across switches and selection alone is not dirty", () => {
  let state = setup().state;
  for (let i = 0; i < 5; i++) state = patch(add(state), { name: `設定${i}` });
  const ids = state.build.ducks.map(d => d.id);
  state = apply(state, { type: "select", id: ids[0] });
  state = patch(state, { stats: { AT: 3, DF: 2, SP: null }, name: "速攻型" });
  state = apply(state, { type: "select", id: ids[4] });
  assert.equal(selectedDuck(state).name, "設定4");
  state = apply(state, { type: "select", id: ids[0] });
  assert.equal(selectedDuck(state).name, "速攻型"); assert.equal(selectedDuck(state).stats.AT, 3);
  state = { ...state, dirty: false };
  assert.equal(apply(state, { type: "select", id: ids[1] }).dirty, false);
});
test("duplicate selects fresh ID, delete preserves other Ducks and Battler, zero Ducks allowed", () => {
  let state = patch(add(setup().state), { name: "基本型", aSelection: { triggerId: "exact:0", effects: [] } });
  state = apply(state, { type: "battler", patch: { dSelection: { optionId: "add-self-0" } } });
  const original = selectedDuck(state);
  state = apply(state, { type: "duplicate" });
  assert.notEqual(state.selectedDuckId, original.id);
  assert.deepEqual(selectedDuck(state), { ...original, id: state.selectedDuckId });
  assert.notEqual(selectedDuck(state).aSelection, state.build.ducks[0].aSelection);
  state = patch(state, { name: "複製の編集" });
  assert.equal(state.build.ducks[0].name, "基本型");
  state = apply(state, { type: "delete" });
  assert.equal(state.selectedDuckId, original.id); assert.equal(state.build.ducks.length, 1);
  state = apply(state, { type: "delete" });
  assert.equal(state.selectedDuckId, null); assert.deepEqual(state.build.ducks, []);
  assert.deepEqual(state.build.battler.dSelection, { optionId: "add-self-0" });
});
test("公開Duckは1体だけ切替でき、削除と複製が公開設定へ正しく連動する", () => {
  let state = patch(add(setup().state), { name: "A" });
  const a = state.selectedDuckId;
  state = patch(add(state), { name: "B" });
  const b = state.selectedDuckId;
  state = apply(state, { type: "set-public", id: a });
  assert.equal(selectedPublicDuckId(state), a);
  state = apply(state, { type: "set-public", id: b });
  assert.equal(selectedPublicDuckId(state), b);
  state = apply(state, { type: "select", id: a });
  state = apply(state, { type: "delete" });
  assert.equal(selectedPublicDuckId(state), b);
  state = apply(state, { type: "duplicate" });
  assert.equal(selectedPublicDuckId(state), b);
  assert.notEqual(state.selectedDuckId, b);
  state = apply(state, { type: "select", id: b });
  state = apply(state, { type: "delete" });
  assert.equal(state.publicSettings.publicDuckId, null);
  assert.equal(selectedPublicDuckId(state), null);
});

test("存在しない保存済み公開IDは画面上で未設定になり、公開変更はdirtyにする", () => {
  let state = createSettingState(setup().storage.load(), {
    ok: true, status: "loaded", settings: { schemaVersion: 1, publicDuckId: "missing" }
  });
  state = add(state);
  assert.equal(selectedPublicDuckId(state), null);
  state = { ...state, dirty: false };
  state = apply(state, { type: "set-public", id: state.selectedDuckId });
  assert.equal(state.dirty, true);
  assert.equal(selectedPublicDuckId(state), state.selectedDuckId);
});
test("公開設定storageが壊れていてもbuild編集stateはクラッシュせず、公開操作だけを止める", () => {
  let state = createSettingState(setup().storage.load(), {
    ok: false, status: "corrupt", settings: null
  });
  state = add(state);
  assert.equal(state.build.ducks.length, 1);
  assert.equal(state.publicSettings, null);
  assert.equal(state.publicLoadStatus, "corrupt");
  assert.throws(() => apply(state, { type: "set-public", id: state.selectedDuckId }));
});
test("SP mapping follows frames and does not rewrite invalid dice or A trigger", () => {
  assert.deepEqual(SP_OPTIONS, [{ id: "heavy", SP: 1 }, { id: "basic", SP: 2 }, { id: "light", SP: 3 }]);
  let state = patch(add(setup().state), { dice: [1, 1, 2, 2, 3, 4], aSelection: { triggerId: "exact:1", effects: [] } });
  for (const { id, SP } of SP_OPTIONS) {
    state = sp(state, id);
    assert.equal(selectedDuck(state).stats.SP, SP); assert.equal(selectedDuck(state).diceFrame, id);
    assert.deepEqual(selectedDuck(state).dice, [1, 1, 2, 2, 3, 4]);
    assert.equal(selectedDuck(state).aSelection.triggerId, "exact:1");
  }
  state = sp(state, "heavy");
  assert.equal(duckSummary(selectedDuck(state)).dice.label, "設定に問題あり");
  state = sp(state, null);
  assert.equal(selectedDuck(state).stats.SP, null); assert.equal(selectedDuck(state).diceFrame, null);
});
test("HP uses stats utility, stats/dice warnings do not block persistence", () => {
  const { storage } = setup();
  let state = sp(patch(add(setup().state), { stats: { AT: 3, DF: 2, SP: null } }), "light");
  let summary = duckSummary(selectedDuck(state));
  assert.equal(summary.stats.hp, calcMaxHPFromStats({ AT: 3, DF: 2, SP: 3 }));
  assert.equal(summary.stats.total, 8); assert.equal(summary.stats.label, "設定完了");
  state = patch(state, { stats: { AT: 5, DF: 5, SP: 3 }, dice: [1, 1, 1, 1, 1, 1] });
  summary = duckSummary(selectedDuck(state));
  assert.equal(summary.stats.label, "設定に問題あり"); assert.equal(summary.dice.label, "設定に問題あり");
  assert.equal(storage.save(state.build).ok, true);
});
test("A/B/C/D DTOs round-trip as the v2 model and summaries are not persisted", () => {
  const { storage } = setup();
  const a = createASkillCatalog().effects.find(e => e.id === "damage-enemy");
  const c = createCSkillCatalog(), effect = c.effects.find(e => e.id === "damage-enemy");
  const aSelection = migrateSelection("A", { triggerId: "exact:0", effects: [{ effectId: a.id, amountOptionId: a.amountOptions[0].id }] }, createASkillCatalog());
  const cSelection = migrateSelection("C", { mode: "normal", structure: { kind: "flat", effects: [{ effectId: effect.id,
    options: Object.fromEntries(Object.entries(effect.optionAxes).map(([axis, set]) => [axis, c.optionSets[set][0].id])) }] } }, c);
  let state = sp(patch(add(setup().state), { aSelection, cSelection, name: "基本型", stats: { AT: 2, DF: 3, SP: null } }), "heavy");
  state = apply(state, { type: "battler", patch: { bSelection: { type: "trait", traitId: "hp-high-at", options: {} }, dSelection: { optionId: "add-self-3" } } });
  const summary = duckSummary(selectedDuck(state));
  assert.equal(summary.A.ok, true); assert.equal(summary.C.ok, true);
  assert.ok(summary.A.resources.availablePoints > 0); assert.ok(summary.C.resources.requiredAP > 0);
  assert.equal(battlerSummary(state.build.battler).B.ok, true); assert.equal(battlerSummary(state.build.battler).D.ok, true);
  assert.equal(storage.save(state.build).ok, true);
  const restored = createSettingState(storage.load());
  assert.deepEqual(restored.build, state.build); assert.equal(restored.dirty, false);
  assert.equal(restored.selectedDuckId, state.build.ducks[0].id);
  assert.notEqual(restored.build, state.build);
  assert.deepEqual(Object.keys(restored.build), ["schemaVersion", "battler", "ducks"]);
  assert.deepEqual(selectedDuck(restored).aSelection, aSelection); assert.deepEqual(selectedDuck(restored).cSelection, cSelection);
});
test("all skills can be reset to null and empty stats can be saved", () => {
  const { storage } = setup();
  let state = patch(add(setup().state), { aSelection: {}, cSelection: {} });
  state = apply(state, { type: "battler", patch: { bSelection: {}, dSelection: {} } });
  state = patch(state, { aSelection: null, cSelection: null });
  state = apply(state, { type: "battler", patch: { bSelection: null, dSelection: null } });
  assert.equal(storage.save(state.build).ok, true);
  const restored = createSettingState(storage.load());
  assert.equal(selectedDuck(restored).aSelection, null); assert.equal(selectedDuck(restored).cSelection, null);
  assert.deepEqual(restored.build.battler, { bSelection: null, dSelection: null });
  assert.equal(duckSummary(selectedDuck(restored)).stats.hp, null);
});
test("C structures are independent drafts, with all branch shapes inspectable", () => {
  for (const [kind, count] of [["flat", 1], ["random2", 2], ["random3", 3], ["hpCondition", 2]]) {
    const structure = createCStructure(kind);
    const branches = cBranches({ mode: "normal", structure });
    assert.equal(branches.length, count);
    branches[0].branch.effects.push({ effectId: "" });
    if (count > 1) assert.equal(branches[1].branch.effects.length, 0);
    assert.equal(cBranches({ structure: createCStructure(kind) })[0].branch.effects.length, 0);
  }
});
test("loaded incomplete selections are readable without mutation", () => {
  let state = add(setup().state);
  for (const cSelection of [{}, { mode: null, structure: null }, { mode: "normal", structure: { kind: "random", branches: [null, {}] } },
    { mode: "special", structure: { kind: "hpCondition", branches: { met: null } } }]) {
    state = patch(state, { aSelection: { effects: [null] }, cSelection });
    const before = JSON.stringify(state.build);
    assert.equal(duckSummary(selectedDuck(state)).C.ok, false);
    assert.equal(JSON.stringify(state.build), before);
  }
});
