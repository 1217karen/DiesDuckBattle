import { createCSkillCatalog } from "./cSkillCatalog.js";
import { createCSkillRules } from "./cSkillRules.js";

// 開発確認専用・ゲーム仕様ではない。production catalogへ書き戻さない。
export function createCDevCatalog() {
  const catalog = createCSkillCatalog();
  const sets = {
    damageAmount: [10, 30, 40, 50, 60, 70, 100], healAmount: [10, 30, 50, 100],
    currentHpPct: [.1, .2, .3, .4, .5, 1], statusStacks: [1, 2, 3], turnATAmount: [1, 2, 3], turnDFAmount: [1, 2, 3],
    turnCount: [1, 2, 3, 4], timedStacks: [1, 2, 3], timedTurns: [1, 2, 3, 4], revivePct: [.01, .1, .3, .5],
    hpThreshold: [.5], statusMultiplier: [5], stepBaseAmount: [10, 40], stepEveryTurns: [5, 10], stepAmount: [10],
  };
  for (const [key, values] of Object.entries(sets)) {
    catalog.optionSets[key] = values.map(value => ({ id: `dev-${key}-${value}`, value, apDelta: 0,
      label: `仮：${["currentHpPct", "revivePct", "hpThreshold"].includes(key) ? `${value * 100}%` : value}` }));
  }
  for (const options of Object.values(catalog.optionSets)) for (const option of options) option.apDelta = 0;
  catalog.chanceOptions = [100, 80, 75, 50].map(percent => ({ id: percent === 100 ? "100" : `dev-chance-${percent}`,
    label: `${percent}%`, value: percent / 100, apDelta: 0 }));
  return catalog;
}

// 仮の全leaf合算（fallbackも枠・価格へ算入）と追加価格0。ゲーム仕様ではない。
export function createCDevRules() {
  return { ...createCSkillRules(), branchAggregation: "dev-sum", branchAPDelta: { random: 0, hpCondition: 0 },
    chancePricing: "dev-add", onFailPricing: "dev-sum" };
}
