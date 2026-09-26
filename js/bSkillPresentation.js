import { statusLabel } from "./statusMetadata.js";

// Display only: legal combinations and all balance values live in the trusted catalog.
export function bEventPresentation(d) {
  const { triggerId: trigger, conditionId: condition, effectId: effect, tuning: t } = d;
  const triggerLabel = { "phase-start": "自分フェイズ開始時", "before-attack": "通常攻撃前",
    "after-hit": "攻撃命中後", "after-take-hit": "被通常攻撃命中後", "after-heal": "HP回復時",
    "phase-end": "自分フェイズ終了時" }[trigger];
  const conditionLabel = condition.startsWith("damage-")
    ? `${trigger === "after-hit" ? "与えた" : "受けた"}通常ダメージが${t.threshold}以上なら`
    : { always: trigger === "after-hit" ? "通常攻撃なら" : "常に", "first-action": "そのターンの最初のフェイズなら",
      counter: "反撃なら", "self-has-debuff": "自分アヒルに状態異常が付与されているなら",
      "enemy-has-debuff": "相手アヒルに状態異常が付与されているなら",
      "self-debuff-total": `自分アヒルに状態異常が${t.threshold}以上付与されているなら`,
      "hp-medium": `回復後も対象HPが${t.hpThreshold * 100}%以下なら`,
      "hp-low": `回復後も対象HPが${t.hpThreshold * 100}%以下なら` }[condition];
  let effectLabel;
  if (trigger === "phase-start") {
    const buff = "ランダムな状態強化", debuff = "ランダムな状態異常";
    const chance = t.chance === undefined ? "" : `${t.chance * 100}%の確率で`;
    effectLabel = effect === "self-buff-debuff" ? `自分アヒルに${buff}を${t.stacks}付与し、自分アヒルに${debuff}を${t.stacks}付与する`
      : effect.startsWith("both-") ? `自分アヒルと相手アヒルに${effect.endsWith("debuff") ? debuff : buff}を${t.stacks}ずつ付与する`
      : `${effect.endsWith("debuff") ? "相手" : "自分"}アヒルに${effect.endsWith("debuff") ? debuff : buff}を${chance}${t.stacks}付与する`;
  } else if (trigger === "phase-end") {
    effectLabel = effect === "heal-by-buff" ? `自分アヒルのHPを付与されている状態強化の合計数×${t.perStack}回復する`
      : effect === "damage-by-debuff" ? `相手アヒルに自分アヒルに付与されている状態異常の合計数×${t.perStack}の固定ダメージを与える`
      : `自分アヒルの最大HP${t.hpCostPct * 100}%を消費してAP${t.amount}増加する`;
  } else effectLabel = {
    "attack-at-up": `自分アヒルの次の通常攻撃をAT${t.amount}増加する`,
    "attack-at-by-debuff": "自分アヒルの次の通常攻撃を付与されている状態異常の合計数だけAT増加する",
    "enemy-debuff": `相手アヒルに{status}を${t.stacks}付与する`,
    "self-buff": `自分アヒルに{status}を${t.stacks}付与する`,
    "enemy-buff-remove": `相手アヒルの状態強化をランダムに${t.repeat}stack解除する`,
    "enemy-next-at-down": `相手アヒルの次の通常攻撃をAT${t.amount}減少する`,
    "self-next-at-up": `自分アヒルの次の通常攻撃をAT${t.amount}増加する`,
    "self-heal": condition === "counter" ? `自分アヒルのHPを${t.amount}回復する`
      : `自分アヒルのHPを与えた通常ダメージの${d.semantics.rules[0].effect.byAttackDamagePct * 100}%回復する（小数切り捨て、最大${t.healCap}）`,
    "heal-by-ap": `自分アヒルの現在APの数だけHP回復する（上限${t.healCap}）`,
    "ap-cost-heal": `自分アヒルのAPを${t.apCost}消費してHP${t.amount}回復する`,
    "target-buff": `回復対象に{status}を${t.stacks}付与する`,
    "target-debuff-remove": `回復対象の状態異常をランダムに${t.repeat}stack解除する`,
    "target-next-at-up": `回復対象の次の通常攻撃をAT${t.amount}増加する`,
    "target-heal": `回復対象のHPをさらに${t.amount}回復する`,
    "target-ap-up": `回復対象のAPを${t.amount}増加する`,
    emergency: `回復対象の状態異常をランダムに${t.repeat}stack解除し、{status}を${t.stacks}付与する`,
  }[effect];
  return { triggerLabel, conditionLabel, effectLabel };
}

export function bTraitPresentation(d) {
  const rule = d.semantics.rules[0], t = d.tuning;
  let category, conditionLabel, effectLabel;
  if (d.id.startsWith("hp-")) {
    category = "HP条件";
    const when = rule.modifier?.when ?? rule.when;
    conditionLabel = `自分アヒルのHPが${t.hpThreshold * 100}%${when.op === ">=" ? "以上" : "以下"}なら`;
    effectLabel = rule.modifier ? [t.AT && `AT+${t.AT}`, t.DF && `DF+${t.DF}`].filter(Boolean).join(" / ") : "通常攻撃回数+1";
  } else if (d.id.startsWith("ap-")) {
    category = "AP基準補正"; conditionLabel = "";
    effectLabel = d.id.startsWith("ap-inverse-") ? `${rule.modifier.offset} − 現在APだけ${rule.modifier.targetStat}増加する（最低${rule.modifier.min}）`
      : `現在APの数だけ${rule.modifier.targetStat}増加する（最大${t.max}）`;
  } else {
    category = "ランダム倍率変更"; conditionLabel = "";
    effectLabel = d.id.endsWith("random") ? `${d.id.startsWith("outgoing") ? "与える" : "受ける"}通常ダメージがランダムに${t.low}～${t.high}倍になる`
      : `与える通常ダメージと受ける通常ダメージが両方${t.outgoing}倍になる`;
  }
  return { presentation: { category, conditionLabel, effectLabel }, label: [conditionLabel, effectLabel].filter(Boolean).join("、") };
}

export function bEffectText(definition, statusId) {
  const group = definition.optionAxes.statusId;
  const text = statusId === "random" ? `ランダムな状態${group === "buff" ? "強化" : "異常"}`
    : statusId ? statusLabel(statusId) : "○○";
  return definition.effectLabel.replaceAll("{status}", text);
}
export function bSentence(definition, statusId) {
  if (!definition) return "";
  return definition.triggerId ? [definition.triggerLabel, definition.conditionLabel, bEffectText(definition, statusId)].join("、") : definition.label;
}
