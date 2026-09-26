import { resolveSelection } from "./selectionNormalization.js";
import { normalizedBCatalog } from "./effectSelectionCatalog.js";
import { statusLabel } from "./statusMetadata.js";
import { bEventPresentation, bTraitPresentation } from "./bSkillPresentation.js";
import { STATUS_GROUPS } from "./statusGroups.js";

// trusted production catalog / balance v1。数値はselectionから受け取らない。
export function createBSkillCatalog() {
  const triggers = [
    ["phase-start", "自分フェイズ開始時", "phaseStart"], ["before-attack", "通常攻撃前", "beforeAttack"],
    ["after-hit", "攻撃命中後", "afterDamage"], ["after-take-hit", "被通常攻撃命中後", "afterTakeDamage"],
    ["after-heal", "HP回復時", "afterHeal"], ["phase-end", "自分フェイズ終了時", "phaseEnd"],
  ].map(([id, label, engineTrigger]) => ({ id, label, engineTrigger }));
  const events = [], traits = [];
  const n = (key, kind = "positiveInt") => ({ tuning: key, kind });
  const cond = (left, op, right) => ({ left, op, right });
  const all = (...items) => ({ all: items.filter(Boolean) });
  const normal = all(cond("attack.kind", "==", "normalAttack"), cond("attack.isCounter", "==", false));
  const grant = (target, group, value = n("stacks"), random = false) => ({ type: "changeStatus", target,
    status: random ? `@${group}` : { statusOption: group }, op: "add", value });
  const change = (target, key, value) => ({ type: "changeValue", target, key, op: "add", value });
  const next = (target, down = false) => change(target, "nextAttackATPlus", down ? { negate: n("amount") } : n("amount"));
  const remove = (target, group) => ({ type: "removeRandomStatusStack", target, group, repeat: n("repeat") });
  const heal = (target, amount = n("amount"), extra = {}) => ({ type: "heal", target, amount, ...extra });
  function definition(identity, rules) {
    const tuning = {}, tuningKinds = {}, optionAxes = {};
    const scan = value => {
      if (!value || typeof value !== "object") return;
      if (value.tuning) { tuning[value.tuning] = null; tuningKinds[value.tuning] = value.kind; }
      if (value.statusOption) optionAxes.statusId = value.statusOption;
      Object.values(value).forEach(scan);
    };
    scan(rules);
    return { ...identity, optionAxes, tuning, tuningKinds,
      tuningLabels: Object.fromEntries(Object.keys(tuning).map(key => [key, B_TUNING_LABELS[key]])), semantics: { rules } };
  }
  const add = (triggerId, conditionId, effectId, when, effect) => events.push(definition({
    id: `${triggerId}/${conditionId}/${effectId}`, triggerId, conditionId, effectId,
  }, [{ trigger: triggers.find(t => t.id === triggerId).engineTrigger, when, effect }]));
  const trait = (id, rules) => traits.push(definition({ id }, rules));
  const random = (target, group) => grant(target, group, n("stacks"), true);
  for (const [id, effect] of [
    ["both-buff", [random("self", "buff"), random("enemy", "buff")]],
    ["both-debuff", [random("enemy", "debuff"), random("self", "debuff")]],
    ["self-buff-debuff", [random("self", "buff"), random("self", "debuff")]],
    ["chance-enemy-debuff", { ...random("enemy", "debuff"), chance: n("chance", "probability") }],
    ["chance-self-buff", { ...random("self", "buff"), chance: n("chance", "probability") }],
  ]) add("phase-start", "always", id, null, effect);
  for (const [target, group] of [["self", "buff"], ["enemy", "debuff"]]) {
    for (const chance of [false, true]) add("phase-start", "first-action", `${chance ? "chance-strong-" : ""}${target}-${group}`,
      cond("self.actionsThisTurn", "==", 1), { ...random(target, group), ...(chance ? { chance: n("chance", "probability") } : {}) });
  }
  for (const group of ["buff", "debuff"]) add("phase-start", "first-action", `both-${group}`,
    cond("self.actionsThisTurn", "==", 1), [random("self", group), random("enemy", group)]);
  for (const target of ["self", "enemy"]) add("before-attack", `${target}-has-debuff`, "attack-at-up",
    all(normal, cond(`${target}.statusTotal:debuff`, ">=", 1)), next("self"));
  add("before-attack", "self-debuff-total", "attack-at-by-debuff", all(normal,
    cond("self.statusTotal:debuff", ">=", n("threshold"))),
  change("self", "nextAttackATPlus", { read: "self.statusTotal:debuff" }));

  const damageCondition = id => id === "counter" ? cond("attack.isCounter", "==", true)
    : all(normal, id === "always" ? null : cond("attack.damage", ">=", n("threshold")));
  for (const condition of ["always", "damage-medium", "damage-high", "counter"]) {
    for (const [id, effect] of [["enemy-debuff", grant("enemy", "debuff")],
      ["enemy-buff-remove", remove("enemy", "buff")]])
      add("after-hit", condition, id, damageCondition(condition), effect);
    if (condition === "always") continue;
    add("after-hit", condition, "enemy-next-at-down", damageCondition(condition), next("enemy", true));
    add("after-hit", condition, "self-heal", damageCondition(condition), condition === "counter"
      ? heal("self") : { type: "heal", target: "self", byAttackDamagePct: .5, max: n("healCap") });
  }
  for (const condition of ["always", "damage-medium", "damage-high"]) {
    for (const [target, group] of [["self", "buff"], ["enemy", "debuff"]])
      add("after-take-hit", condition, `${target}-${group}`, damageCondition(condition), grant(target, group));
    add("after-take-hit", condition, "self-next-at-up", damageCondition(condition), next("self"));
    if (condition === "always") continue;
    add("after-take-hit", condition, "heal-by-ap", damageCondition(condition),
      heal("self", { read: "self.ap" }, { max: n("healCap", "optionalCap") }));
    add("after-take-hit", condition, "ap-cost-heal", all(damageCondition(condition),
      cond("self.ap", ">=", n("apCost"))), [change("self", "ap", { negate: n("apCost") }), heal("self")]);
  }

  for (const condition of ["always", "hp-medium", "hp-low"]) {
    const when = all(cond("heal.actual", ">", 0), condition === "always" ? null
      : cond("heal.hpPctAfter", "<=", n("hpThreshold", "probability")));
    for (const [id, effect] of [["target-buff", grant("healTarget", "buff")],
      ["target-debuff-remove", remove("healTarget", "debuff")], ["target-next-at-up", next("healTarget")],
      ["target-heal", heal("healTarget", n("amount"), { source: "afterHealBonus" })]])
      add("after-heal", condition, id, when, effect);
    if (condition !== "always") add("after-heal", condition, "target-ap-up", when, change("healTarget", "ap", n("amount")));
    if (condition !== "always") add("after-heal", condition, "emergency", when,
      [remove("healTarget", "debuff"), grant("healTarget", "buff")]);
  }
  for (const condition of ["always", "first-action"]) {
    const when = condition === "always" ? null : cond("self.actionsThisTurn", "==", 1);
    add("phase-end", condition, "heal-by-buff", when, { type: "heal", target: "self",
      byStatusCount: { statuses: [...STATUS_GROUPS.buff], n: n("perStack") } });
    add("phase-end", condition, "damage-by-debuff", when, { type: "fixedDamage", target: "enemy",
      byStatusCount: { source: "self", statuses: [...STATUS_GROUPS.debuff], n: n("perStack") } });
    for (const cost of [5, 8, 10]) add("phase-end", condition, `ap-up-cost-${cost}`, when,
      [{ type: "fixedDamage", target: "self", amountMaxHpPct: n("hpCostPct", "probability") },
        change("self", "ap", n("amount"))]);
  }

  for (const [level, op, threshold, total] of [["high", ">=", .75, 6], ["mid-high", ">=", .5, 4],
    ["mid-low", "<=", .5, 4], ["low", "<=", .25, 6]]) {
    const pairs = total === 6 ? [[6,0],[4,2],[3,3],[2,4],[0,6]] : [[4,0],[3,1],[2,2],[1,3],[0,4]];
    for (const [AT, DF] of pairs) {
      const suffix = DF === 0 ? "at" : AT === 0 ? "df" : AT === DF ? "at-df" : `at${AT}-df${DF}`;
      trait(`hp-${level}-${suffix}`, [{ trigger: "passive", modifier: { kind: "conditional",
        when: cond("self.hpPct", op, n("hpThreshold", "probability")),
        bonus: { ...(AT ? { AT: n("AT", "integer") } : {}), ...(DF ? { DF: n("DF", "integer") } : {}) } } }]);
      traits.at(-1).production = { hpThreshold: threshold, AT, DF };
    }
    if (total === 6) {
      trait(`hp-${level}-extra-attack`, [{ trigger: "beforeRoll", when: cond("self.hpPct", op, n("hpThreshold", "probability")),
        effect: change("self", "attackTimesAdd", 1) }]);
      traits.at(-1).production = { hpThreshold: threshold };
    }
  }
  for (const stat of ["AT", "DF"]) {
    trait(`ap-${stat.toLowerCase()}`, [{ trigger: "passive", modifier: {
      kind: "scaled", source: "self.ap", targetStat: stat, scale: n("scale", "nonnegative"), min: n("min", "integer"), max: n("max", "integer"),
    } }]);
    trait(`ap-inverse-${stat.toLowerCase()}`, [{ trigger: "passive", modifier: {
      kind: "scaled", source: "self.ap", targetStat: stat, scale: -1, offset: 5, min: 0, max: 5,
    } }]);
  }
  const multiplier = (trigger, value) => ({ trigger, when: normal, effect: { type: "changeAttack", op: "mulDamage", value } });
  trait("outgoing-random", [multiplier("beforeAttack", { randUniform: [n("low", "nonnegative"), n("high", "nonnegative")] })]);
  trait("incoming-random", [multiplier("beforeTakeDamage", { randUniform: [n("low", "nonnegative"), n("high", "nonnegative")] })]);
  for (const direction of ["up", "down"]) trait(`damage-both-${direction}`, [
    multiplier("beforeAttack", n("outgoing", "nonnegative")), multiplier("beforeTakeDamage", n("incoming", "nonnegative")),
  ]);
  for (const definition of [...events, ...traits]) {
    const values = definition.production ?? productionTuning(definition);
    delete definition.production;
    for (const key of Object.keys(definition.tuning)) {
      if (!Object.hasOwn(values, key)) throw new Error(`Missing production B tuning: ${definition.id}.${key}`);
      definition.tuning[key] = values[key];
    }
  }
  for (const item of events) Object.assign(item, bEventPresentation(item));
  for (const item of traits) Object.assign(item, bTraitPresentation(item));
  const catalog = { triggers, events, traits, optionSets: Object.fromEntries(["buff", "debuff"].map(group =>
    [group, [...STATUS_GROUPS[group].map(id => ({ id, value: id, label: statusLabel(id) })), { id: "random", value: `@${group}`, label: "ランダム" }]])) };
  catalog.selectionEffects = normalizedBCatalog(catalog);
  return catalog;
}

// event/AP/倍率のproduction tuning。HP配分と逆AP係数は上のtrusted定義で固定する。
// dev fixtureやユーザー入力は参照しない。
function productionTuning({ id, triggerId, conditionId: condition, effectId: effect }) {
  if (triggerId === "phase-start") return {
    stacks: condition === "first-action" && (effect.startsWith("chance-strong-") || effect.startsWith("both-")) ? 2 : 1, chance: .5,
  };
  if (triggerId === "before-attack") return { amount: 2, threshold: 4 };
  if (triggerId === "after-hit") {
    const [stacks, repeat, amount, threshold] = {
      always: [1, 1, 0], "damage-medium": [2, 2, 2, 7], "damage-high": [3, 3, 4, 10], counter: [2, 2, 3],
    }[condition];
    return { stacks, repeat, amount, threshold, healCap: condition === "damage-medium" ? 5 : 10 };
  }
  if (triggerId === "after-take-hit") return {
    threshold: condition === "damage-medium" ? 7 : 10,
    stacks: condition === "always" ? 1 : condition === "damage-medium" ? 2 : 3,
    amount: effect === "ap-cost-heal" ? (condition === "damage-medium" ? 10 : 15)
      : condition === "always" ? 1 : condition === "damage-medium" ? 3 : 5,
    healCap: condition === "damage-medium" ? 7 : 10, apCost: 1,
  };
  if (triggerId === "after-heal") {
    const [stacks, repeat, nextAT, heal, ap, hpThreshold] = {
      always: [1, 1, 2, 5], "hp-medium": [2, 2, 4, 10, 1, .5], "hp-low": [3, 3, 6, 15, 2, .25],
    }[condition];
    return { stacks: effect === "emergency" ? (condition === "hp-medium" ? 1 : 2) : stacks, repeat: effect === "emergency" ? 1 : repeat,
      amount: effect === "target-ap-up" ? ap : effect === "target-heal" ? heal : nextAT, hpThreshold };
  }
  if (triggerId === "phase-end") {
    if (["heal-by-buff", "damage-by-debuff"].includes(effect)) return { perStack: condition === "first-action" ? 4 : 2 };
    const cost = Number(effect.split("-").at(-1));
    return { hpCostPct: cost / 100, amount: [5,8,10].indexOf(cost) + (condition === "first-action" ? 2 : 1) };
  }
  if (id.startsWith("ap-")) return { scale: 1, min: 0, max: 5 };
  if (id.endsWith("random")) return { low: 0, high: id === "outgoing-random" ? 2.5 : 1.5 };
  return { outgoing: id.endsWith("up") ? 2 : .5, incoming: id.endsWith("up") ? 2 : .5 };
}

// 表示metadataのみ。合法な組み合わせ・semantics・数値は上の完成optionがSSOT。
const B_TUNING_LABELS = { stacks: "付与stack数", repeat: "ランダム1stack解除の回数", amount: "効果量",
  chance: "発動確率（0～1）", threshold: "条件の閾値", hpThreshold: "HP割合の閾値（0～1）",
  hpCostPct: "最大HP消費率（0～1）", apCost: "消費AP", healCap: "回復上限", perStack: "1stackあたりの効果量",
  AT: "AT補正", DF: "DF補正", scale: "APへの係数", min: "補正下限", max: "補正上限",
  low: "倍率下限", high: "倍率上限", outgoing: "与通常ダメージ倍率", incoming: "被通常ダメージ倍率" };
export function getBTriggerOptions(catalog = createBSkillCatalog()) { return catalog.triggers; }
export function getBConditionOptions(triggerId, catalog = createBSkillCatalog()) {
  return [...new Map(catalog.events.filter(e => e.triggerId === triggerId)
    .map(e => [e.conditionId, { id: e.conditionId, label: e.conditionLabel }])).values()];
}
export function getBEffectOptions(triggerId, conditionId, catalog = createBSkillCatalog()) {
  return catalog.events.filter(e => e.triggerId === triggerId && e.conditionId === conditionId);
}
export function getBTraitOptions(catalog = createBSkillCatalog()) { return catalog.traits; }
export function getBSelectionDefinition(selection, catalog = createBSkillCatalog()) {
  const resolved = resolveSelection("B", selection, catalog);
  if (resolved.errors.length || resolved.incomplete.length) return undefined;
  selection = resolved.selection;
  return selection?.type === "trait" ? catalog.traits.find(t => t.id === selection.traitId)
    : selection?.type === "event" ? getBEffectOptions(selection.triggerId, selection.conditionId, catalog).find(e => e.effectId === selection.effectId) : undefined;
}
