import { compileBSkill } from "./bSkillCompiler.js";
import { runBattle } from "./battleEngine.js";
import { STATUS_GROUPS } from "./statusGroups.js";

// 開発battle設定。B selection・本番buildの制約とは独立。
export const B_TEST_FIELDS = Object.freeze([
  ...["p1", "p2"].flatMap(side => [
    ["HP", "開始HP", 0, 1000, 700], ["AP", "開始AP", 0, 1000, 5],
    ["AT", "AT", 0, 1000, 20], ["DF", "DF", 0, 1000, 3], ["SP", "SP", 1, 10, 1], ["Dice", "ダイス値", 0, 6, 1],
  ].map(([suffix, label, min, max, value]) => ({ key: `${side}${suffix}`, label: `${side.toUpperCase()} ${label}`, min, max, value }))),
  { key: "maxTurns", label: "最大ターン数", min: 1, max: 50, value: 3 },
]);
export function createBTestSettings() {
  return { ...Object.fromEntries(B_TEST_FIELDS.map(f => [f.key, f.value])),
    p1Status: Object.fromEntries(STATUS_GROUPS.all.map(key => [key, 0])),
    p2Status: Object.fromEntries(STATUS_GROUPS.all.map(key => [key, 0])),
    devHeal: { enabled: false, target: "self", amount: 30 } };
}
export function runBSkillTestBattle(selection, { catalog, settings = createBTestSettings(), rng = Math.random } = {}) {
  const compilation = compileBSkill(selection, { catalog });
  if (!compilation.ok) return { compilation, battle: null, finalState: null };
  for (const field of B_TEST_FIELDS) {
    const value = settings[field.key];
    if (!Number.isInteger(value) || value < field.min || value > field.max)
      throw new TypeError(`${field.label}は${field.min}～${field.max}の整数で指定してください。`);
  }
  for (const side of ["p1", "p2"]) {
    const status = settings[`${side}Status`];
    if (!status || Object.keys(status).some(key => !STATUS_GROUPS.all.includes(key))) throw new TypeError("不正なstatus初期値です。");
    for (const key of STATUS_GROUPS.all) if (!Number.isInteger(status[key]) || status[key] < 0 || status[key] > 3)
      throw new TypeError(`${side}の${key}は0～3の整数で指定してください。`);
  }
  const devHeal = settings.devHeal;
  if (!devHeal || typeof devHeal.enabled !== "boolean" || !["self", "enemy"].includes(devHeal.target)
    || !Number.isInteger(devHeal.amount) || devHeal.amount < 0 || devHeal.amount > 1000) throw new TypeError("開発用回復設定が不正です。");
  const setup = side => ({ id: `D_DEV_${side}`, name: "開発用初期値設定", effect: [
    ...["hp", "ap"].map(key => ({ type: "changeValue", target: "self", key, op: "set", value: settings[`${side}${key.toUpperCase()}`] })),
    ...STATUS_GROUPS.all.map(status => ({ type: "changeStatus", target: "self", status, op: "set", value: settings[`${side}Status`][status] })),
  ] });
  const helperRules = devHeal.enabled ? [{ id: "B_DEV_HEAL", name: "開発用：P1最初のフェイズで回復", trigger: "phaseStart",
    when: { all: [{ left: "turn", op: "==", right: 1 }, { left: "self.actionsThisTurn", op: "==", right: 1 }] },
    effect: { type: "heal", target: devHeal.target, amount: devHeal.amount, source: "devHeal" },
  }] : [];
  const data = { BATTLERS: [
    { id: "p1", name: "P1 B開発", dSkill: setup("p1"), bSkills: [...compilation.bSkills, ...helperRules] },
    { id: "p2", name: "P2 dummy（Bなし）", dSkill: setup("p2"), bSkills: [] },
  ], DUCKS: ["p1", "p2"].map((side, index) => ({ id: `d${index + 1}`, name: "開発dummy",
    stats: { maxHP: 1000, AT: settings[`${side}AT`], DF: settings[`${side}DF`], SP: settings[`${side}SP`] }, dice: [settings[`${side}Dice`]] })) };
  const battle = runBattle({ p1: { battlerId: "p1", duckId: "d1" }, p2: { battlerId: "p2", duckId: "d2" },
    data, maxTurns: settings.maxTurns, rng, field: "dev-no-field" });
  return { compilation, battle, finalState: battle.events.findLast(e => e.type === "battleEnd")?.state ?? null };
}
