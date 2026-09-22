// 新版Dの完成済み8択。意味はcatalogに固定し、ユーザー入力から生成しない。
export const D_SKILL_OPTIONS = Object.freeze([
  { id: "add-self-0", label: "自分に【0】を追加", semantics: { type: "addDice", target: "self", values: [0] } },
  { id: "add-self-1", label: "自分に【1】を追加", semantics: { type: "addDice", target: "self", values: [1] } },
  { id: "add-self-2", label: "自分に【2】を追加", semantics: { type: "addDice", target: "self", values: [2] } },
  { id: "add-self-3", label: "自分に【3】を追加", semantics: { type: "addDice", target: "self", values: [3] } },
  { id: "add-self-4", label: "自分に【4】を追加", semantics: { type: "addDice", target: "self", values: [4] } },
  { id: "add-self-5", label: "自分に【5】を追加", semantics: { type: "addDice", target: "self", values: [5] } },
  { id: "add-self-6", label: "自分に【6】を追加", semantics: { type: "addDice", target: "self", values: [6] } },
  { id: "add-enemy-0", label: "相手に【0】を追加", semantics: { type: "addDice", target: "enemy", values: [0] } },
].map(option => {
  Object.freeze(option.semantics.values);
  Object.freeze(option.semantics);
  return Object.freeze(option);
}));
