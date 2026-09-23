import { clonePlayerBuild, createEmptyDuck, addDuck, duplicateDuck, updateDuck, deleteDuck, updateBattler } from "./playerBuildModel.js";
import { DICE_FRAMES, getDiceFrame } from "./diceFrames.js";
import { calcMaxHPFromStats } from "./statsUtil.js";
import { createBuildRules } from "./buildRules.js";
import { calculateBuildResources } from "./buildResources.js";
import { calculateASkillResources } from "./aSkillResources.js";
import { compileASkill } from "./aSkillCompiler.js";
import { compileBSkill } from "./bSkillCompiler.js";
import { calculateCSkillResources } from "./cSkillResources.js";
import { compileCSkill } from "./cSkillCompiler.js";
import { compileDSkill } from "./dSkillCompiler.js";

export const SP_OPTIONS = Object.entries(DICE_FRAMES).map(([id, frame]) => ({ id, SP: frame.SP }))
  .sort((a, b) => a.SP - b.SP);

export function createSettingState(result) {
  const editable = result.ok && ["empty", "loaded"].includes(result.status);
  const build = editable ? clonePlayerBuild(result.build) : null;
  return { build, selectedDuckId: build?.ducks[0]?.id ?? null, loadStatus: result.status, dirty: false };
}
export const selectedDuck = state => state.build?.ducks.find(d => d.id === state.selectedDuckId) ?? null;

/** Page state is transient. Only state.build is ever sent to storage. */
export function changeSetting(state, action, { idFactory } = {}) {
  if (!state.build) throw new Error("保存データを読み込めないため編集できません。");
  let build = state.build, selectedDuckId = state.selectedDuckId;
  const current = selectedDuck(state);
  switch (action.type) {
    case "select":
      if (!build.ducks.some(d => d.id === action.id)) throw new RangeError("Unknown Duck ID");
      return { ...state, selectedDuckId: action.id };
    case "add":
      build = addDuck(build, createEmptyDuck({ idFactory })); selectedDuckId = build.ducks.at(-1).id; break;
    case "duplicate":
      build = duplicateDuck(build, selectedDuckId, { idFactory }); selectedDuckId = build.ducks.at(-1).id; break;
    case "delete": {
      const index = build.ducks.findIndex(d => d.id === selectedDuckId);
      build = deleteDuck(build, selectedDuckId);
      selectedDuckId = build.ducks[Math.min(index, build.ducks.length - 1)]?.id ?? null; break;
    }
    case "duck": build = updateDuck(build, selectedDuckId, action.patch); break;
    case "battler": build = updateBattler(build, action.patch); break;
    case "sp": {
      const frame = action.frame === null ? null : getDiceFrame(action.frame);
      if (action.frame !== null && !frame) throw new RangeError("Unknown dice frame");
      build = updateDuck(build, selectedDuckId, { diceFrame: action.frame,
        stats: { ...current.stats, SP: frame?.SP ?? null } }); break;
    }
    default: throw new TypeError("Unknown setting action");
  }
  return { ...state, build, selectedDuckId, dirty: true };
}

export function cBranches(selection) {
  const s = selection?.structure;
  if (s?.kind === "flat") return [{ key: "flat", label: "効果", branch: s }];
  if (s?.kind === "random" && Array.isArray(s.branches)) return s.branches.map((branch, i) =>
    ({ key: i, label: `分岐 ${i + 1}（等確率）`, branch }));
  if (s?.kind === "hpCondition") return [
    { key: "met", label: "自分のHPが指定割合以上", branch: s.branches?.met },
    { key: "unmet", label: "自分のHPが指定割合未満", branch: s.branches?.unmet },
  ];
  return [];
}

/** An explicit structure switch starts empty branches, never a different legal build. */
export function createCStructure(kind) {
  if (kind === "flat") return { kind, effects: [] };
  if (kind === "random2" || kind === "random3") return { kind: "random",
    branches: Array.from({ length: Number(kind.at(-1)) }, () => ({ effects: [] })) };
  if (kind === "hpCondition") return { kind, branches: { met: { effects: [] }, unmet: { effects: [] } } };
  throw new RangeError("Unknown C structure");
}

// Presentation only: legality stays with production resources/compilers.
const messages = {
  INVALID_SELECTION: "設定項目を選択してください。", INVALID_SELECTION_FIELDS: "選択形式を確認してください。",
  INVALID_SELECTION_TYPE: "イベント型または特性型を選択してください。", INVALID_ID: "選択項目が未入力です。",
  UNKNOWN_OR_ILLEGAL_OPTION: "発動タイミング・条件・効果の組合せを確認してください。",
  INVALID_OPTION_FIELDS: "必要な追加項目を選択してください。", UNKNOWN_OPTION: "選択項目を確認してください。",
  OPTION_UNSELECTED: "効果量・状態・HP条件などの選択が未完了です。", AMOUNT_UNSELECTED: "効果量を選択してください。",
  UNKNOWN_EFFECT: "効果を選択し直してください。", INVALID_EFFECT: "効果を選択してください。",
  INVALID_MODE: "通常Cまたは特殊Cを選択してください。", INVALID_STRUCTURE: "分岐方式を選択してください。",
  UNKNOWN_STRUCTURE: "分岐方式を選択し直してください。", INVALID_BRANCH: "分岐の効果を設定してください。",
  INVALID_EFFECTS: "効果を追加してください。", EMPTY_BRANCH: "各分岐に効果が必要です。",
  EFFECT_COUNT: "効果数が設定可能な範囲外です。", BRANCH_COUNT: "ランダム分岐は2択または3択にしてください。",
  SPECIAL_FLAT_ONLY: "特殊Cは分岐なしで設定してください。", MODE_UNAVAILABLE: "現在のC種類では使えない効果です。",
  INVALID_OPTIONS: "効果の追加項目を選択してください。", UNKNOWN_CHANCE_OPTION: "成功率を選択し直してください。",
  CHANCE_NOT_ALLOWED: "この効果には成功率を指定できません。効果を選択し直してください。",
  UNKNOWN_FIELD: "現在の選択に不要な項目があります。該当する設定を選択し直してください。",
};
function skillStatus(selection, compile) {
  if (selection === null) return { label: "未設定", ok: false, messages: [] };
  const result = compile();
  return { label: result.ok ? "設定完了" : "設定に問題あり", ok: result.ok,
    messages: [...new Set([...(result.errors ?? []), ...(result.unresolved ?? [])]
      .map(issue => issue.message ?? messages[issue.code] ?? "未入力または使用できない選択があります。設定を確認してください。"))] };
}
export function battlerSummary(battler) {
  return { B: skillStatus(battler.bSelection, () => compileBSkill(battler.bSelection)),
    D: skillStatus(battler.dSelection, () => compileDSkill(battler.dSelection)) };
}
export function duckSummary(duck) {
  const rules = createBuildRules(), frame = getDiceFrame(duck.diceFrame);
  const resources = calculateBuildResources(duck, rules);
  const missing = Object.values(duck.stats).some(v => v === null) || duck.diceFrame === null;
  const statMessages = [];
  for (const key of ["AT", "DF"]) {
    const v = duck.stats[key], limit = rules.stats[key];
    if (v !== null && (!Number.isSafeInteger(v) || v < limit.min || v > limit.max))
      statMessages.push(`${key}は${limit.min}～${limit.max}の整数で設定してください。`);
  }
  if ((duck.diceFrame !== null && !frame) || duck.stats.SP !== (frame?.SP ?? null)) statMessages.push("SPを選択し直してください。");
  if (resources.stats?.remaining < 0) statMessages.push(`AT・DF・SPの合計は${rules.stats.totalMax}以下にしてください。`);
  // Reuse A's existing dice validation even when A itself is unset.
  const aResources = calculateASkillResources(duck, duck.aSelection);
  const diceErrors = aResources.errors.filter(e => e.code === "INVALID_DICE_RESOURCES");
  return {
    stats: { label: statMessages.length ? "設定に問題あり" : missing ? "未設定" : "設定完了", messages: statMessages,
      hp: Object.values(duck.stats).every(Number.isFinite) ? calcMaxHPFromStats(duck.stats) : null,
      total: resources.stats?.used ?? null },
    dice: { label: !frame ? "SP未設定／不正" : diceErrors.length ? "設定に問題あり" : "設定完了",
      messages: diceErrors.map(e => e.message), resources: resources.dice },
    A: { ...skillStatus(duck.aSelection, () => compileASkill(duck, duck.aSelection)), resources: aResources },
    C: { ...skillStatus(duck.cSelection, () => compileCSkill(duck.cSelection)), resources: calculateCSkillResources(duck.cSelection) },
  };
}
