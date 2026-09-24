import { normalizedACatalog } from "./effectSelectionCatalog.js";
import { statusLabel } from "./statusMetadata.js";
import { getDiceFrame } from "./diceFrames.js";
import { STATUS_GROUPS } from "./statusGroups.js";

// 信頼済み運営定義（balance v0）。各呼出しは独立した設定を返す。
export function createASkillCatalog() {
  const categories = [
    ["damage", "固定ダメージ"], ["healing", "固定HP回復"], ["ap", "AP操作"],
    ["ailment", "debuff付与"], ["enhancement", "buff付与"],
    ["removeStatus", "指定status 1stack解除"], ["nextAttack", "次回通常攻撃AT"],
    ["phase", "現在phase AT/DF"], ["cancelAttack", "通常攻撃回数"],
    ["recoil", "追加反動"], ["diceOnly", "出目専用効果"],
  ].map(([id, label]) => ({ id, label }));
  const effects = [];
  const add = (id, categoryId, label, target, drawback, semantics, extra = {}) => effects.push({
    id, categoryId, label, targetId: target, polarity: drawback ? "drawback" : "benefit",
    requiresAmount: true, allowDuplicate: true, amountOptions: [], pointCost: null,
    drawbackPoints: drawback ? null : 0, semantics: { ...semantics, target }, ...extra,
  });
  const change = (key, sign = 1) => ({ type: "changeValue", key, op: "add", sign });
  for (const target of ["self", "enemy"]) {
    add(`damage-${target}`, "damage", `${target}へ固定ダメージ`, target, target === "self", { type: "fixedDamage" });
    add(`heal-${target}`, "healing", `${target}を固定回復`, target, target === "enemy", { type: "heal" });
    for (const direction of ["increase", "decrease"]) {
      const sign = direction === "increase" ? 1 : -1;
      const drawback = (target === "enemy") === (sign === 1);
      add(`ap-${target}-${direction}`, "ap", `${target} AP${sign === 1 ? "+" : "−"}`, target, drawback, change("ap", sign));
      add(`next-at-${target}-${direction}`, "nextAttack", `${target} 次回通常攻撃AT${sign === 1 ? "+" : "−"}`, target, drawback, change("nextAttackATPlus", sign));
    }
  }
  const statuses = [];
  for (const group of ["debuff", "buff"]) {
    const categoryId = group === "debuff" ? "ailment" : "enhancement";
    for (const status of STATUS_GROUPS[group]) statuses.push({ id: status, label: statusLabel(status), categoryId });
    for (const target of ["self", "enemy"]) {
      const drawback = (group === "debuff") === (target === "self");
      for (const status of [...STATUS_GROUPS[group], `@${group}`]) {
        const random = status.startsWith("@");
        add(`grant-${random ? `random-${group}` : status}-${target}`, categoryId,
          `${target}に${statusLabel(status)}付与`, target, drawback,
          { type: "changeStatus", status, op: "add", sign: 1 }, random ? {} : { statusId: status });
        if (!random) add(`remove-${status}-${target}`, "removeStatus", `${target}の${statusLabel(status)}を1stack解除`, target, !drawback,
          { type: "changeStatus", status, op: "add", value: -1 }, { requiresAmount: false, statusId: status });
      }
    }
  }
  for (const [target, stat] of [["self", "AT"], ["enemy", "DF"]]) {
    for (const sign of [1, -1]) add(`phase-${stat.toLowerCase()}-${target}-${sign === 1 ? "increase" : "decrease"}`,
      "phase", `${target} 現在phase ${stat}${sign === 1 ? "+" : "−"}`, target,
      (target === "self") === (sign === -1), { type: "addBuff", stat, sign });
  }
  add("cancel-self-attack", "cancelAttack", "自分の通常攻撃を0回にする", "self", true,
    { type: "changeValue", key: "attackTimesOverride", op: "set", value: 0 },
    { requiresAmount: false, allowDuplicate: false });
  add("increase-attacks", "cancelAttack", "現在phaseの通常攻撃回数 +N", "self", false, change("attackTimesAdd"));
  add("additional-recoil", "recoil", "通常攻撃成立phaseの終了時に追加反動", "self", true, change("additionalRecoil"));
  for (const [face, id, label] of [
    [1, "cancel-dice1-ap", "AP+1キャンセル"], [3, "cancel-dice3-heal", "HP回復キャンセル"],
    [4, "cancel-dice4-counter", "反撃+1キャンセル"], [5, "cancel-dice5-ap", "相手AP-1キャンセル"],
  ]) add(id, "diceOnly", `[出目${face}] ${label}`, "self", true,
    { type: "changeValue", key: `skipDice${face}`, op: "set", value: 1 },
    { exactFace: face, requiresAmount: false, allowDuplicate: false });
  add("reduce-dice2-attacks", "diceOnly", "[出目2] 通常攻撃2回→1回", "self", true,
    { ...change("attackTimesAdd"), value: -1 },
    { exactFace: 2, requiresAmount: false, allowDuplicate: false });
  add("reduce-dice6-recoil", "diceOnly", "[出目6] 反動軽減", "self", false, change("recoilMinus"),
    { exactFace: 6, allowDuplicate: false });
  // [効果量, pt絶対値]。反転効果・指定/ランダムstatusで同じ表を使用する。
  // option IDはこのtrusted定義から作り、ユーザーのIDを数値として解釈しない。
  const amounts = {
    damage: [[3, 2], [5, 3]],
    healing: [[5, 2], [10, 4]],
    ap: [[1, 2], [2, 4]],
    ailment: [[1, 1], [2, 2], [3, 3]],
    enhancement: [[1, 1], [2, 2], [3, 3]],
    nextAttack: [[2, 1], [3, 2], [5, 3]],
    phase: [[2, 1], [3, 2], [5, 3]],
    cancelAttack: [[1, 4]], // increase-attacksだけが数量を持つ。
    recoil: [[2, 1], [4, 2]],
    diceOnly: [[3, 2]], // reduce-dice6-recoilだけが数量を持つ。
  };
  const fixedPoints = { removeStatus: 1, cancelAttack: 1, diceOnly: 2 };
  for (const effect of effects) {
    const drawback = effect.polarity === "drawback";
    const points = effect.requiresAmount ? 0 : fixedPoints[effect.categoryId];
    effect.pointCost = drawback ? 0 : points;
    effect.drawbackPoints = drawback ? points : 0;
    if (effect.requiresAmount) effect.amountOptions = amounts[effect.categoryId].map(([value, points]) => ({
      id: `amount-${value}`, label: String(value), value,
      pointCost: drawback ? 0 : points,
      drawbackPoints: drawback ? points : 0,
    }));
  }
  const catalog = {
    categories, effects, statuses, basePoints: 3, maxEffects: 4,
    targets: [{ id: "self", label: "自分" }, { id: "enemy", label: "相手" }],
    triggerCosts: { exact: 0, rangeByCount: { 1: 0, 2: 1, 3: 2 }, all: 2 },
    chanceOptions: [[100, 0], [50, 1], [25, 2], [10, 3]].map(([percent, discount]) => ({ id: String(percent), label: `${percent}%`,
      value: percent / 100, discount })),
    maxDrawbackPoints: null,
  };
  catalog.selectionEffects = normalizedACatalog(catalog);
  return catalog;
}

// 作成時の頻度と戦闘時の意味を共有。baseFacesで戦闘中の追加出目を制限しない。
export function matchesATrigger(trigger, value) {
  if (!Number.isSafeInteger(value) || value < 0) return false;
  switch (trigger?.kind) {
    case "exact": return value === trigger.value;
    case "lte": return value !== 0 && value <= trigger.value;
    case "gte": return value !== 0 && value >= trigger.value;
    case "all": return true;
    default: return false;
  }
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
