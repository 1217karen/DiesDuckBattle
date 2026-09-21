import { createCSkillCatalog, getCEffectAvailability } from "./cSkillCatalog.js";
import { createCSkillRules } from "./cSkillRules.js";

const record = v => v !== null && typeof v === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(v));
export function calculateCSkillResources(selection, { catalog = createCSkillCatalog(), rules = createCSkillRules() } = {}) {
  const errors = [], unresolved = [];
  const error = (code, path) => errors.push({ code, path });
  const pending = (code, path) => unresolved.push({ code, path });
  const keys = (object, allowed, path) => {
    for (const key of Reflect.ownKeys(object)) if (!allowed.includes(key)) error("UNKNOWN_FIELD", `${path}.${String(key)}`);
  };
  for (const key of ["baseAP", "minimumAP", "minEffects", "maxEffects", "additionalBenefitSlotAP"]) {
    if (!Number.isFinite(rules[key]) || rules[key] < 0) throw new TypeError(`Invalid C rules: ${key}`);
  }
  let benefitCount = 0, drawbackCount = 0, knownOptionDelta = 0;
  const mode = record(selection) && Object.hasOwn(selection, "mode") ? selection.mode : null;
  const list = record(selection) && Object.hasOwn(selection, "effects") && Array.isArray(selection.effects) ? selection.effects : null;
  if (!record(selection)) error("INVALID_SELECTION", "cSkill"); else keys(selection, ["mode", "effects"], "cSkill");
  if (!["normal", "special"].includes(mode)) error("INVALID_MODE", "mode");
  const effectCount = list?.length ?? 0;
  if (!list) error("INVALID_EFFECTS", "effects");
  if (effectCount < rules.minEffects || effectCount > rules.maxEffects) error("EFFECT_COUNT", "effects");
  for (const [i, chosen] of (list ?? []).entries()) {
    const path = `effects.${i}`;
    if (!record(chosen)) { error("INVALID_EFFECT", path); continue; }
    keys(chosen, ["effectId", "options"], path);
    const effect = Object.hasOwn(chosen, "effectId") && typeof chosen.effectId === "string"
      && catalog.effects.find(item => item.id === chosen.effectId);
    if (!effect) { error("UNKNOWN_EFFECT", `${path}.effectId`); continue; }
    const availability = getCEffectAvailability(effect.id, mode, catalog);
    if (!availability.selectable) error(availability.reason.code, path);
    if (!["benefit", "drawback"].includes(effect.polarity)) throw new TypeError("Invalid C polarity");
    if (effect.polarity === "benefit") benefitCount++; else drawbackCount++;
    const options = Object.hasOwn(chosen, "options") ? chosen.options : {};
    if (!record(options)) { error("INVALID_OPTIONS", `${path}.options`); continue; }
    keys(options, Object.keys(effect.optionAxes), `${path}.options`);
    for (const [axis, setId] of Object.entries(effect.optionAxes)) {
      const optionPath = `${path}.options.${axis}`;
      if (!Object.hasOwn(options, axis)) { pending("OPTION_UNSELECTED", optionPath); continue; }
      const set = catalog.optionSets[setId];
      if (!Array.isArray(set)) throw new TypeError(`Unknown C option set: ${setId}`);
      const option = typeof options[axis] === "string" && set.find(item => item.id === options[axis]);
      if (!option) { error("UNKNOWN_OPTION", optionPath); continue; }
      if (option.apDelta == null) { pending("PRICE_UNRESOLVED", optionPath); continue; }
      if (!Number.isFinite(option.apDelta) || option.apDelta < 0) throw new TypeError(`Invalid C option price: ${setId}`);
      knownOptionDelta += (effect.polarity === "benefit" ? 1 : -1) * option.apDelta;
      if (!Number.isFinite(knownOptionDelta)) throw new TypeError("C resource arithmetic overflow");
    }
  }
  const slotCost = Math.max(0, benefitCount - 1) * rules.additionalBenefitSlotAP;
  const complete = errors.length === 0 && unresolved.length === 0;
  const optionDelta = complete ? knownOptionDelta : null;
  const rawAP = complete ? rules.baseAP + slotCost + optionDelta : null;
  if (rawAP !== null && !Number.isFinite(rawAP)) throw new TypeError("C resource arithmetic overflow");
  return { mode, effectCount, benefitCount, drawbackCount, baseAP: rules.baseAP, slotCost, knownOptionDelta,
    optionDelta, rawAP, requiredAP: rawAP === null ? null : Math.max(rules.minimumAP, rawAP), complete, errors, unresolved };
}
