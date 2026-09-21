import { createBuildRules } from "./buildRules.js";
import { calculateBuildResources } from "./buildResources.js";
import { createASkillCatalog, getATriggerOptions, getAEffectAvailability } from "./aSkillCatalog.js";

const record = value => value !== null && typeof value === "object"
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * A専用選択DTO: { triggerId, effects: [{ effectId, amountOptionId? }] }
 * 既存validateBuildのskillsとは別。生effect/value/pointCostは受け付けない。
 * catalog/rulesは運営専用。amountOptionsは { id, label, value, pointCost }[]。
 * 数量不要の効果はeffect.pointCostを参照。未設定はnull、明示的0は無料。
 * completeは計算完了のみを表す。負残高でもcomplete:trueであり保存可否ではない。
 * 不正選択はerrors、未選択数量/未確定価格はunresolved。
 * 合計不明の欄はnull、判明済み小計はknownEffectCost/knownDrawbackPointsに残す。
 */
export function calculateASkillResources(build, selection, {
  rules = createBuildRules(), catalog = createASkillCatalog(),
} = {}) {
  const errors = [];
  const unresolved = [];
  const error = (code, path, message) => errors.push({ code, path, message });
  const pending = (code, path) => unresolved.push({ code, path });
  const checkKeys = (value, allowed, path) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) error("UNKNOWN_FIELD", `${path}.${key}`, "未対応の入力です。");
  };
  const price = (value, path) => {
    if (value == null) { pending("PRICE_UNRESOLVED", path); return null; }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError(`Invalid A price: ${path}`);
    return value;
  };
  const sum = (...values) => {
    if (values.includes(null)) return null;
    const total = values.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(total)) throw new TypeError("A resource arithmetic overflow");
    return total;
  };
  const availableDicePoints = calculateBuildResources(build, rules).dice?.remaining ?? null;
  if (availableDicePoints === null) error("INVALID_DICE_RESOURCES", "build.dice", "ダイス資源を計算できません。");
  let triggerCost = null;
  let effectsComplete = true;
  let drawbacksComplete = true;
  let knownEffectCost = 0;
  let knownDrawbackPoints = 0;
  const triggers = getATriggerOptions(build?.diceFrame, catalog);
  if (!record(selection)) {
    error("INVALID_SELECTION", "aSkill", "A選択データが必要です。");
    effectsComplete = drawbacksComplete = false;
  } else {
    checkKeys(selection, ["triggerId", "effects"], "aSkill");
    const trigger = triggers.find(item => item.id === selection.triggerId);
    if (!trigger) error("INVALID_TRIGGER", "triggerId", "この素体では選べない発動条件です。");
    else triggerCost = price(trigger.pointCost, "triggerCost");
    if (!Array.isArray(selection.effects)) {
      error("INVALID_EFFECTS", "effects", "効果の配列が必要です。");
      effectsComplete = drawbacksComplete = false;
    } else for (const [index, chosen] of selection.effects.entries()) {
      const path = `effects.${index}`;
      if (!record(chosen)) {
        error("INVALID_EFFECT", path, "効果IDの選択が必要です。");
        effectsComplete = drawbacksComplete = false; continue;
      }
      checkKeys(chosen, ["effectId", "amountOptionId"], path);
      const effect = typeof chosen.effectId === "string" && catalog.effects.find(item => item.id === chosen.effectId);
      if (!effect) {
        error("UNKNOWN_EFFECT", path, "未公開のA効果です。");
        effectsComplete = drawbacksComplete = false; continue;
      }
      const availability = getAEffectAvailability(chosen.effectId, build?.diceFrame, selection.triggerId, catalog);
      if (!availability.selectable) error(availability.reason.code, path, availability.reason.message);
      const refund = price(effect.drawbackPoints, `${path}.drawbackPoints`);
      if (refund === null) drawbacksComplete = false;
      else knownDrawbackPoints = sum(knownDrawbackPoints, refund);
      let cost = null;
      if (effect.requiresAmount) {
        if (!Object.hasOwn(chosen, "amountOptionId")) pending("AMOUNT_UNSELECTED", `${path}.amountOptionId`);
        else {
          const option = typeof chosen.amountOptionId === "string"
            && effect.amountOptions.find(item => item.id === chosen.amountOptionId);
          if (!option) error("UNKNOWN_AMOUNT_OPTION", `${path}.amountOptionId`, "この効果で選べない数量IDです。");
          else {
            if (typeof option.value !== "number" || !Number.isFinite(option.value)) throw new TypeError("Invalid A amount definition");
            cost = price(option.pointCost, `${path}.pointCost`);
          }
        }
      } else {
        if (Object.hasOwn(chosen, "amountOptionId")) error("UNEXPECTED_AMOUNT", path, "この効果は数量を指定できません。");
        cost = price(effect.pointCost, `${path}.pointCost`);
      }
      if (cost === null) effectsComplete = false;
      else knownEffectCost = sum(knownEffectCost, cost);
    }
  }
  const effectCost = effectsComplete ? knownEffectCost : null;
  const drawbackPoints = drawbacksComplete ? knownDrawbackPoints : null;
  // 不正入力時には最終見積を返さない。判明済みの各内訳は調査・UI表示用に残す。
  const grossCost = errors.length ? null : sum(triggerCost, effectCost);
  const netCost = sum(grossCost, drawbackPoints === null ? null : -drawbackPoints);
  const remaining = sum(availableDicePoints, netCost === null ? null : -netCost);
  return {
    availableDicePoints, triggerCost, effectCost, drawbackPoints, grossCost, netCost, remaining,
    knownEffectCost, knownDrawbackPoints,
    complete: errors.length === 0 && unresolved.length === 0 && remaining !== null,
    errors, unresolved,
  };
}
