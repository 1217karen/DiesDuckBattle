import { resolveSelection, withSelectionIssues } from "./selectionNormalization.js";
import { createCSkillCatalog } from "./cSkillCatalog.js";
import { createCSkillRules, C_HP_FAILURE_MULTIPLIER } from "./cSkillRules.js";
import { calculateCSkillResources } from "./cSkillResources.js";
import { STATUS_GROUPS } from "./statusGroups.js";

// ユーザーが組む追加effectではなく、成功時のtrusted HP効果からだけ自動生成する。
function hpFailureEffect(main) {
  if (!["fixedDamage", "heal"].includes(main.type)) return null;
  return { ...main, amount: Math.floor(main.amount * C_HP_FAILURE_MULTIPLIER) };
}

// selectionはIDのみ。catalog/rulesは運営側から注入する信頼境界。
function legacycompileCSkill(selection, { catalog = createCSkillCatalog(), rules = createCSkillRules() } = {}) {
  const resources = calculateCSkillResources(selection, { catalog, rules });
  const result = { ok: false, skill: null, resources, errors: resources.errors, unresolved: resources.unresolved };
  if (!resources.complete) return result;
  const compileLeaf = chosen => {
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
      require(["debuff", "buff"].includes(s.group) && (STATUS_GROUPS[s.group].includes(value)
        || (s.type === "changeStatus" && value === `@${s.group}`)), "status/group");
      return value;
    };
    const duration = () => ({ kind: "turns", count: number(s.durationAxis, { min: 1 }) });
    const base = { type: s.type, target: s.target };
    const compileBase = () => { switch (s.type) {
      case "fixedDamage":
        if (s.statusMultiplierAxis) {
          require(s.target === "enemy", "status damage target");
          return { ...base, byStatusCount: { n: number(s.statusMultiplierAxis, { min: 1 }), statuses: [...STATUS_GROUPS.debuff] } };
        }
        if (s.everyTurnsAxis) return { ...base, amount: number(s.amountAxis),
          turnStep: { every: number(s.everyTurnsAxis, { min: 1 }), add: number(s.stepAmountAxis) } };
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
    } };
    const compiled = compileBase();
    const chance = definition.chanceEnabled === true && definition.polarity === "benefit"
      && catalog.chanceOptions.find(o => o.id === (chosen.chanceOptionId ?? "100"));
    if (chance && chance.value !== 1) {
      const failure = hpFailureEffect(compiled);
      compiled.chance = chance.value;
      if (failure) compiled.onFail = failure;
    }
    return compiled;
  };
  const structure = selection.structure;
  const branch = b => b.effects.map(compileLeaf);
  let effect;
  if (structure.kind === "flat") effect = branch(structure);
  else if (structure.kind === "random") effect = [{ type: "randomPick", picks: structure.branches.map(branch) }];
  else {
    const threshold = catalog.optionSets.hpThreshold.find(o => o.id === structure.thresholdOptionId).value;
    effect = [{ type: "conditional", when: { left: "self.hpPct", op: ">=", right: threshold },
      met: branch(structure.branches.met), unmet: branch(structure.branches.unmet) }];
  }
  const skill = { mode: selection.mode, costAP: resources.requiredAP, effect };
  if (selection.mode === "special" && rules.repeatReviveChance != null) {
    const repeat = rules.repeatReviveChance;
    const probability = value => Number.isFinite(value) && value >= 0 && value <= 1;
    if (typeof repeat === "number" ? !probability(repeat)
      : !repeat || Object.keys(repeat).some(key => !["2", "3", "default"].includes(key))
        || ![repeat[2], repeat[3], repeat.default].every(probability))
      throw new TypeError("Invalid trusted repeatReviveChance");
    skill.repeatReviveChance = typeof repeat === "number" ? repeat : { ...repeat };
  }
  return { ...result, ok: true, skill };
}

export function compileCSkill(selection, options = {}) {
  const catalog = options.catalog ?? createCSkillCatalog();
  const resolved = resolveSelection("C", selection, catalog);
  const result = legacycompileCSkill(resolved.selection, { ...options, catalog });
  const merged = withSelectionIssues(result, resolved);
  if (resolved.errors.length || resolved.incomplete.length) {
    merged.skill = null;
    merged.resources = withSelectionIssues(result.resources, resolved);
  }
  return merged;
}
