import { D_SKILL_OPTIONS } from "./dSkillCatalog.js";

export function compileDSkill(selection) {
  const errors = [];
  const fail = (code, message) => errors.push({ code, message });
  if (!selection || typeof selection !== "object" || Array.isArray(selection) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(selection))) {
    fail("INVALID_SELECTION", "selectionはobjectで指定してください。");
  } else {
    if (Reflect.ownKeys(selection).some(key => key !== "optionId"))
      fail("UNKNOWN_FIELD", "selectionに指定できるfieldはoptionIdだけです。");
    const descriptor = Object.getOwnPropertyDescriptor(selection, "optionId");
    if (!descriptor) fail("OPTION_REQUIRED", "optionIdが必要です。");
    else if (typeof descriptor.value !== "string") fail("INVALID_OPTION_ID", "optionIdはstringで指定してください。");
    else if (!D_SKILL_OPTIONS.some(option => option.id === descriptor.value))
      fail("UNKNOWN_OPTION_ID", "未知のoptionIdです。");
  }
  if (errors.length) return { ok: false, skill: null, errors };
  const option = D_SKILL_OPTIONS.find(option => option.id === selection.optionId);
  return { ok: true, errors, skill: {
    id: option.id,
    name: option.label,
    description: `戦闘開始時に1回だけ、${option.label}（1個）。`,
    effect: { ...option.semantics, values: [...option.semantics.values] },
  } };
}
