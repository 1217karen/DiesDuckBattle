import { createCSkillCatalog } from "./cSkillCatalog.js";
import { createCSkillRules } from "./cSkillRules.js";
import { calculateCSkillResources } from "./cSkillResources.js";
import { STATUS_GROUPS } from "./statusGroups.js";

// selectionはIDのみ。catalog/rulesは運営側から注入する信頼境界。
export function compileCSkill(selection, { catalog = createCSkillCatalog(), rules = createCSkillRules() } = {}) {
  const resources = calculateCSkillResources(selection, { catalog, rules });
  const result = { ok: false, skill: null, resources, errors: resources.errors, unresolved: resources.unresolved };
  if (!resources.complete) return result;
  const effect = selection.effects.map(chosen => {
    const definition = catalog.effects.find(item => item.id === chosen.effectId);
    const s = definition.semantics;
    const require = (valid, description) => { if (!valid) throw new TypeError(`Invalid C catalog semantics (${definition.id}): ${description}`); };
    require(s && typeof s === "object", "semantics");
    require(["self", "enemy"].includes(s.target), "target");
    const read = axis => {
      require(typeof axis === "string" && Object.hasOwn(definition.optionAxes, axis), "option axis");
      return catalog.optionSets[definition.optionAxes[axis]].find(o => o.id === chosen.options[axis]).value;
    };
    const number = (axis, { integer = true, min = 0, max = Infinity } = {}) => {
      const value = read(axis);
      require(Number.isFinite(value) && (!integer || Number.isInteger(value)) && value >= min && value <= max, axis);
      return value;
    };
    const status = () => {
      const value = read(s.statusAxis);
      require(["debuff", "buff"].includes(s.group) && STATUS_GROUPS[s.group].includes(value), "status/group");
      return value;
    };
    const duration = () => ({ kind: "turns", count: number(s.durationAxis, { min: 1 }) });
    const base = { type: s.type, target: s.target };
    switch (s.type) {
      case "fixedDamage":
        return s.amountPctAxis ? { ...base, amountPct: number(s.amountPctAxis, { integer: false, max: 1 }) }
          : { ...base, amount: number(s.amountAxis) };
      case "heal": return { ...base, amount: number(s.amountAxis) };
      case "changeStatus":
        require(s.op === "add", "status op");
        return { ...base, status: status(), op: s.op, value: number(s.amountAxis) };
      case "clearStatus":
        if (s.scope === "single") return { ...base, status: status() };
        require(s.scope === "group" && ["debuff", "buff"].includes(s.group) && read("scope") === s.group, "clear group");
        return { ...base, group: s.group };
      case "addBuff":
        require(["AT", "DF"].includes(s.stat) && [-1, 1].includes(s.amountSign) && s.durationKind === "turns", "buff");
        return { ...base, stat: s.stat, amount: number(s.amountAxis) * s.amountSign, duration: duration() };
      case "addTimedHitRule":
        require(["self", "enemy"].includes(s.statusTarget), "statusTarget");
        return { ...base, duration: duration(), effect: {
          type: "changeStatus", target: s.statusTarget, status: status(), op: "add", value: number(s.amountAxis),
        } };
      case "revive":
        require(selection.mode === "special", "revive mode");
        return { ...base, maxHpPct: number(s.maxHpPctAxis, { integer: false, max: 1 }) };
      default: throw new TypeError(`Unsupported C semantics type: ${s.type}`);
    }
  });
  const skill = { mode: selection.mode, costAP: resources.requiredAP, effect };
  if (selection.mode === "special" && rules.repeatReviveChance != null) {
    if (!Number.isFinite(rules.repeatReviveChance) || rules.repeatReviveChance < 0 || rules.repeatReviveChance > 1)
      throw new TypeError("Invalid trusted repeatReviveChance");
    skill.repeatReviveChance = rules.repeatReviveChance;
  }
  return { ...result, ok: true, skill };
}
