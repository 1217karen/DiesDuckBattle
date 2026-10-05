import { statusLabel } from "./statusMetadata.js";
import { createASkillCatalog } from "./aSkillCatalog.js";
import { resolveSelection } from "./selectionNormalization.js";
import { calculateASkillResources } from "./aSkillResources.js";

// Wording only. Availability, polarity and amounts always come from trusted rows.
export function aTriggerText(id) {
  if (id === "all") return "全ての出目で、";
  const match = /^(exact|lte|gte):(\d+)$/.exec(id ?? "");
  return match ? `出目【${match[2]}${{ exact: "", lte: "以下", gte: "以上" }[match[1]]}】が出た時、` : null;
}
export function aStatusText(id) { return ({ "@buff": "ランダムな状態強化", "@debuff": "ランダムな状態異常" })[id] ?? statusLabel(id); }
export function aDrawbackText(row) { return row?.definition?.polarity === "drawback" ? "（デメリット）" : ""; }
const field = key => ({ key });
const target = field("targetId"), amount = field("options.amount"), status = field("statusId"), direction = field("options.direction");
const diceText = face => ({
  1: "ダイス効果のAP増加をキャンセルする", 2: "ダイス効果の通常攻撃回数増加をキャンセルする",
  3: "ダイス効果のHP回復をキャンセルする", 4: "ダイス効果の反撃付与をキャンセルする",
  5: "ダイス効果のAP減少をキャンセルする", 6: "ダイス効果の反動をキャンセルする",
})[face];

/** Shared sentence tokens: strings are prose, {key} names a trusted selection field.
 * UI candidates may be incomplete; no target, amount or polarity is guessed. */
export function aEffectParts(effectId, variants = []) {
  const faces = [...new Set(variants.map(row => row.definition.exactFace))];
  const special = faces.length === 1 && diceText(faces[0]);
  const parts = special ? [special] : ({
    damage: [target, "に固定", amount, "ダメージを与える"],
    heal: [target, "のHPを", amount, "回復する"],
    "change-ap": [target, "のAPを", amount, direction],
    "change-next-at": [target, "が次に与える通常攻撃のATを", amount, direction],
    "grant-status": [target, "に", status, "を", amount, "付与する"],
    "remove-random-status": [target, "の", status, "を", amount, "解除する"],
    "change-at": [target, "のATを現在フェイズ中だけ", amount, direction],
    "change-df": [target, "のDFを現在フェイズ中だけ", amount, direction],
    "change-attacks": [target, "の通常攻撃回数を現在フェイズ中だけ", amount, "増加する"],
    "add-recoil": [target, "の通常攻撃に現在フェイズ中だけ反動を", amount, "付与する"],
    "cancel-attack": ["通常攻撃をキャンセルする"],
  })[effectId] ?? [];
  const drawback = variants.length && variants.every(row => row.definition.polarity === "drawback") ? aDrawbackText(variants[0]) : "";
  return [...parts, ...(parts.length && drawback ? [drawback] : [])];
}

export function aFieldOptionText(key, option) {
  if (key === "statusId") return aStatusText(option.id);
  if (key === "options.direction") return { increase: "増加する", decrease: "減少する" }[option.id] ?? option.label;
  return option.label;
}

/** Project existing legal trigger rows into two controls, never a cartesian product. */
export function aTriggerEditor(legal, current) {
  const selected = legal.find(option => option.id === current);
  const saved = /^(exact|gte|lte):(\d+)$/.exec(current ?? "");
  const face = selected?.value ?? (saved ? Number(saved[2]) : null);
  const options = Array.from({ length: 7 }, (_, value) => {
    const option = legal.find(o => o.kind === selected?.kind && o.value === value)
      ?? legal.find(o => o.kind === "exact" && o.value === value);
    return option ? { ...option, label: String(value) }
      : { id: `exact:${value}`, label: `${value}（現在は使用不可）`, disabled: true };
  });
  options.push({ id: "all", label: "全ての出目", disabled: !legal.some(o => o.id === "all") });
  // The saved ID is never replaced by a currently legal alternative.
  if (current && !selected) {
    const index = options.findIndex(o => o.id === current);
    const stale = { id: current, label: `現在は使用不可：${aTriggerText(current) ?? current}（再選択してください）`, disabled: true };
    if (index >= 0) options[index] = stale; else options.push(stale);
  }
  const comparison = face >= 1 && face <= 6;
  return {
    parts: ["出目が", field("triggerId"), ...(comparison ? [field("comparison")] : []), "の時"],
    fields: [
      { key: "triggerId", label: "出目", value: current, options },
      ...(comparison ? [{ key: "comparison", label: "出目の比較", value: current,
        options: [["exact", "丁度"], ["gte", "以上"], ["lte", "以下"]].map(([kind, label]) => ({
          id: `${kind}:${face}`, label, disabled: !legal.some(o => o.id === `${kind}:${face}`),
        })) }] : []),
    ],
  };
}

/** Reusable, plain-text presentation. Validation is delegated to the existing
 * validator; this layer neither compiles effects nor interprets price/semantics.
 * text is null for unfinished/invalid data. Over-budget but fully specified
 * selections can still be described; callers retain their own save validation. */
export function presentASkill(build, selection, { catalog = createASkillCatalog() } = {}) {
  if (selection == null) return { complete: false, text: null, triggerText: null, effects: [], issues: [] };
  const validation = calculateASkillResources(build, selection, { catalog });
  const issues = [...validation.errors, ...validation.unresolved];
  if (issues.length) return { complete: false, text: null, triggerText: null, effects: [], issues };
  return describeASelection(selection, catalog, issues);
}

/** Describe saved content without dice, frequency or resource validation. */
export function presentASelection(selection, { catalog = createASkillCatalog() } = {}) {
  const invalid = { complete: false, text: null };
  if (!selection || !/^(all|exact:[0-6]|(?:gte|lte):[1-6])$/.test(selection.triggerId)) return invalid;
  try {
    if (Object.keys(selection).some(k => !["triggerId", "effects"].includes(k))) return invalid;
    const resolved = resolveSelection("A", selection, catalog);
    if (resolved.errors.length || resolved.incomplete.length) return invalid;
    const effects = resolved.selection.effects;
    if (!Array.isArray(effects) || !effects.length) return invalid;
    const counts = new Map();
    for (const leaf of effects) {
      if (!leaf || Object.keys(leaf).some(k => !["effectId", "amountOptionId", "chanceOptionId"].includes(k))) return invalid;
      const d = catalog.effects.find(d => d.id === leaf.effectId);
      if (!d || (leaf.chanceOptionId !== undefined && leaf.chanceOptionId !== "100")) return invalid;
      if (d.exactFace != null && selection.triggerId !== `exact:${d.exactFace}`) return invalid;
      if (d.requiresAmount ? !d.amountOptions.some(o => o.id === leaf.amountOptionId) : Object.hasOwn(leaf, "amountOptionId")) return invalid;
      counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
      if (!d.allowDuplicate && counts.get(d.id) > 1) return invalid;
    }
    const normalCount = effects.filter(e => e.effectId !== "cancel-self-attack").length;
    if (normalCount < 1 || normalCount > catalog.maxEffects) return invalid;
    const definitions = effects.map(e => catalog.effects.find(d => d.id === e.effectId));
    if (definitions.some(d => d.cancelsNormalAttack) && definitions.some(d => d.conflictsWithAttackCancel)) return invalid;
    return describeASelection(selection, catalog, []);
  } catch { return invalid; }
}

function describeASelection(selection, catalog, issues) {
  const resolved = resolveSelection("A", selection, catalog).selection;
  const rows = catalog.selectionEffects.flatMap(definition => definition.variants);
  const effects = resolved.effects.map((leaf, index) => {
    const row = rows.find(candidate => candidate.legacyId === leaf.effectId);
    const values = {
      targetId: catalog.targets.find(option => option.id === row.targetId)?.label,
      statusId: aStatusText(row.statusId),
      "options.direction": aFieldOptionText("options.direction", { id: row.fixedOptions.direction }),
      "options.amount": row.definition.amountOptions.find(option => option.id === leaf.amountOptionId)?.label,
    };
    const parts = aEffectParts(row.effectId, [row]);
    const text = parts.every(part => typeof part === "string" || values[part.key] != null)
      ? parts.map(part => typeof part === "string" ? part : values[part.key]).join("") : null;
    return { index, text, cancelsNormalAttack: Boolean(row.definition.cancelsNormalAttack) };
  });
  const ordered = [...effects.filter(effect => effect.cancelsNormalAttack), ...effects.filter(effect => !effect.cancelsNormalAttack)];
  const triggerText = aTriggerText(selection.triggerId);
  const complete = Boolean(triggerText) && effects.every(effect => effect.text);
  return { complete, text: complete ? triggerText + ordered.map(effect => effect.text).join("＋") : null, triggerText, effects, issues };
}

export function aContentText(row) {
  if (row.definition.exactFace != null) return diceText(row.definition.exactFace);
  return ({ damage: "固定ダメージ", heal: "HP", "change-ap": "AP", "grant-status": "状態（付与）",
    "remove-random-status": "状態（ランダム解除）", "change-next-at": "次の通常攻撃AT",
    "change-at": "現在フェイズのAT", "change-df": "現在フェイズのDF", "change-attacks": "現在フェイズの通常攻撃回数",
    "add-recoil": "追加反動" })[row.effectId] ?? row.label;
}

// Format resource results only. Never derive prices from effect IDs or quantities.
export function aPointText(value, signed = false) {
  return value == null ? "未確定" : `${signed && value > 0 ? "+" : ""}${value}`;
}
const pointIssues = resources => [...resources.errors, ...resources.unresolved];
const hasEffectIssue = (resources, index) => pointIssues(resources).some(issue =>
  issue.path === `effects.${index}` || issue.path?.startsWith(`effects.${index}.`));
export function aEffectPointText(resources, index) {
  const row = resources.effectBreakdown.find(row => row.index === index);
  // Normalization may resolve an unfinished leaf to a provisional trusted variant.
  // Its price is not a confirmed quote while that leaf has validation issues.
  if (!row || hasEffectIssue(resources, index)) return aPointText(null);
  return row.polarity === "drawback" ? `コスト還元：${aPointText(row.drawbackPoints)}` : `必要コスト：${aPointText(row.effectCost)}`;
}
export function aCancelPointText(resources) {
  return `コスト還元：${aPointText(resources.frequencyRank == null ? null : resources.cancelDrawbackPoints)}`;
}
export function aPointSections(resources, slots, cancelled) {
  const invalidDice = resources.errors.some(issue => issue.code === "INVALID_DICE_RESOURCES");
  const unsettledEffects = pointIssues(resources).some(issue => issue.path === "effects" || issue.path?.startsWith("effects."));
  const row = (id, label, value, signed = false) => ({ id, label, text: aPointText(value, signed) });
  return [
    { label: "コスト源", rows: [
      row("base", "基本コスト", resources.basePoints),
      row("dice", "ダイス由来コスト", invalidDice ? null : resources.dicePoints, true),
      row("available", "使用可能コスト", invalidDice ? null : resources.availablePoints),
    ] },
    { label: "使用・還元内訳", rows: [
      row("trigger", "発動条件の必要コスト", resources.triggerCost),
      ...slots.map(({ index }, slot) => ({ id: `effect-${slot + 1}`, label: `効果${slot + 1}`, text: aEffectPointText(resources, index) })),
      ...(cancelled ? [{ id: "cancel", label: "通常攻撃キャンセル", text: aCancelPointText(resources) }] : []),
      row("benefit-slots", "追加メリット枠コスト", unsettledEffects ? null : resources.benefitSlotCost),
    ] },
    { label: "合計", rows: [
      row("gross", "必要コスト（還元前）", resources.grossCost),
      row("drawback", "コスト還元", unsettledEffects ? null : resources.drawbackPoints),
      row("net", "必要コスト", resources.netCost),
      row("remaining", "残り", resources.remaining),
    ] },
  ];
}
