import { createCSkillCatalog } from "./cSkillCatalog.js";
import { calculateCSkillResources } from "./cSkillResources.js";
import { C_HP_FAILURE_MULTIPLIER } from "./cSkillRules.js";
import { resolveSelection } from "./selectionNormalization.js";
import { effectSelectionFields } from "./effectSelectionCatalog.js";
import { statusLabel } from "./statusMetadata.js";

const field = key => ({ key });
const target = field("targetId"), amount = field("options.amount"), status = field("statusId");
const duration = field("options.duration"), direction = field("options.direction");
export const C_MODE_OPTIONS = [{ id: "normal", label: "通常発動" }, { id: "special", label: "特殊発動" }];
export const C_STRUCTURE_OPTIONS = [
  { id: "flat", label: "効果分岐なし" }, { id: "hpCondition", label: "HP条件分岐" },
  { id: "random2", label: "ランダム2分岐" }, { id: "random3", label: "ランダム3分岐" },
];
export function cFieldOptionText(key, option) {
  if (key === "statusId") return { "@buff": "ランダムな状態強化", "@debuff": "ランダムな状態異常",
    "random-buff": "ランダムな状態強化", "random-debuff": "ランダムな状態異常" }[option.id] ?? statusLabel(option.id);
  if (key === "options.direction") return { increase: "増加する", decrease: "減少する" }[option.id] ?? option.label;
  if (key === "chanceOptionId") return `${option.value * 100}％`;
  if (["options.amountPct", "options.maxHpPct"].includes(key)) return String(option.value * 100);
  return option.value != null ? String(option.value) : option.label;
}

/** Shared prose and field tokens for plain text and the editor. Only trusted
 * selected options supply the displayed failure guarantee, never parsed IDs. */
export function cEffectParts(effectId, variants = [], chosen = {}, { catalog = createCSkillCatalog(), editing = false } = {}) {
  let parts = ({
    damage: [target, "に固定", amount, "ダメージを与える"],
    heal: [target, "のHPを", amount, "回復する"],
    "hp-damage": [target, "に相手の現在HPの", field("options.amountPct"), "％の固定ダメージを与える"],
    "status-damage": [target, "に付与されている状態異常の合計付与数×", field("options.multiplier"), "の固定ダメージを与える"],
    "turn-damage": [target, "に固定", field("options.baseAmount"), "ダメージを与える（", field("options.everyTurns"), "ターンごとに与えるダメージが", field("options.stepAmount"), "増加する）"],
    "grant-status": [target, "に", status, "を", amount, "付与する"],
    "remove-random-status": [target, "の", status, "を3解除する"],
    "grant-on-hit": [duration, "ターンの間、通常攻撃時に", target, "に", status, "を", amount, "付与するオーラを纏う"],
    "change-at": [duration, "ターンの間、", target, "のATを", amount, direction],
    "change-df": [duration, "ターンの間、", target, "のDFを", amount, direction],
    revive: [target, "の最大HPの", field("options.maxHpPct"), "％で復活する（2回目以降は確率発動）"],
  })[effectId] ?? [];
  const chanceEnabled = variants.length && variants.every(row => row.chanceEnabled);
  const chance = catalog.chanceOptions.find(o => o.id === (chosen.chanceOptionId ?? "100"));
  if (effectId === "damage" && chanceEnabled && (editing || chance?.value < 1)) {
    parts = [target, "に成功率", field("chanceOptionId"), "の固定", amount, "ダメージを与える"];
    const amounts = variants.flatMap(row => row.optionAxes.amount ?? []).filter(o => o.id === chosen.options?.amount);
    if (chance?.value < 1 && amounts.length && amounts.every(o => o.value === amounts[0].value))
      parts.push(`（失敗した場合は固定${Math.floor(amounts[0].value * C_HP_FAILURE_MULTIPLIER)}ダメージを与える）`);
  }
  if (parts.length && variants.length && variants.every(row => row.definition.polarity === "drawback")) parts = [...parts, "（デメリット）"];
  return parts;
}

/** DOM-independent presentation. Pricing and validity are owned by the resource
 * calculator. Incomplete/obsolete input is retained and produces text:null. */
export function presentCSkill(selection, { catalog = createCSkillCatalog(), includeCost = true, ...options } = {}) {
  if (selection == null) return { complete: false, text: null, requiredAP: null, branches: [], issues: [] };
  const resources = calculateCSkillResources(selection, { ...options, catalog });
  const issues = [...resources.errors, ...resources.unresolved];
  if (!resources.complete) return { complete: false, text: null, requiredAP: resources.requiredAP, branches: [], issues };
  const resolved = resolveSelection("C", selection, catalog).selection;
  const rows = catalog.selectionEffects.flatMap(d => d.variants);
  const leafText = leaf => {
    const row = rows.find(r => r.legacyId === leaf.effectId && (!r.definition.optionAxes.status || r.statusId === leaf.options.status));
    if (!row) return null;
    const chosen = { effectId: row.effectId, targetId: row.targetId, statusId: row.statusId,
      options: { ...leaf.options, ...row.fixedOptions }, chanceOptionId: leaf.chanceOptionId };
    const view = effectSelectionFields(catalog.selectionEffects, chosen);
    const fields = [...view.fields, { key: "chanceOptionId", options: catalog.chanceOptions }];
    const parts = cEffectParts(row.effectId, [row], chosen, { catalog });
    const values = parts.map(part => {
      if (typeof part === "string") return part;
      const id = part.key.startsWith("options.") ? chosen.options[part.key.slice(8)] : chosen[part.key] ?? (part.key === "chanceOptionId" ? "100" : undefined);
      const option = fields.find(f => f.key === part.key)?.options.find(o => o.id === id);
      return option ? cFieldOptionText(part.key, option) : null;
    });
    return parts.length && values.every(v => v != null) ? values.join("") : null;
  };
  const s = resolved.structure;
  const source = s.kind === "flat" ? [s] : s.kind === "random" ? s.branches : [s.branches.met, s.branches.unmet];
  const branches = source.map(b => b.effects.map(leafText));
  if (branches.some(b => b.some(text => text == null))) return { complete: false, text: null, requiredAP: resources.requiredAP, branches, issues };
  const texts = branches.map(b => b.join("＋"));
  let body;
  if (s.kind === "flat") body = (selection.mode === "special" ? "敗北時に発動する。" : "") + texts[0];
  else if (s.kind === "random") body = (texts.length === 2 ? "どちらかの効果が発動する。" : "いずれかの効果が発動する。") + texts.map((text, i) => ["①", "②", "③"][i] + text).join("");
  else {
    const threshold = catalog.optionSets.hpThreshold.find(o => o.id === s.thresholdOptionId).value * 100;
    body = `①自分のHPが${threshold}％以上の時、${texts[0]}②自分のHPが${threshold}％未満の時、${texts[1]}`;
  }
  return { complete: true, text: (includeCost ? `〈AP${resources.requiredAP}〉` : "") + body, requiredAP: resources.requiredAP, branches, issues };
}
