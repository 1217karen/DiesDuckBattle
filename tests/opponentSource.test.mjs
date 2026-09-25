import test from "node:test";
import assert from "node:assert/strict";
import { createDevelopmentOpponentSource, listOpponents, getOpponent } from "../js/opponentSource.js";
import { createSelectState, selectOwnDuck, selectOpponent, battleStartStatus } from "../js/selectState.js";
import { startSelectedBattle } from "../js/selectBattle.js";

async function account() { return getOpponent((await listOpponents())[0].id); }
async function readyState(opponent) {
  const self = await getOpponent((await listOpponents())[1].id);
  return selectOpponent(selectOwnDuck(createSelectState({ ok:true, status:"loaded", build:self.build }), self.publicDuckId), opponent);
}

test("multiple Ducks yield one account summary and battle uses only the non-first public Duck", async () => {
  const current = await account();
  assert.ok(current.build.ducks.length > 1);
  assert.notEqual(current.publicDuckId, current.build.ducks[0].id);
  const source = createDevelopmentOpponentSource([current]);
  assert.deepEqual(await source.listOpponents(), [{ id:current.id, name:current.name }]);
  assert.equal((await listOpponents()).filter(o => o.id === current.id).length, 1);
  const battle = startSelectedBattle(await readyState(current), { rng: () => .5 });
  assert.equal(battle.ok, true);
  assert.equal(battle.p2.duckId, current.publicDuckId);
});

const unavailable = {
  unpublished: o => { o.publicDuckId = null; },
  empty: o => { o.publicDuckId = ""; },
  missing: o => { delete o.publicDuckId; },
  stale: o => { o.publicDuckId = "deleted-duck"; },
  deleted: o => { o.build.ducks = o.build.ducks.filter(d => d.id !== o.publicDuckId); },
  stats: o => { o.build.ducks.find(d => d.id === o.publicDuckId).stats.AT = 999; },
  A: o => { o.build.ducks.find(d => d.id === o.publicDuckId).aSelection = null; },
  C: o => { o.build.ducks.find(d => d.id === o.publicDuckId).cSelection = null; },
  B: o => { o.build.battler.bSelection = null; },
  D: o => { o.build.battler.dSelection = null; },
};
for (const [name, invalidate] of Object.entries(unavailable)) {
  test(`${name}: list and detail revalidate; state and battle reject without fallback`, async () => {
    const current = await account(), source = createDevelopmentOpponentSource([current]);
    const state = await readyState(current);
    assert.equal((await source.listOpponents()).length, 1);
    invalidate(current);
    assert.deepEqual(await source.listOpponents(), []);
    assert.equal(await source.getOpponent(current.id), null);
    // Also invalidate an already selected detached opponent, independently of the source.
    invalidate(state.opponent);
    assert.deepEqual(battleStartStatus(state), { canStart:false, reason:"この相手は現在対戦できません。" });
    assert.equal(startSelectedBattle(state).ok, false);
    assert.equal(startSelectedBattle(await readyState(current)).ok, false);
  });
}

test("reads resolve current build, name, presentation and public ID without a publication snapshot", async () => {
  const current = await account(), source = createDevelopmentOpponentSource([current]);
  const before = await source.getOpponent(current.id);
  current.publicDuckId = current.build.ducks[0].id;
  current.name = "現在の名前";
  current.build.ducks[0].name = "現在のDuck";
  current.presentation.battler.standingImageUrl = "current-standing.png";
  current.presentation.ducks[current.publicDuckId] = { iconUrl:"current-duck.png" };
  const after = await source.getOpponent(current.id);
  assert.equal(after.name, current.name);
  assert.equal(after.publicDuckId, current.publicDuckId);
  assert.equal(after.build.ducks[0].name, "現在のDuck");
  assert.equal(after.presentation.battler.standingImageUrl, "current-standing.png");
  assert.equal(after.presentation.ducks[current.publicDuckId].iconUrl, "current-duck.png");
  assert.notEqual(before.publicDuckId, after.publicDuckId);
  after.presentation.ducks[current.publicDuckId].iconUrl = "changed.png";
  assert.equal(current.presentation.ducks[current.publicDuckId].iconUrl, "current-duck.png");
  assert.deepEqual(Object.keys(after).sort(), ["build", "id", "name", "presentation", "publicDuckId"]);
});
