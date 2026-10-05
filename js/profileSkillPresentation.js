import { presentASelection } from "./aSkillPresentation.js";
import { createBSkillCatalog, getBSelectionDefinition } from "./bSkillCatalog.js";
import { validateBSkillSelection } from "./bSkillCompiler.js";
import { bSentence } from "./bSkillPresentation.js";
import { resolveSelection } from "./selectionNormalization.js";
import { presentCSkill } from "./cSkillPresentation.js";
import { D_SKILL_OPTIONS } from "./dSkillCatalog.js";

/** Plain text from trusted catalogs only. No build, dice or DOM is needed. */
export function presentProfileSkill(category, selection) {
  if (selection === null) return "未設定";
  try {
    let text;
    if (category === "A") text = presentASelection(selection).text;
    if (category === "B") {
      const catalog = createBSkillCatalog();
      const validation = validateBSkillSelection(selection, { catalog });
      if (validation.complete && !validation.errors.length && !validation.unresolved.length) {
        const resolved = resolveSelection("B", selection, catalog).selection;
        text = bSentence(getBSelectionDefinition(selection, catalog), resolved.options?.statusId);
      }
    }
    if (category === "C") text = presentCSkill(selection, { includeCost: false }).text;
    if (category === "D") text = D_SKILL_OPTIONS.find(o => o.id === selection?.optionId)?.label;
    return text || "設定未完了";
  } catch { return "設定未完了"; }
}
