import { statusLabel } from "./statusMetadata.js";

// Wording only. Availability, polarity and amounts always come from trusted rows.
export function aTriggerText(id) {
  if (id === "all") return "全ての出目で";
  const match = /^(exact|lte|gte):(\d+)$/.exec(id ?? "");
  return match ? `出目${match[2]}${{ exact: "の時", lte: "以下の時", gte: "以上の時" }[match[1]]}` : id;
}
export function aClauseText(row) {
  const id = row.effectId, d = row.definition;
  if (d.exactFace != null) return {
    1: "出目1のAP+1を無効化する", 2: "出目2の通常攻撃2回を1回にする",
    3: "出目3のHP回復を無効化する", 4: "出目4の反撃+1を無効化する",
    5: "出目5の相手AP-1を無効化する", 6: "出目6の反動を無効化する",
  }[d.exactFace];
  return ({ damage: "に固定ダメージを", heal: "のHPを", "change-ap": "のAPを",
    "grant-status": "に", "remove-random-status": "の", "change-next-at": "の次の通常攻撃ATを",
    "change-at": "の現在phaseのATを", "change-df": "の現在phaseのDFを",
    "change-attacks": "の現在phaseの通常攻撃回数を", "add-recoil": "に追加反動を" })[id] ?? row.label;
}
export function aEnding(row) {
  if (row.definition.exactFace != null) return "";
  return ({ damage: "与える", heal: "回復する", "grant-status": "stack付与する",
    "remove-random-status": "stack解除する", "change-attacks": "増加する", "add-recoil": "付与する" })[row.effectId]
    ?? (row.fixedOptions.direction === "decrease" ? "減少する" : "増加する");
}
export function aStatusText(id) { return ({ "@buff": "ランダムな状態強化", "@debuff": "ランダムな状態異常" })[id] ?? statusLabel(id); }
export function aDrawbackText(row) { return row?.definition.polarity === "drawback" ? "（デメリット）" : ""; }
export function aContentText(row) {
  if (row.definition.exactFace != null) return aClauseText(row);
  return ({ damage: "固定ダメージ", heal: "HP", "change-ap": "AP", "grant-status": "状態（付与）",
    "remove-random-status": "状態（ランダム解除）", "change-next-at": "次の通常攻撃AT",
    "change-at": "現在phaseのAT", "change-df": "現在phaseのDF", "change-attacks": "現在phaseの通常攻撃回数",
    "add-recoil": "追加反動" })[row.effectId] ?? row.label;
}
export function aTargetParticle(row) {
  if (!row || row.definition.exactFace != null) return "：";
  return ["damage", "grant-status", "add-recoil"].includes(row.effectId) ? "に" : "の";
}

// Format resource results only. Never derive prices from effect IDs or quantities.
export function aPointText(value, signed = false) {
  return value == null ? "未確定" : `${signed && value > 0 ? "+" : ""}${value}pt`;
}
const pointIssues = resources => [...resources.errors, ...resources.unresolved];
const hasEffectIssue = (resources, index) => pointIssues(resources).some(issue =>
  issue.path === `effects.${index}` || issue.path?.startsWith(`effects.${index}.`));
export function aEffectPointText(resources, index) {
  const row = resources.effectBreakdown.find(row => row.index === index);
  // Normalization may resolve an unfinished leaf to a provisional trusted variant.
  // Its price is not a confirmed quote while that leaf has validation issues.
  if (!row || hasEffectIssue(resources, index)) return aPointText(null);
  return row.polarity === "drawback" ? aPointText(row.drawbackPoints, true) : aPointText(row.effectCost);
}
export function aCancelPointText(resources) {
  return aPointText(resources.frequencyRank == null ? null : resources.cancelDrawbackPoints, true);
}
export function aPointSections(resources, slots, cancelled) {
  const invalidDice = resources.errors.some(issue => issue.code === "INVALID_DICE_RESOURCES");
  const unsettledEffects = pointIssues(resources).some(issue => issue.path === "effects" || issue.path?.startsWith("effects."));
  const row = (id, label, value, signed = false) => ({ id, label, text: aPointText(value, signed) });
  return [
    { label: "ポイント源", rows: [
      row("base", "基本pt", resources.basePoints),
      row("dice", "ダイスpt", invalidDice ? null : resources.dicePoints, true),
      row("available", "使用可能", invalidDice ? null : resources.availablePoints),
    ] },
    { label: "使用・還元内訳", rows: [
      row("trigger", "発動条件", resources.triggerCost),
      ...slots.map(({ index }, slot) => ({ id: `effect-${slot + 1}`, label: `効果${slot + 1}`, text: aEffectPointText(resources, index) })),
      ...(cancelled ? [{ id: "cancel", label: "通常攻撃キャンセル", text: aCancelPointText(resources) }] : []),
      row("benefit-slots", "追加メリット枠", unsettledEffects ? null : resources.benefitSlotCost),
    ] },
    { label: "合計", rows: [
      row("gross", "消費", resources.grossCost),
      row("drawback", "還元", unsettledEffects ? null : resources.drawbackPoints),
      row("net", "差引消費", resources.netCost),
      row("remaining", "残り", resources.remaining),
    ] },
  ];
}
