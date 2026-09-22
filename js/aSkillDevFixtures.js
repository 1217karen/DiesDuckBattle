import { createASkillCatalog } from "./aSkillCatalog.js";

// 開発確認専用。数値・価格・還元はゲームバランス仕様ではない。
export function createADevCatalog() {
  const catalog = createASkillCatalog();
  for (const effect of catalog.effects) {
    const s = effect.semantics;
    const values = ["fixedDamage", "heal"].includes(s.type) ? [5, 10, 20]
      : s.key === "additionalRecoil" ? [2, 3, 4, 5] : s.key === "attackTimesAdd" ? [1, 2] : [1, 2, 3];
    if (effect.requiresAmount) effect.amountOptions = values.map((value, index) => ({
      id: `dev-${value}`, label: `仮：${value}`, value,
      pointCost: effect.polarity === "benefit" ? index + 1 : 0,
      drawbackPoints: effect.polarity === "drawback" ? index + 1 : 0,
    }));
    effect.pointCost = effect.polarity === "benefit" ? 1 : 0;
    effect.drawbackPoints = effect.polarity === "drawback" ? 1 : 0;
  }
  catalog.chanceOptions.forEach((option, index) => { option.discount = index; });
  return catalog;
}
