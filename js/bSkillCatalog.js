import { STATUS_GROUPS } from "./statusGroups.js";

// trusted catalog。数値未確定は各完成optionのtuningに隔離し、selectionから受け取らない。
export function createBSkillCatalog() {
  const triggers = [
    ["phase-start", "フェイズ開始時", "phaseStart"], ["before-attack", "通常攻撃前", "beforeAttack"],
    ["after-hit", "攻撃命中後", "afterDamage"], ["after-take-hit", "被攻撃命中後", "afterTakeDamage"],
    ["after-heal", "回復時", "afterHeal"], ["phase-end", "フェイズ終了時", "phaseEnd"],
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
    return { ...identity, optionAxes, tuning, tuningKinds, semantics: { rules } };
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
  for (const target of ["self", "enemy"]) add("before-attack", `${target}-has-debuff`, "attack-at-up",
    all(normal, cond(`${target}.statusTotal:debuff`, ">=", 1)), next("self"));
  add("before-attack", "self-debuff-total", "attack-at-by-debuff", all(normal,
    cond("self.statusTotal:debuff", ">=", n("threshold"))),
  change("self", "nextAttackATPlus", { read: "self.statusTotal:debuff" }));

  const damageCondition = id => id === "always" ? null : id === "counter" ? cond("attack.isCounter", "==", true)
    : cond("attack.damage", ">=", n("threshold"));
  for (const condition of ["always", "damage-medium", "damage-high", "counter"]) {
    for (const [id, effect] of [["enemy-debuff", grant("enemy", "debuff")],
      ["enemy-buff-remove", remove("enemy", "buff")], ["enemy-next-at-down", next("enemy", true)]])
      add("after-hit", condition, id, damageCondition(condition), effect);
  }
  for (const condition of ["always", "damage-medium", "damage-high"]) {
    for (const [target, group] of [["self", "buff"], ["enemy", "debuff"]])
      add("after-take-hit", condition, `${target}-${group}`, damageCondition(condition),
        grant(target, group, condition === "always" ? 1 : n("stacks")));
    if (condition === "always") continue;
    for (const [id, effect] of [["self-next-at-up", next("self")], ["enemy-next-at-down", next("enemy", true)]])
      add("after-take-hit", condition, id, damageCondition(condition), effect);
  }
  add("after-take-hit", "damage-medium", "heal-by-ap", damageCondition("damage-medium"),
    heal("self", { read: "self.ap" }, { max: n("healCap", "optionalCap") }));
  add("after-take-hit", "damage-high", "ap-cost-heal", all(damageCondition("damage-high"),
    cond("self.ap", ">=", n("apCost"))), [change("self", "ap", { negate: n("apCost") }), heal("self")]);
  add("after-take-hit", "damage-high", "damage-by-enemy-ap", damageCondition("damage-high"),
    { type: "fixedDamage", target: "enemy", amount: { read: "enemy.ap" } });

  for (const condition of ["always", "hp-medium", "hp-low"]) {
    const when = all(cond("heal.actual", ">", 0), condition === "always" ? null
      : cond("heal.hpPctAfter", "<=", n("hpThreshold", "probability")));
    for (const [id, effect] of [["target-buff", grant("healTarget", "buff")],
      ["target-debuff-remove", remove("healTarget", "debuff")], ["target-next-at-up", next("healTarget")],
      ["target-heal", heal("healTarget", n("amount"), { source: "afterHealBonus" })]])
      add("after-heal", condition, id, when, effect);
    if (condition === "hp-medium") add("after-heal", condition, "target-ap-up", when, change("healTarget", "ap", n("amount")));
    if (condition === "hp-low") add("after-heal", condition, "emergency", when,
      [remove("healTarget", "debuff"), grant("healTarget", "buff")]);
  }
  add("phase-end", "always", "heal-by-buff", null, { type: "heal", target: "self",
    byStatusCount: { statuses: [...STATUS_GROUPS.buff], n: n("perStack") } });
  for (const [id, effect] of [["ap-up", change("self", "ap", n("amount"))],
    ["self-buff", grant("self", "buff")], ["self-debuff-remove", remove("self", "debuff")]])
    add("phase-end", "hp-high", id, cond("self.hpPct", ">=", n("hpThreshold", "probability")),
      [{ type: "fixedDamage", target: "self", amountMaxHpPct: n("hpCostPct", "probability") }, effect]);

  for (const [id, op] of [["high", ">="], ["low", "<="]]) {
    for (const stats of [["AT"], ["DF"], ["AT", "DF"]]) trait(`hp-${id}-${stats.join("-").toLowerCase()}`, [{
      trigger: "passive", modifier: { kind: "conditional", when: cond("self.hpPct", op, n("hpThreshold", "probability")),
        bonus: Object.fromEntries(stats.map(stat => [stat, n(stat, "integer")])) },
    }]);
    trait(`hp-${id}-extra-attack`, [{ trigger: "beforeRoll", when: cond("self.hpPct", op, n("hpThreshold", "probability")),
      effect: change("self", "attackTimesAdd", 1) }]);
  }
  for (const stat of ["AT", "DF"]) trait(`ap-${stat.toLowerCase()}`, [{ trigger: "passive", modifier: {
    kind: "scaled", source: "self.ap", targetStat: stat, scale: n("scale", "nonnegative"), min: n("min", "integer"), max: n("max", "integer"),
  } }]);
  const multiplier = (trigger, value) => ({ trigger, when: normal, effect: { type: "changeAttack", op: "mulDamage", value } });
  trait("outgoing-random", [multiplier("beforeAttack", { randUniform: [n("low", "nonnegative"), n("high", "nonnegative")] })]);
  trait("incoming-random", [multiplier("beforeTakeDamage", { randUniform: [n("low", "nonnegative"), n("high", "nonnegative")] })]);
  for (const direction of ["up", "down"]) trait(`damage-both-${direction}`, [
    multiplier("beforeAttack", n("outgoing", "nonnegative")), multiplier("beforeTakeDamage", n("incoming", "nonnegative")),
  ]);
  return { triggers, events, traits, optionSets: Object.fromEntries(["buff", "debuff"].map(group =>
    [group, STATUS_GROUPS[group].map(id => ({ id, value: id }))])) };
}
