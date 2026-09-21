import { compileCSkill } from "./cSkillCompiler.js";
import { runBattle } from "./battleEngine.js";

// ページ専用の検証条件。合法buildではなくCの接続確認用データ。
export const C_TEST_FIELDS = Object.freeze([
  { key: "p1HP", label: "P1開始HP", min: -10000, max: 1000, value: 1000 },
  { key: "p1AP", label: "P1開始AP", min: 0, max: 1000, value: 30 },
  { key: "p1Dice", label: "P1ダイス値", min: 0, max: 6, value: 2 },
  { key: "p2HP", label: "P2開始HP", min: -10000, max: 1000, value: 1000 },
  { key: "p2AP", label: "P2開始AP", min: 0, max: 1000, value: 0 },
  { key: "p2Dice", label: "P2ダイス値", min: 0, max: 6, value: 1 },
  { key: "maxTurns", label: "maxTurns", min: 1, max: 50, value: 3 },
]);
export function runCSkillTestBattle(selection, { catalog, rules, settings, rng = Math.random }) {
  const compilation = compileCSkill(selection, { catalog, rules });
  if (!compilation.ok) return { compilation, battle: null, finalState: null };
  for (const field of C_TEST_FIELDS) {
    const value = settings[field.key];
    if (!Number.isInteger(value) || value < field.min || value > field.max) throw new TypeError(`${field.label}は${field.min}～${field.max}の整数で指定してください。`);
  }
  const setup = side => ({ id: `D_DEV_${side}`, name: "開発用初期値設定", effect: [
    { type: "changeValue", target: "self", key: "hp", op: "set", value: settings[`${side}HP`] },
    { type: "changeValue", target: "self", key: "ap", op: "set", value: settings[`${side}AP`] },
  ] });
  const stats = { AT: 3, DF: 3, SP: 1, maxHP: 1000 }; // 開発専用。素体/build制約には接続しない。
  const data = { BATTLERS: [
    { id: "p1", name: "P1 開発", dSkill: setup("p1"), bSkills: settings.forceDeath ? [{
      id: "B_DEV_DEATH", name: "開発用：phaseEndでHP=-1", trigger: "phaseEnd",
      effect: { type: "changeValue", target: "self", key: "hp", op: "set", value: -1 },
    }] : [] },
    { id: "p2", name: "P2 dummy", dSkill: setup("p2") },
  ], DUCKS: [
    { id: "d1", name: "Cテスト", stats: { ...stats }, dice: [settings.p1Dice], cSkill: { id: "C_DEV", name: "C開発テスト", ...compilation.skill } },
    { id: "d2", name: "dummy", stats: { ...stats }, dice: [settings.p2Dice] },
  ] };
  const battle = runBattle({ p1: { battlerId: "p1", duckId: "d1" }, p2: { battlerId: "p2", duckId: "d2" },
    data, maxTurns: settings.maxTurns, rng, field: "dev-no-field" });
  return { compilation, battle, finalState: battle.events.findLast(e => e.type === "battleEnd")?.state ?? null };
}
