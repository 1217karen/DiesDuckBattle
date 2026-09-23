// C作成/APルールの信頼済み設定。価格表・再抽選率の最終値は未確定。
export const C_HP_FAILURE_MULTIPLIER = 0.2;

export function createCSkillRules() {
  return { baseAP: 5, minimumAP: 5, minEffects: 1, maxEffects: 5,
    additionalBenefitSlotAP: 1, repeatReviveChance: null,
    branchAggregation: null, branchAPDelta: { random: null, hpCondition: null } };
}
