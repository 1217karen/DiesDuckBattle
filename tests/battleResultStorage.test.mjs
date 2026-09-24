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

test("battle result list pages 35 records in both orders and skips broken entries", () => {
  const memory = memoryStorage();
  const storage = createBattleResultStorage(memory);
  for (let number = 1; number <= 35; number += 1) {
    assert.equal(storage.save({
      battleId: `battle-${number}`, dateISO: `2026-09-24T00:${String(number).padStart(2, "0")}:00.000Z`,
      p1: { battlerId: "p1", battlerName: "1P", duckId: "d1", duckName: "赤" },
      p2: { battlerId: "p2", battlerName: "2P", duckId: "d2", duckName: "青" },
      result: number % 2 ? "P1_win" : "P2_win", events: [{ type: "battleEnd" }],
    }).ok, true);
  }

  const newest = storage.list({ page: 1, pageSize: 30, order: "desc" });
  assert.deepEqual({ total: newest.total, totalPages: newest.totalPages, count: newest.records.length }, { total: 35, totalPages: 2, count: 30 });
  assert.equal(newest.records[0].battleId, "battle-35");
  assert.equal("events" in newest.records[0], false);

  const second = storage.list({ page: 2, pageSize: 30, order: "desc" });
  assert.equal(second.records.length, 5);
  assert.equal(second.records.at(-1).battleId, "battle-1");

  const oldest = storage.list({ page: 1, pageSize: 30, order: "asc" });
  assert.equal(oldest.records[0].battleId, "battle-1");
  assert.equal(oldest.records.at(-1).battleId, "battle-30");

  memory.setItem(BATTLE_RESULT_INDEX_KEY, JSON.stringify(["missing", "battle-35", "battle-35", 123]));
  const resilient = storage.list();
  assert.deepEqual(resilient.records.map(record => record.battleId), ["battle-35"]);
  memory.setItem(BATTLE_RESULT_INDEX_KEY, "not-json");
  assert.deepEqual(storage.list().records, []);
});
