export const BATTLE_RESULT_STORAGE_PREFIX = "diesDuckBattle:battle-result:v1:";
export const BATTLE_RESULT_INDEX_KEY = "diesDuckBattle:battle-result-index:v1";

const targetStorage = storage => storage ?? globalThis.localStorage;

function isSide(value) {
  return value && typeof value === "object"
    && ["battlerId", "battlerName", "duckId", "duckName"].every(key => typeof value[key] === "string");
}

function isRecord(value) {
  return value && typeof value === "object"
    && typeof value.battleId === "string" && value.battleId.length > 0
    && typeof value.dateISO === "string"
    && isSide(value.p1) && isSide(value.p2)
    && ["P1_win", "P2_win", "draw"].includes(value.result)
    && Array.isArray(value.events);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createBattleResultStorage(storage) {
  const getStorage = () => targetStorage(storage);

  function save(record) {
    if (!isRecord(record)) return { ok: false, status: "invalid-record" };
    try {
      const store = getStorage();
      store.setItem(BATTLE_RESULT_STORAGE_PREFIX + record.battleId, JSON.stringify(clone(record)));
      let index = [];
      try {
        const parsed = JSON.parse(store.getItem(BATTLE_RESULT_INDEX_KEY) ?? "[]");
        if (Array.isArray(parsed)) index = parsed.filter(id => typeof id === "string");
      } catch { /* A broken index must not prevent saving the battle itself. */ }
      store.setItem(BATTLE_RESULT_INDEX_KEY, JSON.stringify([
        record.battleId,
        ...index.filter(id => id !== record.battleId),
      ]));
      return { ok: true, status: "saved", battleId: record.battleId };
    } catch {
      return { ok: false, status: "storage-error" };
    }
  }

  function load(battleId) {
    if (typeof battleId !== "string" || !battleId) return { ok: false, status: "invalid-id", record: null };
    let raw;
    try { raw = getStorage().getItem(BATTLE_RESULT_STORAGE_PREFIX + battleId); }
    catch { return { ok: false, status: "storage-error", record: null }; }
    if (raw === null) return { ok: false, status: "not-found", record: null };
    try {
      const record = JSON.parse(raw);
      return isRecord(record) && record.battleId === battleId
        ? { ok: true, status: "loaded", record: clone(record) }
        : { ok: false, status: "corrupt", record: null };
    } catch {
      return { ok: false, status: "corrupt", record: null };
    }
  }

  return { save, load };
}

export function createBattleId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `battle-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
