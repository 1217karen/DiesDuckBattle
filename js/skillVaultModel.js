import { presentASelection } from "./aSkillPresentation.js";
import { presentSkillSummary } from "./skillSummaryPresentation.js";
import { compileDSkill } from "./dSkillCompiler.js";
import { validSkillLabel } from "./skillLabels.js";
import { mapSelectionEffects, migrateSelection } from "./selectionNormalization.js";
import { createASkillCatalog } from "./aSkillCatalog.js";
import { createBSkillCatalog } from "./bSkillCatalog.js";
import { createCSkillCatalog } from "./cSkillCatalog.js";

export const SKILL_VAULT_TYPES = ["A", "B", "C", "D"];
export const skillSelectionKey = type => `${type.toLowerCase()}Selection`;
export function presentVaultSkill(type, selection) {
  try {
    if (!SKILL_VAULT_TYPES.includes(type)) return { complete: false, text: null };
    if (type === "A") return presentASelection(selection);
    if (type === "D" && !compileDSkill(selection).ok) return { complete: false, text: null };
    return presentSkillSummary(type, { [skillSelectionKey(type)]: selection });
  } catch { return { complete: false, text: null }; }
}
export function captureVaultSkill(type, owner) {
  const label = owner?.skillLabels?.[type];
  const selection = owner?.[skillSelectionKey(type)];
  if (!validSkillLabel(label) || !presentVaultSkill(type, selection).complete) return null;
  return structuredClone({ type, selection, name: label.name, ruby: label.ruby });
}
export function vaultSkillPatch(type, entry, owner) {
  if (entry.type !== type || !captureVaultSkill(type, {
    [skillSelectionKey(type)]: entry.selection, skillLabels: { [type]: { name: entry.name, ruby: entry.ruby } },
  })) throw new TypeError("現在のルールでは読み込めない構成です。保管データは変更されません。");
  let selection = structuredClone(entry.selection);
  // Compatibility for known legacy leaves only, through the existing lossless
  // migration. Unknown/retired selections have already failed presentation above.
  if (type !== "D") {
    const catalog = { A: createASkillCatalog, B: createBSkillCatalog, C: createCSkillCatalog }[type]();
    selection = mapSelectionEffects(type, selection, leaf => {
      if (Object.hasOwn(leaf, "targetId")) return leaf;
      if (type === "B") return migrateSelection(type, leaf, catalog);
      const wrapped = type === "A" ? { triggerId: selection.triggerId, effects: [leaf] }
        : { mode: selection.mode, structure: { kind: "flat", effects: [leaf] } };
      const normalized = migrateSelection(type, wrapped, catalog);
      return type === "A" ? normalized.effects[0] : normalized.structure.effects[0];
    });
  }
  return { [skillSelectionKey(type)]: selection,
    skillLabels: { ...owner.skillLabels, [type]: { name: entry.name, ruby: entry.ruby } } };
}
