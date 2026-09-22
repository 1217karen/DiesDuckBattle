import { compileDSkill } from "./dSkillCompiler.js";
import { runBattle } from "./battleEngine.js";

// 初期diceは開発用に各1個。Dの値・対象はselectionからcompilerだけが決定する。
export function runDSkillTestBattle(selection, { p1Dice = 1, p2Dice = 2, rng = Math.random } = {}) {
  const compilation = compileDSkill(selection);
  if (!compilation.ok) return { compilation, battle: null };
  for (const value of [p1Dice, p2Dice]) {
    if (!Number.isInteger(value) || value < 0 || value > 6)
      throw new TypeError("初期ダイスは0～6の整数で指定してください。");
  }
  const stats = { AT: 1, DF: 1, SP: 1, maxHP: 1000 };
  const data = {
    BATTLERS: [
      { id: "p1", name: "P1 D確認", dSkill: compilation.skill },
      { id: "p2", name: "P2 dummy" },
    ],
    DUCKS: [
      { id: "d1", name: "Dテスト", stats: { ...stats }, dice: [p1Dice] },
      { id: "d2", name: "dummy", stats: { ...stats }, dice: [p2Dice] },
    ],
  };
  const battle = runBattle({ p1: { battlerId: "p1", duckId: "d1" }, p2: { battlerId: "p2", duckId: "d2" },
    data, maxTurns: 3, rng, field: "dev-no-field" });
  return { compilation, battle };
}
