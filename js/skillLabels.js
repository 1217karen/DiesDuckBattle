export const SKILL_NAME_MAX = 15;
export const SKILL_RUBY_MAX = 50;
export const emptySkillLabels = categories => Object.fromEntries(categories.map(key => [key, { name: "", ruby: "" }]));
export const validSkillLabel = label => label !== null && typeof label === "object" && !Array.isArray(label)
  && Object.keys(label).length === 2 && Object.hasOwn(label, "name") && Object.hasOwn(label, "ruby")
  && typeof label.name === "string" && [...label.name].length <= SKILL_NAME_MAX
  && typeof label.ruby === "string" && [...label.ruby].length <= SKILL_RUBY_MAX;
// Display metadata only. Preserve whitespace exactly; never parse markup.
export const skillLabelSnapshot = label => validSkillLabel(label)
  ? { skillName: label.name, skillRuby: label.ruby } : { skillName: "", skillRuby: "" };
