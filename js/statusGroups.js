// 戦闘エンジンの状態分類。効果・常時modifierが同じ定義を参照する。
// 既存の@all選択順も維持。一覧と分類をこの表から導出する。
const definitions = [
  ["crack", "debuff"], ["Headwind", "debuff"], ["roughWave", "debuff"],
  ["tailwind", "buff"], ["focus", "buff"], ["counter", "buff"], ["clean", "buff"], ["steam", "debuff"],
];
export const STATUS_GROUPS = Object.freeze({
  all: Object.freeze(definitions.map(([key]) => key)),
  debuff: Object.freeze(definitions.filter(([, group]) => group === "debuff").map(([key]) => key)),
  buff: Object.freeze(definitions.filter(([, group]) => group === "buff").map(([key]) => key)),
});
