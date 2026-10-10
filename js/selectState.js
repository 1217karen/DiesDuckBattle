import { presentSkillSummary } from "./skillSummaryPresentation.js";
import { clonePlayerBuild } from "./playerBuildModel.js";
import { clonePlayerPresentation } from "./playerPresentationModel.js";
import { inspectBattleLoadout } from "./battleLoadoutCompiler.js";
import { calcMaxHPFromStats } from "./statsUtil.js";

export const SELF_BATTLER = Object.freeze({ id: "local-player", name: "自分" });
const loadMessages = {
  "migration-required": "旧保存データを安全に移行できませんでした。既存データは変更していません。",
  corrupt: "保存データが壊れているため読み込めません。既存データは変更していません。",
  "unsupported-version": "未対応の保存バージョンです。既存データは変更していません。",
  "storage-error": "保存領域にアクセスできません。ブラウザの設定を確認してください。",
};
export function createSelectState(result, metadata = SELF_BATTLER) {
  const readable = result.ok && ["empty", "loaded"].includes(result.status);
  return { build: readable ? clonePlayerBuild(result.build, { allowOverlongText: true }) : null,
    self: Object.freeze({ id: metadata.id, name: metadata.name }), selectedDuckId: null, opponent: null,
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
export function selectOpponent(state, opponent) {
  return { ...state, opponent: opponent ? { id: opponent.id, name: opponent.name,
    build: clonePlayerBuild(opponent.build, { allowOverlongText: true }), presentation: clonePlayerPresentation(opponent.presentation),
    publicDuckId: opponent.publicDuckId } : null };
}
export function battleStartStatus(state) {
  if (!state?.build || !inspectBattleLoadout(state.build, state.selectedDuckId).ready)
    return { canStart: false, reason: "1Pの使用可能なDuckを選択してください。" };
  if (!state.opponent) return { canStart: false, reason: "相手を選択してください。" };
  if (!inspectBattleLoadout(state.opponent.build, state.opponent.publicDuckId).ready)
    return { canStart: false, reason: "この相手は現在対戦できません。" };
  return { canStart: true, reason: "準備完了 — VSで戦闘開始" };
}
// Presentation owns wording and validation. Malformed saved values must not be guessed.
function skillText(selection, present) {
  if (selection == null) return "未設定";
  try {
    const view = present();
    if (view.complete && view.text) return view.text;
  } catch { /* Unreadable selection: keep the rest of the information panel usable. */ }
  return "未完成・設定を確認してください";
}
export function battlerSummary(battler) {
  if (!battler) return "B / D：読み込み待ち";
  const bText = skillText(battler.bSelection, () => presentSkillSummary("B", battler));
  return `B：${bText}\nD：${battler.dSelection ? (presentSkillSummary("D", battler).text ?? "未設定・不明な選択") : "未設定"}`;
}
export function duckSummary(duck) {
  if (!duck) return "中央の自分側アヒル枠からアヒルを選択してください。";
  const aText = skillText(duck.aSelection, () => presentSkillSummary("A", duck));
  const cText = skillText(duck.cSelection, () => presentSkillSummary("C", duck));
  return `AT ${duck.stats.AT} / DF ${duck.stats.DF} / SP ${duck.stats.SP}   HP ${calcMaxHPFromStats(duck.stats)}\nダイス：${duck.dice.join(" / ")}\nA：${aText}\nC：${cText}`;
}
