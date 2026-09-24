import test from "node:test";
import assert from "node:assert/strict";
import { buildBattlePresentationSnapshot } from "../js/battlePresentationSnapshot.js";
import { createEmptyPlayerPresentation } from "../js/playerPresentationModel.js";

function fixture() {
  const value = createEmptyPlayerPresentation();
  value.battler.defaultIconUrl = "https://example.com/default.png";
  value.battler.iconSlots[2] = "https://example.com/third.png";
  value.battler.standingImageUrl = "https://example.com/standing.png";
  value.ducks.first = { iconUrl: "https://example.com/first-duck.png" };
  value.ducks.second = { iconUrl: "https://example.com/second-duck.png" };
  return value;
}

test("snapshot keeps the default and selected Duck icons, excluding editable slot/standing data", () => {
  const value = fixture();
  const snapshot = buildBattlePresentationSnapshot(value, "second");
  assert.equal(snapshot.battlerDefaultIconUrl, value.battler.defaultIconUrl);
  assert.equal(snapshot.duckIconUrl, value.ducks.second.iconUrl);
  assert.deepEqual(Object.keys(snapshot).sort(), ["battlerDefaultIconUrl", "duckIconUrl", "quotes"]);
  assert.doesNotMatch(JSON.stringify(snapshot), /iconSlot|standingImageUrl/);
  assert.equal(buildBattlePresentationSnapshot(value, "missing").duckIconUrl, "");
});

const paths = [
  ["battleStart"],
  ["turn", "even"], ["turn", "lead"], ["turn", "behind"],
  ["phaseStart", "first"], ["phaseStart", "second"], ["phaseStart", "third"],
  ["skill", "A"], ["skill", "B"], ["skill", "C"], ["skill", "D"],
  ["battleEnd", "win"], ["battleEnd", "lose"], ["battleEnd", "draw"],
];
const at = (value, path) => path.reduce((node, key) => node[key], value);

test("all 14 quotes retain text and resolve slot 3 to iconSlots[2]", () => {
  const value = fixture();
  for (const path of paths) Object.assign(at(value.battler.quotes, path), { text: `セリフ ${path.join(".")}`, iconSlot: 3 });
  const before = structuredClone(value);
  const snapshot = buildBattlePresentationSnapshot(value, "first");
  for (const path of paths) assert.deepEqual(at(snapshot.quotes, path), {
    text: `セリフ ${path.join(".")}`, iconUrl: value.battler.iconSlots[2],
  });
  assert.deepEqual(value, before);
});

for (const [name, slot, url] of [["null slot", null, "third.png"], ["empty slot 3", 3, ""], ["blank slot 3", 3, "   "]]) {
  test(`${name} resolves to the default icon`, () => {
    const value = fixture();
    value.battler.iconSlots[2] = url;
    value.battler.quotes.battleStart = { text: "ここからだ！", iconSlot: slot };
    assert.deepEqual(buildBattlePresentationSnapshot(value, "first").quotes.battleStart, {
      text: "ここからだ！", iconUrl: value.battler.defaultIconUrl,
    });
  });
}

test("later edits, slot deletion and quote replacement cannot change an existing snapshot", () => {
  const value = fixture();
  value.battler.quotes.battleStart = { text: "開始！", iconSlot: 3 };
  const snapshot = buildBattlePresentationSnapshot(value, "first");
  const expected = structuredClone(snapshot);
  value.battler.defaultIconUrl = "changed.png";
  value.ducks.first.iconUrl = "changed-duck.png";
  value.battler.iconSlots[2] = "changed-slot.png";
  assert.deepEqual(snapshot, expected);
  value.battler.iconSlots.splice(2, 1);
  value.battler.quotes.battleStart.iconSlot = null;
  value.battler.quotes.battleStart.text = "変更";
  value.battler.quotes.turn = {};
  assert.deepEqual(snapshot, expected);
});

test("missing P2 presentation and partial drafts yield safe complete snapshots", () => {
  const empty = buildBattlePresentationSnapshot(undefined, "dev-duck");
  assert.equal(empty.battlerDefaultIconUrl, "");
  assert.equal(empty.duckIconUrl, "");
  for (const path of paths) assert.deepEqual(at(empty.quotes, path), { text: "", iconUrl: "" });
  for (const value of [null, {}, { battler: { quotes: {} }, ducks: {} }]) {
    assert.deepEqual(buildBattlePresentationSnapshot(value, "dev-duck"), empty);
  }
  const p2 = fixture();
  assert.equal(buildBattlePresentationSnapshot(p2, "second").duckIconUrl, p2.ducks.second.iconUrl);
});
