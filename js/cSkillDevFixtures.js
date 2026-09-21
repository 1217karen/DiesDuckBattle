import { createCSkillCatalog } from "./cSkillCatalog.js";

// 開発確認専用・ゲーム仕様ではない。production catalogへ書き戻さない。
export function createCDevCatalog() {
  const catalog = createCSkillCatalog();
  const sets = {
    damageAmount: [10, 30, 50, 100], healAmount: [10, 30, 50, 100],
    currentHpPct: [.1, .3, .5, 1], statusStacks: [1, 2, 3], turnATAmount: [1, 2, 3], turnDFAmount: [1, 2, 3],
    turnCount: [1, 2, 3, 4], timedStacks: [1, 2, 3], timedTurns: [1, 2, 3, 4], revivePct: [.01, .1, .3, .5],
  };
  for (const [key, values] of Object.entries(sets)) {
    catalog.optionSets[key] = values.map(value => ({ id: `dev-${key}-${value}`, value, apDelta: 0,
      label: `仮：${key === "currentHpPct" || key === "revivePct" ? `${value * 100}%` : value}` }));
  }
  for (const options of Object.values(catalog.optionSets)) for (const option of options) option.apDelta = 0;
  return catalog;
}
