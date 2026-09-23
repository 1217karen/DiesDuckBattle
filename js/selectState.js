import { clonePlayerBuild } from "./playerBuildModel.js";
import { inspectBattleLoadout } from "./battleLoadoutCompiler.js";
import { calcMaxHPFromStats } from "./statsUtil.js";
import { createASkillCatalog, getATriggerOptions } from "./aSkillCatalog.js";
import { createBSkillCatalog, getBSelectionDefinition } from "./bSkillCatalog.js";
import { createCSkillCatalog } from "./cSkillCatalog.js";
import { D_SKILL_OPTIONS } from "./dSkillCatalog.js";

export const SELF_BATTLER = Object.freeze({ id: "local-player", name: "自分" });
const loadMessages = {
  corrupt: "保存データが壊れているため読み込めません。既存データは変更していません。",
  "unsupported-version": "未対応の保存バージョンです。既存データは変更していません。",
  "storage-error": "保存領域にアクセスできません。ブラウザの設定を確認してください。",
};
export function createSelectState(result, metadata = SELF_BATTLER) {
  const readable = result.ok && ["empty", "loaded"].includes(result.status);
  return { build: readable ? clonePlayerBuild(result.build) : null,
    self: Object.freeze({ id: metadata.id, name: metadata.name }), selectedDuckId: null,
    loadStatus: result.status, message: readable ? "" : loadMessages[result.status] ?? "保存データを読み込めませんでした。" };
}
export function duckChoices(state) {
  return (state.build?.ducks ?? []).map((duck, index) => {
    const inspection = inspectBattleLoadout(state.build, duck.id);
    return { id: duck.id, name: duck.name || `アヒル ${index + 1}`, ready: inspection.ready,
      status: inspection.ready ? "選択可能" : inspection.invalid.length ? "使用不可" : "未完成",
      reasons: [...new Set([...inspection.invalid, ...inspection.incomplete].map(i => `${i.section}：${i.message}`))] };
  });
}
export function selectOwnDuck(state, id) {
  if (!state.build || !inspectBattleLoadout(state.build, id).ready) return state;
  return { ...state, selectedDuckId: id };
}
// Opponent source is deliberately unconnected in this stage.
export function battleStartStatus() { return { canStart: false, reason: "相手データ未接続" }; }
const label = (items, id) => items?.find(item => item.id === id)?.label ?? "未設定・不明な選択";
const ac = createASkillCatalog(), bc = createBSkillCatalog(), cc = createCSkillCatalog();
export function battlerSummary(battler) {
  if (!battler) return "B / D：読み込み待ち";
  const b = battler.bSelection, definition = b && getBSelectionDefinition(b, bc);
  const bText = !b ? "未設定" : !definition ? "未完成・設定を確認してください" :
    [definition.label ?? [definition.triggerLabel, definition.conditionLabel, definition.effectLabel].join(" / "),
      ...Object.entries(definition.optionAxes).map(([axis, set]) => label(bc.optionSets[set], b.options?.[axis]))].join(" / ");
  return `B：${bText}\nD：${battler.dSelection ? label(D_SKILL_OPTIONS, battler.dSelection.optionId) : "未設定"}`;
}
export function duckSummary(duck, displayName = duck?.name) {
  if (!duck) return "中央の1P DUCKからアヒルを選択してください。";
  const a = duck.aSelection, c = duck.cSelection;
  const aText = !a ? "未設定" : [label(getATriggerOptions(duck.diceFrame), a.triggerId), ...(a.effects ?? []).map(leaf => {
    const effect = ac.effects.find(e => e.id === leaf.effectId);
    return [effect?.label ?? "不明な効果", effect?.requiresAmount ? label(effect.amountOptions, leaf.amountOptionId) : "",
      leaf.chanceOptionId ? label(ac.chanceOptions, leaf.chanceOptionId) : ""].filter(Boolean).join(" / ");
  })].join(" → ");
  const branchText = branch => (branch?.effects ?? []).map(leaf => {
    const effect = cc.effects.find(e => e.id === leaf.effectId);
    return [effect?.label ?? "不明な効果", ...Object.entries(effect?.optionAxes ?? {}).map(([axis, set]) => label(cc.optionSets[set], leaf.options?.[axis])),
      leaf.chanceOptionId ? label(cc.chanceOptions, leaf.chanceOptionId) : ""].filter(Boolean).join(" / ");
  }).join(" ＋ ") || "未設定";
  const s = c?.structure;
  const cText = !c ? "未設定" : `${c.mode === "special" ? "特殊C" : "通常C"}：` +
    (s?.kind === "flat" ? branchText(s) : s?.kind === "random" ?
      (s.branches ?? []).map((b, i) => `分岐${i + 1}：${branchText(b)}`).join(" ／ ") :
      s?.kind === "hpCondition" ? `HP ${label(cc.optionSets.hpThreshold, s.thresholdOptionId)}以上：${branchText(s.branches?.met)} ／ 未満：${branchText(s.branches?.unmet)}` : "未設定");
  return `${displayName}\nAT ${duck.stats.AT} / DF ${duck.stats.DF} / SP ${duck.stats.SP}   HP ${calcMaxHPFromStats(duck.stats)}\nダイス：${duck.dice.join(" / ")}\nA：${aText}\nC：${cText}`;
}
