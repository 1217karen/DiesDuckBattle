import { resolveSelection } from "./selectionNormalization.js";
import { createASkillCatalog } from "./aSkillCatalog.js";
import { createBSkillCatalog, getBSelectionDefinition } from "./bSkillCatalog.js";
import { createCSkillCatalog } from "./cSkillCatalog.js";
import { presentASkill } from "./aSkillPresentation.js";
import { presentCSkill } from "./cSkillPresentation.js";
import { bSentence } from "./bSkillPresentation.js";
import { validateBSkillSelection } from "./bSkillCompiler.js";
import { D_SKILL_OPTIONS } from "./dSkillCatalog.js";
const ac=createASkillCatalog(), bc=createBSkillCatalog(), cc=createCSkillCatalog();
// Shared CHARACTER/setting body. Callers control placement and empty-state text only.
export function presentSkillSummary(category, owner) {
  if(category === "A") return presentASkill(owner, owner.aSelection, {catalog:ac});
  if(category === "C") return presentCSkill(owner.cSelection, {catalog:cc});
  if(category === "D") {
    const text=D_SKILL_OPTIONS.find(option=>option.id===owner.dSelection?.optionId)?.label;
    return {complete:!!text,text:text??null};
  }
  const validation=validateBSkillSelection(owner.bSelection,{catalog:bc});
  if(!validation.complete) return validation;
  const b=resolveSelection("B",owner.bSelection,bc).selection;
  return {complete:true,text:bSentence(getBSelectionDefinition(b,bc),b.options?.statusId)};
}
