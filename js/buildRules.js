// ユーザー作成時のルール。戦闘中の上限・AP消費・効果実行とは独立。
// null は「未確定」であり「無制限」ではない。確定したルールだけ検査する。
// 戻り値は独立した設定。運営側で変更して validateBuild に渡す（ユーザー入力不可）。
export function createBuildRules() {
  return {
    stats: {
      AT: { min: null, max: null },
      DF: { min: null, max: null },
      // AT/DFの最低値および個別上限（4または5）は未確定。
      // 合計にはdiceFrames.jsから導出するSPも含む。
      totalMax: 9,
    },
    dice: {
      slots: 6,
      maxSameFace: 2,
      maxSameFaceWithEmpty: 3,
    },
    skills: Object.fromEntries(["A", "B", "C", "D"].map(category => [category, {
      maxCount: null,
      budget: null,
      // TODO: (skill, build) => 非負の有限数。ユーザー申告のcostを信用しない。
      costOf: null,
      // TODO: (skill, build) => string[]（違反理由）。条件なしと確定したら () => []。
      // 作成時の組合せ・使用可能条件。戦闘中の発動判定は既存エンジンの責務。
      validate: null,
    }])),
  };
}
