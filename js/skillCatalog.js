// ユーザーに公開する選択肢のみを明示的に登録する。エンジンの対応一覧ではない。
// 公開範囲が未確定のため初期値は空。effects.js / Triggers から自動生成しない。
// 既存の戦闘データには適用しない。revive 等の未登録機能もエンジンに残る。
//
// 各項目: 独自の選択ID -> { label: string, categories: ["A", ...] }
// IDは完成済みの選択肢を表し、engine effect.type や生のeffectではない。
// 例（公開を決める仕様ではない）:
// effects: { "heal-self-small": { label: "小回復", categories: ["C"] } }
// 数値可変パラメータはまだ受け付けない。導入時は専用schemaと検証を追加する。
// 将来のbuildCompilerがIDごとに信頼済みの変換処理を持つ。
export function createSkillCatalog() {
  return { effects: {}, triggers: {} };
}

export function getCatalogChoice(catalog, kind, id) {
  const entries = catalog?.[kind];
  return typeof id === "string" && entries && Object.hasOwn(entries, id)
    ? entries[id] : undefined;
}
