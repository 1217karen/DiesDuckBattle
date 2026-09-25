// Development-only selection fixtures. Never precompiled engine data.
import { clonePlayerBuild } from "./playerBuildModel.js";
import { clonePlayerPresentation } from "./playerPresentationModel.js";
import { inspectBattleLoadout } from "./battleLoadoutCompiler.js";
const opponents = [
  { id: "dev-opponent-1", name: "練習相手・速攻（開発用）", presentation: {}, publicDuckId: "dev-duck-1", build: makeBuild("dev-duck-1", "速攻型", { AT: 3, DF: 2, SP: 3 }, "light") },
  { id: "dev-opponent-2", name: "練習相手・耐久（開発用）", presentation: {}, publicDuckId: "dev-duck-2", build: makeBuild("dev-duck-2", "耐久型", { AT: 2, DF: 5, SP: 1 }, "heavy") },
];
// A private first Duck proves publication never falls back to array order.
opponents[0].build.ducks.unshift(makeBuild("dev-private-duck", "非公開型", { AT: 2, DF: 2, SP: 3 }, "light").ducks[0]);
function makeBuild(id, name, stats, diceFrame) {
  return { schemaVersion: 1,
    battler: { bSelection: { type: "trait", traitId: "ap-at", options: {} }, dSelection: { optionId: "add-self-0" } },
    ducks: [{ id, name, stats, diceFrame, dice: [0,0,0,0,0,0],
      aSelection: { triggerId: "exact:0", effects: [{ effectId: "damage-enemy", amountOptionId: "amount-5" }] },
      cSelection: { mode: "normal", structure: { kind: "flat", effects: [{ effectId: "damage-enemy", options: { amount: "damageAmount-50" } }] } } }] };
}
/** Development adapter over current account data; one summary per account, never per Duck.
 * Inject accounts in tests to exercise publication changes between list and detail reads.
 * No public combat copy is stored: every read inspects build + publicDuckId.
 */
export function createDevelopmentOpponentSource(accounts) {
  const available = account => inspectBattleLoadout(account.build, account.publicDuckId).ready;
  return {
    async listOpponents() {
      return accounts.filter(available).map(({ id, name }) => ({ id, name }));
    },
    async getOpponent(id) {
      const account = accounts.find(account => account.id === id);
      if (!account || !available(account)) return null;
      return { id: account.id, name: account.name, build: clonePlayerBuild(account.build),
        presentation: clonePlayerPresentation(account.presentation), publicDuckId: account.publicDuckId };
    },
  };
}
/** Async final public opponent contract. Source failures reject; unavailable accounts return null. */
export const { listOpponents, getOpponent } = createDevelopmentOpponentSource(opponents);
