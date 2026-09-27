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
