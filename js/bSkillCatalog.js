import { STATUS_GROUPS } from "./statusGroups.js";

// trusted production catalog / balance v0。数値はselectionから受け取らない。
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
  add("after-take-hit", "damage-high", "heal-by-ap", damageCondition("damage-high"),
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
    if (condition !== "always") add("after-heal", condition, "target-ap-up", when, change("healTarget", "ap", n("amount")));
    if (condition === "hp-low") add("after-heal", condition, "emergency", when,
      [remove("healTarget", "debuff"), grant("healTarget", "buff")]);
  }
  add("phase-end", "always", "heal-by-buff", null, { type: "heal", target: "self",
    byStatusCount: { statuses: [...STATUS_GROUPS.buff], n: n("perStack") } });
  for (const cost of [5, 8, 10])
    add("phase-end", "always", `ap-up-cost-${cost}`, null,
      [{ type: "fixedDamage", target: "self", amountMaxHpPct: n("hpCostPct", "probability") },
        change("self", "ap", n("amount"))]);

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
  for (const event of events) {
    event.triggerLabel = triggers.find(t => t.id === event.triggerId).label;
    event.conditionLabel = conditionLabel(event);
    event.effectLabel = effectLabel(event);
  }
  for (const item of traits) item.label = traitLabel(item.id);
  for (const definition of [...events, ...traits]) {
    const values = productionTuning(definition);
    for (const key of Object.keys(definition.tuning)) {
      if (!Object.hasOwn(values, key)) throw new Error(`Missing production B tuning: ${definition.id}.${key}`);
      definition.tuning[key] = values[key];
    }
  }
  return { triggers, events, traits, optionSets: Object.fromEntries(["buff", "debuff"].map(group =>
    [group, STATUS_GROUPS[group].map(id => ({ id, value: id, label: B_STATUS_LABELS[id] ?? id }))])) };
}

// balance v0の唯一の数値表。dev fixtureを参照しない。
function productionTuning({ id, triggerId, conditionId: condition, effectId: effect }) {
  if (triggerId === "phase-start") return {
    stacks: condition === "first-action" && effect.startsWith("chance-strong-") ? 2 : 1, chance: .5,
  };
  if (triggerId === "before-attack") return { amount: 3, threshold: 4 };
  if (triggerId === "after-hit") {
    const [stacks, repeat, amount, threshold] = {
      always: [1, 1, 2], "damage-medium": [1, 2, 4, 5], "damage-high": [2, 3, 6, 8], counter: [1, 2, 3],
    }[condition];
    return { stacks, repeat, amount, threshold };
  }
  if (triggerId === "after-take-hit") return {
    threshold: condition === "damage-medium" ? 5 : 8,
    stacks: condition === "damage-medium" ? 2 : 3,
    amount: effect === "ap-cost-heal" ? 15 : condition === "damage-medium" ? 4 : 6,
    healCap: 10, apCost: 1,
  };
  if (triggerId === "after-heal") {
    const [stacks, repeat, nextAT, heal, ap, hpThreshold] = {
      always: [1, 1, 3, 5], "hp-medium": [2, 2, 5, 8, 1, .5], "hp-low": [3, 3, 8, 10, 2, .25],
    }[condition];
    return { stacks: effect === "emergency" ? 2 : stacks, repeat: effect === "emergency" ? 2 : repeat,
      amount: effect === "target-ap-up" ? ap : effect === "target-heal" ? heal : nextAT, hpThreshold };
  }
  if (triggerId === "phase-end") return effect === "heal-by-buff" ? { perStack: 3 }
    : { "ap-up-cost-5": { hpCostPct: .05, amount: 2 }, "ap-up-cost-8": { hpCostPct: .08, amount: 3 },
      "ap-up-cost-10": { hpCostPct: .1, amount: 4 } }[effect];
  if (id.startsWith("hp-")) return {
    hpThreshold: id.includes("extra-attack") ? (id.startsWith("hp-high") ? .75 : .25)
      : id.startsWith("hp-high") ? .6 : .4,
    AT: id.endsWith("at-df") ? 2 : 4, DF: id.endsWith("at-df") ? 2 : 4,
  };
  if (id.startsWith("ap-")) return { scale: 1, min: 0, max: 5 };
  if (id.endsWith("random")) return { low: 0, high: 2 };
  return { outgoing: id.endsWith("up") ? 2 : .5, incoming: id.endsWith("up") ? 2 : .5 };
}

// 表示metadataのみ。合法な組み合わせ・semantics・数値は上の完成optionがSSOT。
const B_STATUS_LABELS = { crack: "亀裂", Headwind: "向かい風", roughWave: "荒波", tailwind: "追風",
  focus: "集中", counter: "反撃", clean: "清潔", steam: "湯気" };
const B_TUNING_LABELS = { stacks: "付与stack数", repeat: "ランダム1stack解除の回数", amount: "効果量",
  chance: "発動確率（0～1）", threshold: "条件の閾値", hpThreshold: "HP割合の閾値（0～1）",
  hpCostPct: "最大HP消費率（0～1）", apCost: "消費AP", healCap: "回復上限", perStack: "1stackあたり回復量",
  AT: "AT補正", DF: "DF補正", scale: "APへの係数", min: "補正下限", max: "補正上限",
  low: "倍率下限", high: "倍率上限", outgoing: "与通常ダメージ倍率", incoming: "被通常ダメージ倍率" };
function conditionLabel({ conditionId: id, triggerId }) {
  if (id === "damage-medium" || id === "damage-high")
    return `${triggerId === "after-hit" ? "与えた" : "受けた"}ダメージが${id === "damage-medium" ? "中" : "高"}閾値以上`;
  return { always: "常に", "first-action": "そのターン最初の自分のフェイズ", counter: "反撃由来なら",
    "self-has-debuff": "自分に異常が1stack以上ある", "enemy-has-debuff": "相手に異常が1stack以上ある",
    "self-debuff-total": "自分の異常総stackが閾値以上", "hp-medium": "回復後も対象HPが中割合以下",
    "hp-low": "回復後も対象HPが低割合以下", "hp-high": "自分のHPが一定割合以上" }[id];
}
function effectLabel({ effectId: id, triggerId, conditionId }) {
  if (triggerId === "phase-end" && id.startsWith("ap-up-cost-"))
    return `最大HPの${id.slice("ap-up-cost-".length)}%固定ダメージ後、自分APを増加`;
  if (triggerId === "phase-start") return {
    "both-buff": "自分と相手にランダム強化", "both-debuff": "相手と自分にランダム異常",
    "self-buff-debuff": "自分にランダム強化と異常", "chance-enemy-debuff": "一定確率で相手にランダム異常",
    "chance-self-buff": "一定確率で自分にランダム強化", "self-buff": "自分にランダム強化",
    "enemy-debuff": "相手にランダム異常", "chance-strong-self-buff": "一定確率で自分に強めのランダム強化",
    "chance-strong-enemy-debuff": "一定確率で相手に強めのランダム異常",
  }[id];
  const text = { "attack-at-up": "今回の通常攻撃ATを増加", "attack-at-by-debuff": "自分の異常総stack数ぶん今回の通常攻撃ATを増加",
    "enemy-debuff": "相手に指定異常を付与", "self-buff": "自分に指定強化を付与",
    "enemy-buff-remove": "相手の付与中強化をランダムに1stackずつ解除", "enemy-next-at-down": "相手の次回通常攻撃ATを減少",
    "self-next-at-up": "自分の次回通常攻撃ATを増加", "heal-by-ap": "自分の現在APぶんHP回復",
    "ap-cost-heal": "必要APを所持していれば、AP消費後にHP回復", "damage-by-enemy-ap": "相手の現在APぶん固定ダメージ",
    "target-buff": "回復対象に指定強化を付与", "target-debuff-remove": "回復対象の付与中異常をランダムに1stackずつ解除",
    "target-next-at-up": "回復対象の次回通常攻撃ATを増加", "target-heal": "回復対象を追加で固定値回復（再発火なし）",
    "target-ap-up": "回復対象のAPを増加", emergency: "緊急回復：対象のランダム異常解除＋指定強化付与",
    "heal-by-buff": "自分の強化総stack数に応じてHP回復", "ap-up": "自分のAPを増加",
    "self-debuff-remove": "自分の付与中異常をランダムに1stackずつ解除" }[id];
  return triggerId === "phase-end" && conditionId === "hp-high" ? `最大HP割合コストを払い、${text}`
    : triggerId === "after-take-hit" && conditionId === "always" ? `${text}（+1stack）` : text;
}
function traitLabel(id) {
  for (const [level, label] of [["high", "HP一定以上"], ["low", "HP一定以下"]]) {
    for (const [suffix, effect] of [["at", "AT補正"], ["df", "DF補正"], ["at-df", "AT・DF補正"], ["extra-attack", "通常攻撃回数+1"]])
      if (id === `hp-${level}-${suffix}`) return `${label}なら${effect}`;
  }
  return { "ap-at": "現在APに比例したAT補正", "ap-df": "現在APに比例したDF補正",
    "outgoing-random": "与通常ダメージがランダム倍率", "incoming-random": "被通常ダメージがランダム倍率",
    "damage-both-up": "与通常ダメージ増加＋被通常ダメージ増加", "damage-both-down": "与通常ダメージ減少＋被通常ダメージ減少" }[id];
}

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
  return selection?.type === "trait" ? catalog.traits.find(t => t.id === selection.traitId)
    : selection?.type === "event" ? getBEffectOptions(selection.triggerId, selection.conditionId, catalog).find(e => e.effectId === selection.effectId) : undefined;
}
