import { createOnlinePlayerStorage, onlineFailure } from "./onlinePlayerStorage.js";
import { decodeOnlinePlayer, isOnlineUuid } from "./onlinePlayerDto.js";
import { canonicalEno } from "../supabase/functions/_shared/internal-email.mjs";

export const selectFailure = status => ({ ok: false, status, message: {
  "public-unavailable": "相手の公開Duckが解除・変更されたか、選択したDuckがなくなりました。読み込み直して選び直してください。",
  "migration-required": "オンライン対戦のDB準備が完了していません。公開境界のmigration適用後に読み込み直してください。",
  "unsupported-data": "対戦データの形式に対応していません。設定を確認してください。",
  "load-failed": "対戦データを取得できませんでした。通信状況を確認して再読み込みしてください。",
}[status] ?? onlineFailure(status).message });

export function decodePublicOpponent(snapshot, ownId) {
  if (!snapshot || !isOnlineUuid(snapshot.gameAccountId) || snapshot.gameAccountId === ownId
      || !isOnlineUuid(snapshot.publicDuckId) || snapshot.ducks?.length !== 1
      || snapshot.ducks[0].id !== snapshot.publicDuckId) throw new TypeError("Invalid public opponent");
  const data = decodeOnlinePlayer(snapshot);
  if (Object.keys(data.presentation.ducks).some(id => id !== snapshot.publicDuckId)) throw new TypeError("Invalid public projection");
  return { id: snapshot.gameAccountId, eno: canonicalEno(snapshot.eno), name: data.battlerName,
    publicDuckId: snapshot.publicDuckId, build: data.build, presentation: data.presentation };
}

/** Only dedicated public projections are read. Never fall back to whole Battler/Duck tables. */
export function createOnlineSelectService(client, ownStorage = createOnlinePlayerStorage(client)) {
  async function check(base) {
    const scope = await ownStorage.resolveAccount();
    if (!scope.ok) return scope;
    return base?.authUserId === scope.authUserId && base?.account.id === scope.account.id && base?.account.eno === scope.account.eno
      ? scope : onlineFailure("session-changed");
  }
  async function read(base, name, params, decode) {
    try {
      const before = await check(base); if (!before.ok) return before;
      const response = await client.rpc(name, params);
      const after = await check(base); if (!after.ok) return after;
      if (response.error) return selectFailure(["PGRST202", "42883", "42501"].includes(response.error.code) ? "migration-required" : "load-failed");
      if (response.data === null) return selectFailure("public-unavailable");
      try { return { ok: true, ...decode(response.data) }; } catch { return selectFailure("unsupported-data"); }
    } catch { return selectFailure("load-failed"); }
  }
  return {
    async loadSelf() {
      const loaded = await ownStorage.load();
      if (!loaded.ok) return loaded;
      const scope = await check(loaded);
      return scope.ok ? loaded : scope;
    },
    check,
    listOpponents: base => read(base, "list_online_opponents", {}, rows => {
      if (!Array.isArray(rows)) throw new TypeError();
      return { opponents: rows.filter(row => row.id !== base.account.id).map(row => {
        if (!isOnlineUuid(row.id) || !isOnlineUuid(row.publicDuckId) || typeof row.name !== "string") throw new TypeError();
        return { id: row.id, eno: canonicalEno(row.eno), name: row.name, publicDuckId: row.publicDuckId };
      }) };
    }),
    getOpponent(base, id) {
      if (!isOnlineUuid(id) || id === base.account.id) return Promise.resolve(selectFailure("public-unavailable"));
      return read(base, "get_online_opponent", { p_game_account_id: id }, snapshot => {
        if (snapshot.gameAccountId !== id) throw new TypeError();
        return { opponent: decodePublicOpponent(snapshot, base.account.id) };
      });
    },
    prepare(base, duckId, opponent) {
      if (!isOnlineUuid(duckId) || !isOnlineUuid(opponent?.id) || !isOnlineUuid(opponent.publicDuckId))
        return Promise.resolve(selectFailure("public-unavailable"));
      return read(base, "prepare_online_battle", { p_game_account_id: base.account.id, p_duck_id: duckId,
        p_opponent_account_id: opponent.id, p_opponent_duck_id: opponent.publicDuckId }, pair => {
        const self = pair.self;
        if (!self || self.gameAccountId !== base.account.id || self.eno !== base.account.eno
          || pair.opponent?.gameAccountId !== opponent.id || pair.opponent.publicDuckId !== opponent.publicDuckId) throw new TypeError();
        const data = decodeOnlinePlayer(self);
        if (!data.build.ducks.some(duck => duck.id === duckId)) throw new TypeError();
        return { self: { ...base, revision: self.revision, data }, opponent: decodePublicOpponent(pair.opponent, base.account.id) };
      });
    },
  };
}
