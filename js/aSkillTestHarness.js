import { compileASkill } from "./aSkillCompiler.js";
import { runBattle } from "./battleEngine.js";

// 開発接続確認専用。初期6枠をそのまま使用、statsは戦闘確認用固定値。
export function runASkillTestBattle(build, selection, { catalog, rules, rng = Math.random } = {}) {
  const compilation = compileASkill(build, selection, { catalog, rules });
  if (!compilation.ok) return { compilation, battle: null };
  const stats = { AT: 3, DF: 3, SP: 1, maxHP: 1000 };
  const battle = runBattle({
    p1: { battlerId: "p1", duckId: "d1" }, p2: { battlerId: "p2", duckId: "d2" },
    data: { BATTLERS: [{ id: "p1", name: "P1 開発" }, { id: "p2", name: "P2 dummy" }], DUCKS: [
      { id: "d1", name: "Aテスト", stats: { ...stats }, dice: [...build.dice], aSkill: { id: "A_DEV", name: "選択したA", ...compilation.skill } },
      { id: "d2", name: "dummy", stats: { ...stats }, dice: [1] },
    ] }, maxTurns: 3, rng, field: "dev-no-field",
  });
  return { compilation, battle };
}
