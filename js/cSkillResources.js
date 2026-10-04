import { resolveSelection, withSelectionIssues } from "./selectionNormalization.js";
import { createCSkillCatalog, getCEffectAvailability } from "./cSkillCatalog.js";
import { createCSkillRules } from "./cSkillRules.js";

const record = v => v !== null && typeof v === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function legacycalculateCSkillResources(selection, { catalog = createCSkillCatalog(), rules = createCSkillRules() } = {}) {
  const errors = [], unresolved = [], effectBreakdown = [], branchBreakdown = [];
  const error = (code, path) => errors.push({ code, path });
  const pending = (code, path) => unresolved.push({ code, path });
  const keys = (object, allowed, path) => {
    for (const key of Reflect.ownKeys(object)) if (!allowed.includes(key)) error("UNKNOWN_FIELD", `${path}.${String(key)}`);
  };
  const price = (value, path, signed = false) => {
    if (value == null) { pending("PRICE_UNRESOLVED", path); return 0; } // 既知小計用のみ。最終APは必ずnull。
    if (!Number.isFinite(value) || (!signed && value < 0)) throw new TypeError(`Invalid C option price: ${path}`);
    return value;
  };
  const policy = (value, supported, code, path) => {
    if (value == null) pending(code, path);
    else if (value !== supported) throw new TypeError(`Unsupported C dev policy: ${path}`);
  };
  const option = (set, id, path) => {
    if (id === undefined) { pending("OPTION_UNSELECTED", path); return null; }
    const found = typeof id === "string" && set.find(o => o.id === id);
    if (!found) { error("UNKNOWN_OPTION", path); return null; }
    return found;
  };
  for (const key of ["baseAP", "minimumAP", "minEffects", "maxEffects", "additionalBenefitSlotAP", "maxDrawbackAP"]) {
    if (!Number.isFinite(rules[key]) || rules[key] < 0) throw new TypeError(`Invalid C rules: ${key}`);
  }
  let effectCount = 0, benefitCount = 0, drawbackCount = 0, knownOptionDelta = 0, knownStructureDelta = 0;
  const mode = record(selection) && Object.hasOwn(selection, "mode") ? selection.mode : null;
  if (!record(selection)) error("INVALID_SELECTION", "cSkill"); else keys(selection, ["mode", "structure"], "cSkill");
  if (!["normal", "special"].includes(mode)) error("INVALID_MODE", "mode");
  const leaf = (chosen, path) => {
    effectCount++;
    if (!record(chosen)) { error("INVALID_EFFECT", path); return; }
    keys(chosen, ["effectId", "options", "chanceOptionId"], path);
    const effect = Object.hasOwn(chosen, "effectId") && typeof chosen.effectId === "string"
      && catalog.effects.find(item => item.id === chosen.effectId);
    if (!effect) { error("UNKNOWN_EFFECT", `${path}.effectId`); return; }
    const availability = getCEffectAvailability(effect.id, mode, catalog);
    if (!availability.selectable) error(availability.reason.code, path);
    if (!["benefit", "drawback"].includes(effect.polarity)) throw new TypeError("Invalid C polarity");
    const benefit = effect.polarity === "benefit";
    if (benefit) benefitCount++; else drawbackCount++;
    let leafPrice = 0, priceComplete = true, apDiscount = 0;
    const options = Object.hasOwn(chosen, "options") ? chosen.options : {};
    if (!record(options)) { error("INVALID_OPTIONS", `${path}.options`); priceComplete = false; }
    else {
      keys(options, Object.keys(effect.optionAxes), `${path}.options`);
      for (const [axis, setId] of Object.entries(effect.optionAxes)) {
        const optionPath = `${path}.options.${axis}`, set = catalog.optionSets[setId];
        if (!Array.isArray(set)) throw new TypeError(`Unknown C option set: ${setId}`);
        const found = option(set, Object.hasOwn(options, axis) ? options[axis] : undefined, optionPath);
        if (found) leafPrice += price(found.apDelta, optionPath);
        if (!found || found.apDelta == null) priceComplete = false;
      }
    }
    const chanceEnabled = benefit && effect.chanceEnabled === true;
    if (!chanceEnabled && Object.hasOwn(chosen, "chanceOptionId"))
      error("CHANCE_NOT_ALLOWED", `${path}.chanceOptionId`);
    const chanceId = Object.hasOwn(chosen, "chanceOptionId") ? chosen.chanceOptionId : "100";
    const chance = chanceEnabled && typeof chanceId === "string" && catalog.chanceOptions.find(o => o.id === chanceId);
    if (chanceEnabled && !chance) error("UNKNOWN_CHANCE_OPTION", `${path}.chanceOptionId`);
    else if (chance) {
      if (!Number.isFinite(chance.value) || chance.value <= 0 || chance.value > 1 || (chance.id === "100" && chance.value !== 1))
        throw new TypeError("Invalid C chance definition");
      if (benefit) {
        // 非負の割引をleaf単位で扱う。共通priceへ負値を渡さない。
        apDiscount = chance.apDiscount;
        if (apDiscount == null) pending("CHANCE_DISCOUNT_UNRESOLVED", `${path}.chanceOptionId`);
        else if (!Number.isFinite(apDiscount) || apDiscount < 0 || (chance.value === 1 && apDiscount !== 0))
          throw new TypeError("Invalid C chance discount");
      }
    }
    // 他effect・基礎AP・枠・分岐料金へ割引を流さないため、そのleaf価格を上限とする。
    const appliedDiscount = benefit && priceComplete && chance && apDiscount != null ? Math.min(leafPrice, apDiscount) : 0;
    if (!Number.isFinite(leafPrice)) throw new TypeError("C resource arithmetic overflow");
    const leafDelta = (benefit ? leafPrice - appliedDiscount : -Math.min(leafPrice, rules.maxDrawbackAP));
    knownOptionDelta += leafDelta;
    const complete = priceComplete && (!chanceEnabled || !!chance) && apDiscount != null;
    effectBreakdown.push({ path, effectId: effect.id, optionPrice: priceComplete ? leafPrice : null,
      apDiscount, appliedDiscount: complete ? appliedDiscount : null, effectDelta: complete ? leafDelta : null });
  };
  const branch = (value, path) => {
    if (!record(value)) { error("INVALID_BRANCH", path); return; }
    const startErrors = errors.length, startUnresolved = unresolved.length;
    keys(value, ["effects"], path);
    if (!Array.isArray(value.effects)) { error("INVALID_EFFECTS", `${path}.effects`); return; }
    if (!value.effects.length) error("EMPTY_BRANCH", `${path}.effects`);
    const startBenefit = benefitCount, startDelta = knownOptionDelta;
    let branchSlotCost = 0;
    for (const [i, chosen] of value.effects.entries()) {
      const beforeBenefit = benefitCount, beforeRows = effectBreakdown.length;
      leaf(chosen, `${path}.effects.${i}`);
      const slotCost = benefitCount > beforeBenefit && beforeBenefit > startBenefit ? rules.additionalBenefitSlotAP : 0;
      branchSlotCost += slotCost;
      if (effectBreakdown.length > beforeRows) Object.assign(effectBreakdown.at(-1), { branchPath: path, slotCost });
    }
    const complete = value.effects.length > 0 && errors.length === startErrors && unresolved.length === startUnresolved;
    const optionDelta = knownOptionDelta - startDelta;
    branchBreakdown.push({ path, benefitCount: benefitCount - startBenefit, slotCost: branchSlotCost,
      knownOptionDelta: optionDelta, optionDelta: complete ? optionDelta : null,
      totalAP: complete ? optionDelta + branchSlotCost : null, complete });
  };
  const structure = record(selection) && Object.hasOwn(selection, "structure") ? selection.structure : null;
  if (!record(structure)) error("INVALID_STRUCTURE", "structure");
  else if (structure.kind === "flat") {
    keys(structure, ["kind", "effects"], "structure");
    branch({ effects: structure.effects }, "structure");
  } else if (["random", "hpCondition"].includes(structure.kind)) {
    keys(structure, structure.kind === "random" ? ["kind", "branches"] : ["kind", "thresholdOptionId", "branches"], "structure");
    if (mode === "special") error("SPECIAL_FLAT_ONLY", "structure.kind");
    policy(rules.branchAggregation, "max", "BRANCH_AGGREGATION_UNRESOLVED", "rules.branchAggregation");
    if (structure.kind === "random") {
      if (!Array.isArray(structure.branches) || ![2, 3].includes(structure.branches.length)) error("BRANCH_COUNT", "structure.branches");
      if (Array.isArray(structure.branches)) for (const [i, b] of structure.branches.entries()) branch(b, `structure.branches.${i}`);
    } else {
      const threshold = option(catalog.optionSets.hpThreshold, structure.thresholdOptionId, "structure.thresholdOptionId");
      if (threshold) {
        if (!Number.isFinite(threshold.value) || threshold.value <= 0 || threshold.value > 1) throw new TypeError("Invalid C HP threshold");
        // HP threshold selects a condition only; it never changes AP.
      }
      if (!record(structure.branches)) error("INVALID_BRANCHES", "structure.branches");
      else {
        keys(structure.branches, ["met", "unmet"], "structure.branches");
        for (const key of ["met", "unmet"]) branch(structure.branches[key], `structure.branches.${key}`);
      }
    }
  } else error("UNKNOWN_STRUCTURE", "structure.kind");
  if (effectCount < rules.minEffects || effectCount > rules.maxEffects) error("EFFECT_COUNT", "structure");
  if (!Number.isFinite(knownOptionDelta + knownStructureDelta)) throw new TypeError("C resource arithmetic overflow");
  const complete = errors.length === 0 && unresolved.length === 0;
  // Pick a whole branch, including its own slots. Ties retain the first branch.
  const selected = complete ? branchBreakdown.reduce((best, b) => !best || b.totalAP > best.totalAP ? b : best, null) : null;
  const branched = structure?.kind === "random" || structure?.kind === "hpCondition";
  const slotCost = branched ? selected?.slotCost ?? null : Math.max(0, benefitCount - 1) * rules.additionalBenefitSlotAP;
  const optionDelta = complete ? selected?.optionDelta ?? null : null;
  const effectAP = complete ? selected?.totalAP ?? null : null;
  const selectedBranchPath = selected?.path ?? null;
  const rawAP = effectAP === null ? null : rules.baseAP + effectAP;
  if (rawAP !== null && !Number.isFinite(rawAP)) throw new TypeError("C resource arithmetic overflow");
  return { mode, effectCount, benefitCount, drawbackCount, baseAP: rules.baseAP, slotCost, knownOptionDelta,
    knownStructureDelta, effectBreakdown, branchBreakdown, selectedBranchPath, effectAP, optionDelta, rawAP, requiredAP: rawAP === null ? null : Math.max(rules.minimumAP, rawAP), complete, errors, unresolved };
}

export function calculateCSkillResources(selection, options = {}) {
  const catalog = options.catalog ?? createCSkillCatalog();
  const resolved = resolveSelection("C", selection, catalog);
  const result = legacycalculateCSkillResources(resolved.selection, { ...options, catalog });
  const merged = withSelectionIssues(result, resolved);
  // Normalized incomplete/invalid clauses must not expose a provisional winner.
  if (!merged.complete) return { ...merged, optionDelta: null, effectAP: null, selectedBranchPath: null };
  return merged;
}
