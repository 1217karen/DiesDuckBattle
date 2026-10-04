import { createSelectState, selectOwnDuck, selectOpponent, battleStartStatus } from "./selectState.js";
import { startSelectedBattle } from "./selectBattle.js";
import { compileBattleLoadout } from "./battleLoadoutCompiler.js";
import { buildBattlePresentationSnapshot } from "./battlePresentationSnapshot.js";
import { createBattleResultStorage } from "./battleResultStorage.js";
import { selectFailure } from "./onlineSelectService.js";

const scopeErrors = new Set(["not-signed-in", "no-access", "selection-required", "session-changed", "forbidden"]);
export function createOnlineSelectController({ service, results = createBattleResultStorage(), run = startSelectedBattle }) {
  let generation = 0, base = null, busy = "", message = "オンライン設定を読み込み中…", blocked = true;
  let state = createSelectState({ ok: false, status: "loading" });
  const listeners = new Set();
  const snapshot = () => structuredClone({ state, ownPresentation: base?.data.presentation, eno: base?.account.eno,
    authUserId: base?.authUserId, busy, message, canStart: !busy && !blocked && battleStartStatus(state).canStart });
  const emit = () => listeners.forEach(listener => listener(snapshot()));
  function invalidate(reason = "ログイン状態が変わりました。オンライン設定を読み込み直してください。") {
    generation++; base = null; state = createSelectState({ ok: false, status: "session-changed" });
    busy = ""; message = reason; blocked = true; emit();
  }
  function fail(result) {
    if (scopeErrors.has(result.status)) invalidate(result.message);
    else {
      if (result.status === "public-unavailable") state = selectOpponent(state, null);
      message = result.message; blocked = true;
    }
    return result;
  }
  function install(loaded, selected = null, opponent = null) {
    base = structuredClone(loaded);
    state = createSelectState({ ok: true, status: "loaded", build: loaded.data.build }, { id: loaded.account.id, name: loaded.data.battlerName });
    if (selected) state = selectOwnDuck(state, selected);
    if (opponent) { state = selectOpponent(state, opponent); state.opponent.eno = opponent.eno; }
    message = ""; blocked = false;
  }
  async function task(kind, work) {
    if (busy) return { ok: false, status: "busy" };
    const ticket = generation; busy = kind; emit();
    try { return await work(() => ticket === generation); }
    catch { if (ticket === generation) return fail(selectFailure("load-failed")); return { ok: false, status: "stale" }; }
    finally { if (ticket === generation) { busy = ""; emit(); } }
  }
  return {
    snapshot, invalidate,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    cancelSelection() { if (["list", "opponent"].includes(busy)) { generation++; busy = ""; emit(); } },
    load: () => task("load", async current => {
      const loaded = await service.loadSelf(); if (!current()) return { ok: false, status: "stale" };
      if (!loaded.ok) return fail(loaded); install(loaded); return loaded;
    }),
    chooseOwn(id) { if (!busy && base && !blocked) { state = selectOwnDuck(state, id); emit(); } },
    listOpponents: () => task("list", async current => {
      if (!base) return fail(selectFailure("not-signed-in"));
      const result = await service.listOpponents(base); if (!current()) return { ok: false, status: "stale" };
      if (!result.ok) return fail(result); message = ""; blocked = false; return result;
    }),
    chooseOpponent: id => task("opponent", async current => {
      if (!base) return fail(selectFailure("not-signed-in"));
      state = selectOpponent(state, null);
      const result = await service.getOpponent(base, id); if (!current()) return { ok: false, status: "stale" };
      if (!result.ok) return fail(result);
      state = selectOpponent(state, result.opponent); state.opponent.eno = result.opponent.eno;
      message = ""; blocked = false; return result;
    }),
    checkScope: () => task("scope", async current => {
      if (!base) return;
      const result = await service.check(base); if (current() && !result.ok) fail(result);
    }),
    start() {
      if (!snapshot().canStart) return Promise.resolve({ ok: false, status: "blocked" });
      return task("battle", async current => {
        const duckId = state.selectedDuckId;
        const prepared = await service.prepare(base, duckId, state.opponent);
        if (!current()) return { ok: false, status: "stale" };
        if (!prepared.ok) return fail(prepared);
        install(prepared.self, duckId, prepared.opponent);
        if (!battleStartStatus(state).canStart) return fail({ ok: false, status: "not-ready", message: "最新の設定が未完成または不正です。設定を確認して選び直してください。" });
        const frozen = structuredClone(state);
        const p1 = compileBattleLoadout(frozen.build, { duckId, battlerId: frozen.self.id, battlerName: frozen.self.name });
        const p2 = compileBattleLoadout(frozen.opponent.build, { duckId: frozen.opponent.publicDuckId, battlerId: frozen.opponent.id, battlerName: frozen.opponent.name });
        if (!p1.ok || !p2.ok) return fail(selectFailure("unsupported-data"));
        const display1 = buildBattlePresentationSnapshot(base.data.presentation, duckId);
        const display2 = buildBattlePresentationSnapshot(frozen.opponent.presentation, frozen.opponent.publicDuckId);
        const battle = run(frozen);
        if (!current()) return { ok: false, status: "stale" };
        if (!battle.ok) return fail({ ...battle, message: "最新の設定から戦闘を開始できませんでした。" });
        const side = (loadout, presentation) => ({ battlerId: loadout.battler.id, battlerName: loadout.battler.name,
          duckId: loadout.duck.id, duckName: loadout.duck.name, presentation });
        const saved = await results.save({
          p1: side(p1, display1), p2: side(p2, display2), result: battle.result, events: battle.events });
        if (!current()) return { ok: false, status: "stale" };
        if (!saved.ok) return fail({ ok: false, status: "result-save-failed", message: "戦闘結果をサーバーに保存できませんでした。通信状況を確認して再試行してください。" });
        blocked = true; message = "戦闘結果を開きます…";
        return { ok: true, battleId: saved.battleId };
      });
    },
  };
}
