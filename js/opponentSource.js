// Development-only selection fixtures. Never precompiled engine data.
import { clonePlayerBuild } from "./playerBuildModel.js";
const opponents = [
  { id: "dev-opponent-1", name: "練習相手・速攻（開発用）", build: makeBuild("dev-duck-1", "速攻型", { AT: 3, DF: 2, SP: 3 }, "light") },
  { id: "dev-opponent-2", name: "練習相手・耐久（開発用）", build: makeBuild("dev-duck-2", "耐久型", { AT: 2, DF: 5, SP: 1 }, "heavy") },
];
function makeBuild(id, name, stats, diceFrame) {
  return { schemaVersion: 1,
    battler: { bSelection: { type: "trait", traitId: "ap-at", options: {} }, dSelection: { optionId: "add-self-0" } },
    ducks: [{ id, name, stats, diceFrame, dice: [0,0,0,0,0,0],
      aSelection: { triggerId: "exact:0", effects: [{ effectId: "damage-enemy", amountOptionId: "amount-5" }] },
      cSelection: { mode: "normal", structure: { kind: "flat", effects: [{ effectId: "damage-enemy", options: { amount: "damageAmount-50" } }] } } }] };
}
/** Async source contract: summaries only; replace this module with an API adapter later. */
export async function listOpponents() { return opponents.map(({ id, name }) => ({ id, name })); }
/** Returns detached v1 selections, null when not found; source failures reject. */
export async function getOpponent(id) {
  const opponent = opponents.find(o => o.id === id);
  return opponent ? { id: opponent.id, name: opponent.name, build: clonePlayerBuild(opponent.build) } : null;
}
