import { getDiceFrame } from "./diceFrames.js";

// A作成専用。エンジンeffectではなく、運営が公開した意味・対象の組合せをIDで選ぶ。
// 毎回独立した設定を返す。amountOptions / pointCost は未確定（0と区別）。
export function createASkillCatalog() {
  const categories = [
    ["damage", "固定ダメージ"], ["healing", "HP回復"], ["ap", "AP操作"],
    ["ailment", "状態異常付与"], ["enhancement", "状態強化付与"],
    ["nextAttack", "次の通常攻撃へのAT補正"], ["cancelAttack", "通常攻撃キャンセル"],
    ["diceOnly", "出目専用効果"],
  ].map(([id, label]) => ({ id, label }));
  const effects = [];
  const add = (id, categoryId, label, targetId, drawback, extra = {}) => effects.push({
    id, categoryId, label, targetId,
    polarity: drawback ? "drawback" : "benefit",
    drawbackPoints: drawback ? 1 : 0,
    requiresAmount: true, amountOptions: [], pointCost: null,
    ...extra,
  });
  add("damage-enemy", "damage", "相手に固定ダメージ", "enemy", false);
  add("damage-self", "damage", "自分に固定ダメージ", "self", true);
  add("heal-self", "healing", "自分のHP回復", "self", false);
  add("heal-enemy", "healing", "相手のHP回復", "enemy", true);
  for (const target of ["self", "enemy"]) {
    for (const direction of ["increase", "decrease"]) {
      add(`ap-${target}-${direction}`, "ap",
        `${target === "self" ? "自分" : "相手"}のAP${direction === "increase" ? "増加" : "減少"}`,
        target, (target === "enemy") === (direction === "increase"), { direction });
    }
  }
  const statuses = [
    ["crack", "亀裂", "ailment"], ["Headwind", "逆風", "ailment"],
    ["roughWave", "荒波", "ailment"], ["steam", "湯気", "ailment"],
    ["tailwind", "追風", "enhancement"], ["focus", "集中", "enhancement"],
    ["counter", "反撃", "enhancement"], ["clean", "清潔", "enhancement"],
  ].map(([id, label, categoryId]) => ({ id, label, categoryId }));
  for (const status of statuses) {
    for (const target of ["self", "enemy"]) {
      add(`grant-${status.id}-${target}`, status.categoryId,
        `${target === "self" ? "自分" : "相手"}に${status.label}付与`, target,
        status.categoryId === "ailment" ? target === "self" : target === "enemy",
        { statusId: status.id });
    }
  }
  add("next-at-self-increase", "nextAttack", "自分の次の通常攻撃にAT+n", "self", false, { direction: "increase" });
  add("next-at-enemy-decrease", "nextAttack", "相手の次の通常攻撃にAT-n", "enemy", false, { direction: "decrease" });
  add("cancel-self-attack", "cancelAttack", "自分の通常攻撃をキャンセル", "self", true, { requiresAmount: false });
  for (const [face, id, label] of [
    [1, "cancel-dice1-ap", "AP増加をキャンセル"],
    [2, "reduce-dice2-attacks", "通常攻撃回数を1回減らす（2回→1回）"],
    [3, "cancel-dice3-heal", "HP回復をキャンセル"],
    [4, "cancel-dice4-counter", "反撃付与をキャンセル"],
    [5, "cancel-dice5-ap", "AP減少をキャンセル"],
  ]) add(id, "diceOnly", `[出目${face}専用] ${label}`, "self", true,
    { exactFace: face, requiresAmount: false });
  add("reduce-dice6-recoil", "diceOnly", "[出目6専用] 反動ダメージを軽減", "self", false,
    { exactFace: 6, direction: "decrease" });
  add("increase-dice6-recoil", "diceOnly", "[出目6専用] 反動ダメージを増加", "self", true,
    { exactFace: 6, direction: "increase" });
  return {
    categories, effects, statuses,
    targets: [{ id: "self", label: "自分" }, { id: "enemy", label: "相手" }],
    triggerCosts: { exact: 0, rangeByCount: { 1: 0, 2: 1, 3: 2 }, all: 2 },
    // TODO: 上限未確定。現在は還元の切り捨て・拒否を行わない。
    maxDrawbackPoints: null,
  };
}

// コストは素体の元の非0出目だけで計算。装着数や将来のDスキルは参照しない。
export function getATriggerOptions(diceFrame, catalog = createASkillCatalog()) {
  const frame = getDiceFrame(diceFrame);
  if (!frame) return [];
  const faces = frame.faces;
  const out = [0, ...faces].map(value => ({
    id: `exact:${value}`, kind: "exact", value, label: `出目${value}の時`,
    baseFaces: [value], pointCost: catalog.triggerCosts.exact,
  }));
  for (const kind of ["lte", "gte"]) {
    for (const value of kind === "lte" ? faces.slice(0, -1) : faces.slice(1)) {
      const baseFaces = faces.filter(face => kind === "lte" ? face <= value : face >= value);
      out.push({ id: `${kind}:${value}`, kind, value,
        label: `出目${value}${kind === "lte" ? "以下" : "以上"}`,
        baseFaces, pointCost: catalog.triggerCosts.rangeByCount[baseFaces.length] ?? null });
    }
  }
  out.push({ id: "all", kind: "all", label: "全ての出目", baseFaces: [0, ...faces], pointCost: catalog.triggerCosts.all });
  return out;
}

export function getAEffectAvailability(effectId, diceFrame, triggerId, catalog = createASkillCatalog()) {
  const effect = typeof effectId === "string" && catalog.effects.find(item => item.id === effectId);
  const trigger = getATriggerOptions(diceFrame, catalog).find(item => item.id === triggerId);
  if (!effect) return { selectable: false, reason: { code: "UNKNOWN_EFFECT", message: "未登録のA効果です。" } };
  if (!trigger) return { selectable: false, reason: { code: "INVALID_TRIGGER", message: "この素体で発動条件を選択してください。" } };
  if (effect.exactFace != null && (trigger.kind !== "exact" || trigger.value !== effect.exactFace)) {
    return { selectable: false, reason: { code: "EXACT_FACE_REQUIRED", requiredFace: effect.exactFace,
      message: `「出目${effect.exactFace}の時」専用です。` } };
  }
  return { selectable: true, reason: null };
}

// 常に全効果を返す。専用効果も除外せずselectable/reasonを添える。
// 対象/状態/方向はeffectIdに組み込み済み。UIでその組合せを再判定する必要はない。
export function getAEffectOptions(diceFrame, triggerId, catalog = createASkillCatalog()) {
  return catalog.categories.map(category => {
    const effects = catalog.effects.filter(effect => effect.categoryId === category.id);
    return {
      ...category,
      targets: catalog.targets.filter(target => effects.some(effect => effect.targetId === target.id)),
      statuses: catalog.statuses.filter(status => effects.some(effect => effect.statusId === status.id)),
      effects: effects.map(effect => ({ ...effect,
        ...getAEffectAvailability(effect.id, diceFrame, triggerId, catalog) })),
    };
  });
}
