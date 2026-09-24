import { resolveSelection, withSelectionIssues } from "./selectionNormalization.js";
import { createASkillCatalog, getATriggerOptions } from "./aSkillCatalog.js";
import { calculateASkillResources } from "./aSkillResources.js";

// buildの初期diceとselectionを検証。catalog/rulesはユーザーから受け取らない。
function legacycompileASkill(build, selection, { catalog = createASkillCatalog(), rules } = {}) {
  const resources = calculateASkillResources(build, selection, { catalog, rules });
  const errors = [...resources.errors];
  if (resources.complete && resources.remaining < 0) errors.push({ code: "INSUFFICIENT_A_POINTS", path: "aSkill", message: "Aポイント不足です。" });
  const result = { ok: false, skill: null, resources, errors, unresolved: resources.unresolved };
  if (!resources.ready) return result;
  const selectedTrigger = getATriggerOptions(build.diceFrame, catalog).find(item => item.id === selection.triggerId);
  const trigger = { kind: selectedTrigger.kind, ...(selectedTrigger.kind === "all" ? {} : { value: selectedTrigger.value }) };
  const effect = selection.effects.map(chosen => {
    const definition = catalog.effects.find(item => item.id === chosen.effectId);
    const s = definition.semantics;
    if (!s || !["self", "enemy"].includes(s.target)) throw new TypeError("Invalid trusted A semantics");
    const value = definition.requiresAmount
      ? definition.amountOptions.find(option => option.id === chosen.amountOptionId).value * (s.sign ?? 1) : s.value;
    const base = { type: s.type, target: s.target };
    let compiled;
    switch (s.type) {
      case "fixedDamage": case "heal": compiled = { ...base, amount: value }; break;
      case "changeStatus": compiled = { ...base, status: s.status, op: s.op, value }; break;
      case "changeValue": compiled = { ...base, key: s.key, op: s.op, value }; break;
      case "addBuff": compiled = { ...base, stat: s.stat, amount: value, duration: { kind: "phase" } }; break;
      default: throw new TypeError(`Unsupported trusted A semantics: ${s.type}`);
    }
    const chance = catalog.chanceOptions.find(option => option.id === (chosen.chanceOptionId ?? "100")).value;
    // 100%は常に省略。既存の不要なRNG消費も避ける。
    if (definition.polarity === "benefit" && chance !== 1) compiled.chance = chance;
    return compiled;
  });
  return { ...result, ok: true, skill: { trigger, effect } };
}

export function compileASkill(build, selection, options = {}) {
  const catalog = options.catalog ?? createASkillCatalog();
  const resolved = resolveSelection("A", selection, catalog);
  const result = legacycompileASkill(build, resolved.selection, { ...options, catalog });
  const merged = withSelectionIssues(result, resolved);
  if (resolved.errors.length || resolved.incomplete.length) {
    merged.skill = null;
    merged.resources = withSelectionIssues(result.resources, resolved);
  }
  return merged;
}
