import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyDuck } from "../js/playerBuildModel.js";
import { createPlayerBuildStorage, PLAYER_BUILD_STORAGE_KEY } from "../js/playerBuildStorage.js";
import { createASkillCatalog } from "../js/aSkillCatalog.js";
import { createBSkillCatalog } from "../js/bSkillCatalog.js";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { createSelectState, duckChoices, selectOwnDuck, SELF_BATTLER, battleStartStatus, battlerSummary, duckSummary } from "../js/selectState.js";
function complete(id = "duck-1") {
  const a = createASkillCatalog().effects.find(e => e.id === "damage-enemy");
  const cCatalog = createCSkillCatalog();
  const c = cCatalog.effects.find(e => e.id === "damage-enemy");
  return { schemaVersion: 1,
    battler: { bSelection: { type: "trait", traitId: createBSkillCatalog().traits[0].id, options: {} },
      dSelection: { optionId: "add-self-0" } },
    ducks: [{ ...createEmptyDuck({ idFactory: () => id }), name: "基本型", stats: { AT: 2, DF: 2, SP: 3 }, diceFrame: "light",
      aSelection: { triggerId: "exact:0", effects: [{ effectId: a.id, amountOptionId: a.amountOptions.at(-1).id }] },
      cSelection: { mode: "normal", structure: { kind: "flat", effects: [{ effectId: c.id,
        options: Object.fromEntries(Object.entries(c.optionAxes).map(([axis, set]) => [axis, cCatalog.optionSets[set][0].id])) }] } } }] };
}

function memory(raw = null) { return { raw, writes:0, getItem() { return this.raw; }, setItem(key, value) {
  assert.equal(key, PLAYER_BUILD_STORAGE_KEY); this.raw = value; this.writes++;
} }; }
test("storage list retains ready, incomplete and invalid Ducks; only ready can be selected", () => {
  const build = complete();
  build.ducks.push(createEmptyDuck({ idFactory: () => "draft" }));
  const bad = complete("invalid").ducks[0]; bad.stats.AT = 100; build.ducks.push(bad);
  const source = memory(JSON.stringify(build)), repository = createPlayerBuildStorage(source);
  const state = createSelectState(repository.load()), choices = duckChoices(state);
  assert.deepEqual(choices.map(c => c.status), ["選択可能", "未完成", "使用不可"]);
  assert.equal(choices[1].name, "アヒル 2"); assert.ok(choices[1].reasons.length); assert.ok(choices[2].reasons.length);
  const selected = selectOwnDuck(state, "duck-1"); assert.equal(selected.selectedDuckId, "duck-1");
  for (const id of ["draft", "invalid", "missing"]) assert.equal(selectOwnDuck(selected, id), selected);
  assert.equal(state.selectedDuckId, null); assert.equal(source.writes, 0); assert.equal(source.raw, JSON.stringify(build));
});
test("1P Battler remains fixed through Duck changes and VS remains unavailable", () => {
  const build = complete(); build.ducks.push(complete("two").ducks[0]);
  let state = createSelectState({ ok:true, status:"loaded", build });
  for (const id of ["duck-1", "two"]) {
    state = selectOwnDuck(state,id); assert.deepEqual(state.self,SELF_BATTLER);
    assert.equal(Object.isFrozen(state.self),true); assert.equal(battleStartStatus(state).canStart,false);
  }
  assert.equal(battleStartStatus(state).reason,"相手を選択してください。");
});
test("unset shared Battler prevents selection of all Ducks", () => {
  const build = complete(); build.battler.bSelection = null;
  const state = createSelectState({ok:true,status:"loaded",build});
  assert.equal(duckChoices(state)[0].status,"未完成"); assert.equal(selectOwnDuck(state,"duck-1"),state);
});
test("empty storage makes an empty list without writes", () => {
  const source=memory(), state=createSelectState(createPlayerBuildStorage(source).load());
  assert.deepEqual(duckChoices(state),[]); assert.equal(state.loadStatus,"empty"); assert.equal(source.writes,0);
});
for (const [status,raw] of [["corrupt","{"],["unsupported-version",'{"schemaVersion":99}']]) test(`${status} is reported without destroying storage`, () => {
  const source=memory(raw), state=createSelectState(createPlayerBuildStorage(source).load());
  assert.equal(state.loadStatus,status); assert.equal(state.build,null); assert.ok(state.message);
  assert.deepEqual(duckChoices(state),[]); assert.equal(selectOwnDuck(state,"duck-1"),state);
  assert.equal(source.raw,raw); assert.equal(source.writes,0);
});
test("storage access error is reported", () => {
  const state=createSelectState(createPlayerBuildStorage({getItem(){throw new Error("blocked");}}).load());
  assert.equal(state.loadStatus,"storage-error"); assert.ok(state.message); assert.deepEqual(duckChoices(state),[]);
});
test("catalog summaries contain human labels, stats, HP and dice", () => {
  const build=complete(), b=battlerSummary(build.battler), d=duckSummary(build.ducks[0]);
  assert.match(b,/B：/); assert.match(b,/D：/); assert.doesNotMatch(b,/add-self-0/);
  for (const text of ["基本型","AT 2","DF 2","SP 3","HP 180","ダイス：","A：","C："]) assert.ok(d.includes(text),d);
  assert.doesNotMatch(d,/damage-enemy|exact:0|effectId/);
});
