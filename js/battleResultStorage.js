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

  function list({ page = 1, pageSize = 30, order = "desc" } = {}) {
    const normalizedPage = Number.isInteger(page) && page > 0 ? page : 1;
    const normalizedPageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 30;
    const normalizedOrder = order === "asc" ? "asc" : "desc";
    let index;
    try {
      const raw = getStorage().getItem(BATTLE_RESULT_INDEX_KEY);
      if (raw === null) index = [];
      else {
        const parsed = JSON.parse(raw);
        index = Array.isArray(parsed) ? parsed : [];
      }
    } catch (error) {
      if (error instanceof SyntaxError) index = [];
      else return { ok: false, status: "storage-error", records: [], page: normalizedPage,
        pageSize: normalizedPageSize, total: 0, totalPages: 0 };
    }

    const records = [];
    const seen = new Set();
    for (const id of index) {
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      seen.add(id);
      const loaded = load(id);
      if (!loaded.ok) continue;
      const { events: _events, ...summary } = loaded.record;
      records.push(summary);
    }
    if (normalizedOrder === "asc") records.reverse();

    const total = records.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / normalizedPageSize);
    const actualPage = totalPages === 0 ? 1 : Math.min(normalizedPage, totalPages);
    const start = (actualPage - 1) * normalizedPageSize;
    return { ok: true, status: "listed", records: records.slice(start, start + normalizedPageSize),
      page: actualPage, pageSize: normalizedPageSize, total, totalPages };
  }

  return { save, load, list };
}

export function createBattleId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `battle-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
