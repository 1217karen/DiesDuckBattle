// C作成/APルールの信頼済み設定。balance v0。
export const C_HP_FAILURE_MULTIPLIER = 0.2;

export function createCSkillRules() {
  return { baseAP: 5, minimumAP: 5, minEffects: 1, maxEffects: 5,
    additionalBenefitSlotAP: 1, repeatReviveChance: { 2: 0.5, 3: 0.25, default: 0.1 },
    branchAggregation: "sum", branchAPDelta: { random2: -1, random3: -2, hpCondition: 0 } };
}
