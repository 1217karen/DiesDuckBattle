import { createBSkillCatalog } from "./bSkillCatalog.js";

// 開発テスト専用の仮値。本番バランスではない。production側からimportしない。
export function createBDevCatalog() {
  const catalog = createBSkillCatalog();
  for (const definition of [...catalog.events, ...catalog.traits]) {
    const stronger = ["damage-high", "hp-low", "first-action"].includes(definition.conditionId);
    for (const key of Object.keys(definition.tuning)) {
      const values = { stacks: stronger ? 3 : 2, repeat: stronger ? 3 : 1,
        amount: stronger ? 20 : 5, chance: stronger ? .75 : .5,
        threshold: definition.conditionId === "damage-high" ? 30 : definition.conditionId === "self-debuff-total" ? 3 : 10,
        hpThreshold: definition.conditionId === "hp-low" ? .25 : .5, hpCostPct: .1,
        apCost: 3, healCap: 20, perStack: 2, AT: 3, DF: 3, scale: 1, min: 0, max: 10,
        low: 0, high: 2, outgoing: definition.id.endsWith("down") ? .5 : 1.5,
        incoming: definition.id.endsWith("down") ? .5 : 1.5 };
      if (!Object.hasOwn(values, key)) throw new Error(`Missing dev tuning: ${key}`);
      definition.tuning[key] = values[key];
    }
  }
  return catalog;
}
