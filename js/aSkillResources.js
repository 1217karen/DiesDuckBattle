import { resolveSelection, withSelectionIssues } from "./selectionNormalization.js";
import { createBuildRules } from "./buildRules.js";
import { calculateBuildResources } from "./buildResources.js";
import { getDiceFrame } from "./diceFrames.js";
import { createASkillCatalog, getATriggerOptions, getAEffectAvailability, matchesATrigger } from "./aSkillCatalog.js";

const record = value => value !== null && typeof value === "object"
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// selectionはIDのみ。catalog/rulesは信頼済み運営設定。completeは見積完了、readyは予算内。
function legacycalculateASkillResources(build, selection, {
  rules = createBuildRules(), catalog = createASkillCatalog(),
} = {}) {
  const errors = [], unresolved = [], effectBreakdown = [];
  const error = (code, path, message) => errors.push({ code, path, message });
  const pending = (code, path) => unresolved.push({ code, path });
  const keys = (value, allowed, path) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) error("UNKNOWN_FIELD", `${path}.${key}`, "未対応の入力です。");
  };
  const price = (value, path) => {
    if (value == null) { pending("PRICE_UNRESOLVED", path); return null; }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError(`Invalid A price: ${path}`);
    return value;
  };
  const sum = values => {
    if (values.includes(null)) return null;
    const result = values.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(result)) throw new TypeError("A resource arithmetic overflow");
    return result;
  };
  const basePoints = price(catalog.basePoints, "basePoints");
  const dicePoints = calculateBuildResources(build, rules).dice?.remaining ?? null;
  const frame = getDiceFrame(build?.diceFrame);
  let validDice = !!frame && Array.isArray(build?.dice) && build.dice.length === rules.dice.slots && dicePoints !== null;
  if (validDice) {
    const counts = new Map();
    for (const face of build.dice) {
      if (!Number.isSafeInteger(face) || (face !== 0 && !frame.faces.includes(face))) validDice = false;
      if (face !== 0) counts.set(face, (counts.get(face) ?? 0) + 1);
    }
    const max = build.dice.includes(0) ? rules.dice.maxSameFaceWithEmpty : rules.dice.maxSameFace;
    if ([...counts.values()].some(count => count > max) || dicePoints < 0) validDice = false;
  }
  if (!validDice) error("INVALID_DICE_RESOURCES", "build.dice", "初期6枠・素体出目・重複数・ダイス資源を確認してください。");
  const availablePoints = sum([basePoints, dicePoints]);
  let triggerCost = null, frequencyCount = null, frequencyRank = null;
  let benefitCount = 0, drawbackCount = 0;
  const effectCount = Array.isArray(selection?.effects) ? selection.effects.length : 0;
  if (!record(selection)) error("INVALID_SELECTION", "aSkill", "A選択データが必要です。");
  else {
    keys(selection, ["triggerId", "effects"], "aSkill");
    const trigger = getATriggerOptions(build?.diceFrame, catalog).find(item => item.id === selection.triggerId);
    if (!trigger) error("INVALID_TRIGGER", "triggerId", "この素体では選べない発動条件です。");
    else {
      triggerCost = price(trigger.pointCost, "triggerCost");
      if (validDice) {
        frequencyCount = build.dice.filter(face => matchesATrigger(trigger, face)).length;
        // 初期0/6の条件も選択可（D追加後に成立し得る）。未定義のランクはnull。
        frequencyRank = frequencyCount === 0 ? null : Math.ceil(frequencyCount / 2);
      }
    }
    if (!Array.isArray(selection.effects)) error("INVALID_EFFECTS", "effects", "効果配列が必要です。");
    else {
      if (effectCount < 1 || effectCount > catalog.maxEffects) error("EFFECT_COUNT", "effects", `1～${catalog.maxEffects}effectが必要です。`);
      const selectedEffectCounts = new Map();
      for (const [index, chosen] of selection.effects.entries()) {
        const path = `effects.${index}`;
        if (!record(chosen)) { error("INVALID_EFFECT", path, "効果IDが必要です。"); continue; }
        keys(chosen, ["effectId", "amountOptionId", "chanceOptionId"], path);
        const definition = catalog.effects.find(item => item.id === chosen.effectId);
        if (!definition) { error("UNKNOWN_EFFECT", path, "未公開のA効果です。"); continue; }
        if (typeof definition.allowDuplicate !== "boolean") throw new TypeError("Invalid A duplicate rule");
        const selectedCount = (selectedEffectCounts.get(definition.id) ?? 0) + 1;
        selectedEffectCounts.set(definition.id, selectedCount);
        if (!definition.allowDuplicate && selectedCount > 1) {
          error("DUPLICATE_EFFECT", `${path}.effectId`, "このA効果は同一スキル内で複数回選択できません。");
        }
        const benefit = definition.polarity === "benefit";
        if (!benefit && definition.polarity !== "drawback") throw new TypeError("Invalid A polarity");
        if (benefit) benefitCount++; else drawbackCount++;
        const availability = getAEffectAvailability(definition.id, build?.diceFrame, selection.triggerId, catalog);
        if (!availability.selectable) error(availability.reason.code, path, availability.reason.message);
        const chanceId = Object.hasOwn(chosen, "chanceOptionId") ? chosen.chanceOptionId : "100";
        const chance = catalog.chanceOptions.find(option => option.id === chanceId);
        if (!chance) error("UNKNOWN_CHANCE_OPTION", `${path}.chanceOptionId`, "未登録の成功率IDです。");
        if (!benefit && chanceId !== "100") error("DRAWBACK_CHANCE", `${path}.chanceOptionId`, "drawbackの成功率は変更できません。");
        if (chance && (![1, .5, .25, .1].includes(chance.value) || (chanceId === "100" && chance.value !== 1))) throw new TypeError("Invalid A chance definition");
        let option = null, selected = !definition.requiresAmount;
        if (definition.requiresAmount) {
          if (!Object.hasOwn(chosen, "amountOptionId")) pending("AMOUNT_UNSELECTED", `${path}.amountOptionId`);
          else {
            option = definition.amountOptions.find(item => item.id === chosen.amountOptionId);
            if (!option) error("UNKNOWN_AMOUNT_OPTION", `${path}.amountOptionId`, "この効果で選べない数量IDです。");
            else {
              if (!Number.isSafeInteger(option.value) || option.value <= 0) throw new TypeError("Invalid A amount definition");
              selected = true;
            }
          }
        } else if (Object.hasOwn(chosen, "amountOptionId")) error("UNEXPECTED_AMOUNT", path, "数量指定不可です。");
        const baseEffectCost = benefit ? (selected ? price(option ? option.pointCost : definition.pointCost, `${path}.pointCost`) : null) : 0;
        const chanceDiscount = benefit ? (chance ? price(chance.discount, `${path}.chanceDiscount`) : null) : 0;
        const effectCost = baseEffectCost === null || chanceDiscount === null ? null : Math.max(0, baseEffectCost - chanceDiscount);
        const appliedChanceDiscount = effectCost === null ? null : baseEffectCost - effectCost;
        const drawbackPoints = benefit ? 0 : (selected ? price(option && Object.hasOwn(option, "drawbackPoints") ? option.drawbackPoints : definition.drawbackPoints, `${path}.drawbackPoints`) : null);
        effectBreakdown.push({ index, effectId: definition.id, polarity: definition.polarity,
          baseEffectCost, chanceDiscount, appliedChanceDiscount, effectCost, drawbackPoints });
      }
    }
  }
  const benefitSlotCost = Math.max(0, benefitCount - 1);
  const total = key => effectBreakdown.length === effectCount && record(selection) && Array.isArray(selection.effects)
    ? sum(effectBreakdown.map(row => row[key])) : null;
  const known = key => sum(effectBreakdown.map(row => row[key] ?? 0));
  const effectCost = total("effectCost"), drawbackPoints = total("drawbackPoints");
  const baseEffectCost = total("baseEffectCost"), chanceDiscount = total("appliedChanceDiscount");
  const grossCost = errors.length ? null : sum([triggerCost, benefitSlotCost, effectCost]);
  const netCost = sum([grossCost, drawbackPoints === null ? null : -drawbackPoints]);
  const remaining = sum([availablePoints, netCost === null ? null : -netCost]);
  const complete = errors.length === 0 && unresolved.length === 0 && remaining !== null;
  return { basePoints, dicePoints, availableDicePoints: dicePoints, availablePoints, triggerCost,
    frequencyCount, frequencyRank, effectCount, benefitCount, drawbackCount, benefitSlotCost,
    baseEffectCost, chanceDiscount, effectCost, drawbackPoints, grossCost, netCost, remaining,
    knownEffectCost: known("effectCost"), knownDrawbackPoints: known("drawbackPoints"), effectBreakdown,
    complete, ready: complete && remaining >= 0, errors, unresolved };
}

export function calculateASkillResources(build, selection, options = {}) {
  const catalog = options.catalog ?? createASkillCatalog();
  const resolved = resolveSelection("A", selection, catalog);
  const result = legacycalculateASkillResources(build, resolved.selection, { ...options, catalog });
  const merged = withSelectionIssues(result, resolved);
  return merged;
}
