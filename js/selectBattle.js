import { compileBattleLoadout } from "./battleLoadoutCompiler.js";
import { battleStartStatus } from "./selectState.js";
import { runBattle } from "./battleEngine.js";

/** Both sides pass the production boundary again at start. No storage or DOM access. */
export function startSelectedBattle(state, { rng = Math.random, maxTurns = 50 } = {}) {
  const status = battleStartStatus(state);
  if (!status.canStart) return { ok: false, message: status.reason };
  const p1 = compileBattleLoadout(state.build, { duckId: state.selectedDuckId, battlerId: state.self.id, battlerName: state.self.name });
  const p2 = compileBattleLoadout(state.opponent.build, { duckId: state.opponentDuckId, battlerId: state.opponent.id, battlerName: state.opponent.name });
  if (!p1.ok || !p2.ok) return { ok: false, message: "設定を戦闘用に生成できませんでした。", inspections: { p1: p1.inspection, p2: p2.inspection } };
  // Engine indexes by ID: reject collisions instead of silently replacing one side.
  if (p1.battler.id === p2.battler.id || p1.duck.id === p2.duck.id)
    return { ok: false, message: "両者のIDが重複しているため戦闘を開始できません。" };
  const battle = runBattle({ p1: { battlerId: p1.battler.id, duckId: p1.duck.id },
    p2: { battlerId: p2.battler.id, duckId: p2.duck.id },
    data: { BATTLERS: [p1.battler, p2.battler], DUCKS: [p1.duck, p2.duck] }, rng, maxTurns });
  const battleStart = battle.events.find(event => event.type === "battleStart");
  return { ok: true, result: battle.result,
    label: { P1_win: "P1 WIN", P2_win: "P2 WIN", draw: "DRAW" }[battle.result],
    turns: battle.events.findLast(e => e.type === "battleEnd")?.turn ?? 0,
    events: battle.events,
    p1: battleStart?.meta?.P1 ?? null,
    p2: battleStart?.meta?.P2 ?? null };
}
