import test from "node:test";
import assert from "node:assert/strict";
import { createBattleResultStorage, BATTLE_RESULT_INDEX_KEY } from "../js/battleResultStorage.js";

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)) };
}

test("battle result storage saves and loads an independent record", () => {
  const memory = memoryStorage();
  const storage = createBattleResultStorage(memory);
  const record = {
    battleId: "battle-smoke", dateISO: "2026-09-24T00:00:00.000Z",
    p1: { battlerId: "p1", battlerName: "1P", duckId: "d1", duckName: "赤" },
    p2: { battlerId: "p2", battlerName: "2P", duckId: "d2", duckName: "青" },
    result: "P1_win", events: [{ type: "battleEnd", result: "P1_win" }],
  };
  assert.equal(storage.save(record).ok, true);
  record.events[0].result = "draw";
  const loaded = storage.load("battle-smoke");
  assert.equal(loaded.ok, true);
  assert.equal(loaded.record.events[0].result, "P1_win");
  assert.deepEqual(JSON.parse(memory.getItem(BATTLE_RESULT_INDEX_KEY)), ["battle-smoke"]);
});
