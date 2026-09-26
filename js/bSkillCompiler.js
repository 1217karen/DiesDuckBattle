import { resolveSelection, withSelectionIssues } from "./selectionNormalization.js";
import { createBSkillCatalog } from "./bSkillCatalog.js";
import { STATUS_GROUPS } from "./statusGroups.js";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));

// catalog引数は運営側の信頼済みデータ専用。ユーザーDTOと一緒に受け取らない。
function legacyvalidateBSkillSelection(selection, { catalog = createBSkillCatalog() } = {}) {
  const errors = [], unresolved = [];
  const fail = code => errors.push({ code });
  let definition;
  if (selection?.type === "event") {
    if (!exactKeys(selection, ["type", "triggerId", "conditionId", "effectId", "options"])) fail("INVALID_SELECTION_FIELDS");
    if (![selection.triggerId, selection.conditionId, selection.effectId].every(id => typeof id === "string")) fail("INVALID_ID");
    definition = catalog.events.find(item => item.triggerId === selection.triggerId
      && item.conditionId === selection.conditionId && item.effectId === selection.effectId);
  } else if (selection?.type === "trait") {
    if (!exactKeys(selection, ["type", "traitId", "options"])) fail("INVALID_SELECTION_FIELDS");
    if (typeof selection.traitId !== "string") fail("INVALID_ID");
    definition = catalog.traits.find(item => item.id === selection.traitId);
  } else fail("INVALID_SELECTION_TYPE");
  if (!definition) fail("UNKNOWN_OR_ILLEGAL_OPTION");
  if (definition) {
    if (!exactKeys(selection.options, Object.keys(definition.optionAxes))) fail("INVALID_OPTION_FIELDS");
    else for (const [axis, set] of Object.entries(definition.optionAxes)) {
      const id = selection.options[axis];
      if (typeof id !== "string" || !catalog.optionSets[set]?.some(option => option.id === id)) fail("UNKNOWN_OPTION");
    }
    for (const [key, value] of Object.entries(definition.tuning)) {
      if (value == null) unresolved.push({ code: "UNRESOLVED_TUNING", optionId: definition.id, key });
    }
  }
  return { valid: errors.length === 0, complete: errors.length === 0 && unresolved.length === 0, errors, unresolved };
}

function legacycompileBSkill(selection, { catalog = createBSkillCatalog() } = {}) {
  const validation = legacyvalidateBSkillSelection(selection, { catalog });
  const result = { ...validation, ok: false, bSkills: null };
  if (!validation.complete) return result;
  const definition = selection.type === "trait" ? catalog.traits.find(d => d.id === selection.traitId)
    : catalog.events.find(d => d.triggerId === selection.triggerId && d.conditionId === selection.conditionId && d.effectId === selection.effectId);
  const require = (ok, name) => { if (!ok) throw new TypeError(`Invalid trusted B catalog (${definition.id}): ${name}`); };
  const resolve = value => {
    if (Array.isArray(value)) return value.map(resolve);
    if (!record(value)) return value;
    if (Object.hasOwn(value, "tuning")) {
      const number = definition.tuning[value.tuning], kind = value.kind;
      if (kind === "optionalCap" && number === false) return undefined; // 明示的に上限なし。nullは未解決。
      require(Number.isFinite(number), value.tuning);
      if (["positiveInt", "integer", "optionalCap"].includes(kind)) require(Number.isInteger(number), value.tuning);
      if (kind === "positiveInt") require(number >= 1, value.tuning);
      if (["nonnegative", "optionalCap", "probability"].includes(kind)) require(number >= 0, value.tuning);
      if (kind === "probability") require(number <= 1, value.tuning);
      return number;
    }
    if (Object.hasOwn(value, "statusOption")) {
      const group = value.statusOption;
      const option = catalog.optionSets[group]?.find(o => o.id === selection.options.statusId);
      require(STATUS_GROUPS[group]?.includes(option?.value) || (option?.id === "random" && option.value === `@${group}`), "status group");
      return option.value;
    }
    if (Object.hasOwn(value, "negate")) return -resolve(value.negate);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]).filter(([, item]) => item !== undefined));
  };
  const bSkills = definition.semantics.rules.map((rule, index) => ({ id: `B:${definition.id}:${index}`, ...resolve(rule) }));
  for (const rule of bSkills) {
    const modifier = rule.modifier;
    if (modifier?.kind === "scaled") require(modifier.min <= modifier.max, "scaled range");
    const range = rule.effect?.value?.randUniform;
    if (range) require(range[0] <= range[1], "random multiplier range");
  }
  return { ...result, ok: true, bSkills };
}

export function validateBSkillSelection(selection, options = {}) {
  const catalog = options.catalog ?? createBSkillCatalog();
  const resolved = resolveSelection("B", selection, catalog);
  const result = legacyvalidateBSkillSelection(resolved.selection, { ...options, catalog });
  const merged = withSelectionIssues(result, resolved);
  return merged;
}

export function compileBSkill(selection, options = {}) {
  const catalog = options.catalog ?? createBSkillCatalog();
  const resolved = resolveSelection("B", selection, catalog);
  const result = legacycompileBSkill(resolved.selection, { ...options, catalog });
  const merged = withSelectionIssues(result, resolved);
  if (resolved.errors.length || resolved.incomplete.length) {
    merged.bSkills = null;

  }
  return merged;
}
