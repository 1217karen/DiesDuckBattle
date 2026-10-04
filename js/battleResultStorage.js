import { getSupabaseClient } from "./authRuntime.js";

// Dedicated RPC adapter; Auth session persistence stays in authRuntime.
export function createBattleResultStorage(client) {
  async function rpc(name, params) {
    try {
      const response = await (client ?? await getSupabaseClient()).rpc(name, params);
      return response.error ? { ok: false, status: "server-error" } : { ok: true, data: response.data };
    } catch { return { ok: false, status: "server-error" }; }
  }
  return {
    async save(record) {
      const side = value => ({ battlerId: value.battlerId, battlerName: value.battlerName,
        duckId: value.duckId, duckName: value.duckName, presentation: value.presentation });
      if (!record?.p1 || !record?.p2) return { ok: false, status: "invalid-record" };
      const result = await rpc("save_online_battle_result", {
        p_p1_account_id: record.p1.battlerId, p_p1_duck_id: record.p1.duckId,
        p_p2_account_id: record.p2.battlerId, p_p2_duck_id: record.p2.duckId,
        p_record: { p1: side(record.p1), p2: side(record.p2), result: record.result, events: record.events },
      });
      if (!result.ok) return result;
      const data = result.data;
      return data?.battleId && data?.battleNo && data?.dateISO
        ? { ok: true, status: "saved", ...data } : { ok: false, status: "server-error" };
    },
    async load(battleId) {
      if (!battleId) return { ok: false, status: "invalid-id", record: null };
      const result = await rpc("get_online_battle_result", { p_battle_id: battleId });
      if (!result.ok) return { ...result, record: null };
      return result.data === null ? { ok: false, status: "not-found", record: null }
        : { ok: true, status: "loaded", record: result.data };
    },
    async list({ page = 1, pageSize = 30, order = "desc" } = {}) {
      const result = await rpc("list_online_battle_results", { p_page: page, p_page_size: pageSize, p_order: order });
      return result.ok ? { ok: true, status: "listed", ...result.data } : { ...result, records: [] };
    },
  };
}
