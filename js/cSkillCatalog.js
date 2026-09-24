import { normalizedCCatalog } from "./effectSelectionCatalog.js";
import { statusLabel } from "./statusMetadata.js";
import { STATUS_GROUPS } from "./statusGroups.js";

// ユーザーはeffect/option IDのみ選択。semanticsは将来compiler用の信頼済み情報。
// balance v0。数値・価格の正式な設定元。
export function createCSkillCatalog() {
  const tables = {
    damageAmount: [[50,0],[60,1],[70,2],[80,3],[90,4],[100,5]],
    healAmount: [[30,0],[40,1],[50,2]], currentHpPct: [[.25,0],[.5,5],[.75,10],[1,15]],
    statusStacks: [[3,0]], turnATAmount: [[2,0],[3,1],[4,2]], turnDFAmount: [[2,0],[3,1],[4,2]],
    turnCount: [[2,0],[3,1],[4,2]], timedStacks: [[1,0]], timedTurns: [[3,0],[4,1],[5,2]],
    revivePct: [[.01,0],[.1,2],[.25,4]], hpThreshold: [[.25,-1],[.5,-1],[.75,-1]],
    statusMultiplier: [[10,0],[15,1],[20,2]], stepBaseAmount: [[30,0]], stepEveryTurns: [[5,1],[10,0]], stepAmount: [[5,0],[10,2]],
  };
  const optionSets = Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key,
    rows.map(([value, apDelta]) => ({ id: key + "-" + value, value, apDelta,
      label: ["currentHpPct", "revivePct", "hpThreshold"].includes(key) ? value * 100 + "%" : String(value) }))]));
  for (const group of ["debuff", "buff"]) {
    for (const purpose of ["grant", "clear", "timed"]) {
      optionSets[`${purpose}-${group}`] = STATUS_GROUPS[group].map(id => ({ id, label: statusLabel(id), value: id, apDelta: 0 }));
    }
    optionSets[`grant-${group}`].push({ id: `random-${group}`, label: statusLabel(`@${group}`), value: `@${group}`, apDelta: 0 });
    optionSets[`clear-all-${group}`] = [{ id: "all", label: `全${group}解除`, value: group, apDelta: 2 }];
  }
  const effects = [];
  const add = (id, category, label, polarity, axes, semantics, modes = ["normal", "special"]) => {
    const effect = { id, category, label, modes, polarity, optionAxes: { ...axes }, mirrorId: null, semantics };
    effects.push(effect); return effect;
  };
  const pair = (category, axes, benefit, drawback) => {
    const b = add(benefit.id, category, benefit.label, "benefit", axes, benefit.semantics);
    const d = add(drawback.id, category, drawback.label, "drawback", axes, drawback.semantics);
    b.chanceEnabled = benefit.chanceEnabled === true;
    b.mirrorId = d.id; d.mirrorId = b.id;
  };
  pair("damage", { amount: "damageAmount" },
    { id: "damage-enemy", chanceEnabled: true, label: "相手に固定ダメージ", semantics: { type: "fixedDamage", target: "enemy", amountAxis: "amount" } },
    { id: "damage-self", label: "自分に固定ダメージ", semantics: { type: "fixedDamage", target: "self", amountAxis: "amount" } });
  pair("healing", { amount: "healAmount" },
    { id: "heal-self", chanceEnabled: true, label: "自分を固定値回復", semantics: { type: "heal", target: "self", amountAxis: "amount" } },
    { id: "heal-enemy", label: "相手を固定値回復", semantics: { type: "heal", target: "enemy", amountAxis: "amount" } });
  add("current-hp-damage-enemy", "percentageDamage", "相手の現在HP割合固定ダメージ", "benefit",
    { amountPct: "currentHpPct" }, { type: "fixedDamage", target: "enemy", amountPctAxis: "amountPct" });
  add("debuff-total-damage-enemy", "statusDamage", "相手debuff総stack × Nダメージ", "benefit",
    { multiplier: "statusMultiplier" }, { type: "fixedDamage", target: "enemy", statusMultiplierAxis: "multiplier" });
  add("turn-step-damage-enemy", "turnStepDamage", "経過turnで増加する固定ダメージ", "benefit",
    { baseAmount: "stepBaseAmount", everyTurns: "stepEveryTurns", stepAmount: "stepAmount" },
    { type: "fixedDamage", target: "enemy", amountAxis: "baseAmount", everyTurnsAxis: "everyTurns", stepAmountAxis: "stepAmount" });
  for (const group of ["debuff", "buff"]) {
    const benefitTarget = group === "debuff" ? "enemy" : "self";
    const drawbackTarget = benefitTarget === "self" ? "enemy" : "self";
    pair("statusGrant", { status: `grant-${group}`, amount: "statusStacks" },
      { id: `grant-${group}-${benefitTarget}`, label: `${benefitTarget}に${group}付与`,
        semantics: { type: "changeStatus", target: benefitTarget, group, statusAxis: "status", amountAxis: "amount", op: "add" } },
      { id: `grant-${group}-${drawbackTarget}`, label: `${drawbackTarget}に${group}付与`,
        semantics: { type: "changeStatus", target: drawbackTarget, group, statusAxis: "status", amountAxis: "amount", op: "add" } });
    for (const scope of ["single", "group"]) {
      const axes = scope === "single" ? { status: `clear-${group}` } : { scope: `clear-all-${group}` };
      pair("statusClear", axes,
        { id: `clear-${group}-${scope}-${drawbackTarget}`, label: `${drawbackTarget}の${group}全stack解除（${scope}）`,
          semantics: { type: "clearStatus", target: drawbackTarget, group, scope, statusAxis: scope === "single" ? "status" : null } },
        { id: `clear-${group}-${scope}-${benefitTarget}`, label: `${benefitTarget}の${group}全stack解除（${scope}）`,
          semantics: { type: "clearStatus", target: benefitTarget, group, scope, statusAxis: scope === "single" ? "status" : null } });
    }
    add(`timed-hit-${group}-${benefitTarget}`, "timedHit", `通常攻撃命中後${benefitTarget}に${group}`, "benefit",
      { status: `timed-${group}`, amount: "timedStacks", duration: "timedTurns" },
      { type: "addTimedHitRule", target: "self", statusTarget: benefitTarget, group,
        statusAxis: "status", amountAxis: "amount", durationAxis: "duration" });
  }
  for (const stat of ["AT", "DF"]) for (const target of ["self", "enemy"]) {
    const benefitSign = target === "self" ? 1 : -1;
    const descriptor = sign => ({ id: `turn-${stat.toLowerCase()}-${target}-${sign > 0 ? "up" : "down"}`,
      label: `${target}の${stat}${sign > 0 ? "+" : "-"}（turns）`,
      semantics: { type: "addBuff", target, stat, amountSign: sign, durationKind: "turns", amountAxis: "amount", durationAxis: "duration" } });
    pair("turnBuff", { amount: `turn${stat}Amount`, duration: "turnCount" }, descriptor(benefitSign), descriptor(-benefitSign));
  }
  add("revive-self", "revive", "最大HP割合で復活", "benefit", { maxHpPct: "revivePct" },
    { type: "revive", target: "self", maxHpPctAxis: "maxHpPct" }, ["special"]);
  const catalog = { effects, optionSets,
    chanceOptions: [100, 70, 50, 25].map((percent, apDiscount) => ({ id: String(percent), label: `${percent}%`,
      value: percent / 100, apDiscount })) };
  catalog.selectionEffects = normalizedCCatalog(catalog);
  return catalog;
}

export function getCEffectAvailability(effectId, mode, catalog = createCSkillCatalog()) {
  const effect = catalog.effects.find(item => item.id === effectId);
  if (!effect) return { selectable: false, reason: { code: "UNKNOWN_EFFECT", message: "未公開のC効果です。" } };
  if (!effect.modes.includes(mode)) return { selectable: false, reason: { code: "MODE_UNAVAILABLE", message: "このC modeでは選択できません。" } };
  return { selectable: true, reason: null };
}

export function getCEffectOptions(mode, catalog = createCSkillCatalog()) {
  return catalog.effects.map(effect => ({ ...effect, ...getCEffectAvailability(effect.id, mode, catalog),
    options: Object.fromEntries(Object.entries(effect.optionAxes).map(([axis, set]) => [axis, catalog.optionSets[set]])) }));
}
