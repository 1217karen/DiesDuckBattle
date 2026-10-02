# Aスキルの共通文章生成

`js/aSkillPresentation.js` はDOMに依存しない表示専用API。
設定画面以外でも、保存済みのDuckとaSelectionから正式な文章を生成できる。

```js
import { presentASkill } from "./aSkillPresentation.js";

const presentation = presentASkill(duck, duck.aSelection);
if (presentation.complete) {
  element.textContent = presentation.text;
}
```

- `text`: 発動条件＋効果文。効果同士は全角`＋`で連結。
- `triggerText`: `出目【n】が出た時、`などの正式な発動条件文。
- `effects`: 保存順の`{ index, text, cancelsNormalAttack }`。
  全体の`text`では独立した通常攻撃キャンセルを先頭に置き、通常効果の順序は変えない。
- `complete`: 文章に必要な値が既存の検証処理で確定しているか。
- `issues`: 既存の検証処理が返すerrors/unresolved。不正・未完成なら`text: null`。
  未設定のselectionも`complete: false, text: null`。入力を修復・変更しない。

文章はプレーンテキスト。HTMLとして挿入せず`textContent`などを使用する。
価格・availability・conflictsを新しく解釈せず、既存の
`calculateASkillResources()` / `resolveSelection()`による検証とtrusted rowを利用する。
確定済みだが予算超過のselectionも文章化できる。`complete`は保存可否ではないため、
保存・対戦可否には従来のvalidationを引き続き使用する。
旧形式も既存resolverが受理する範囲で読み取るだけで、保存データは書き換えない。

## 編集UIと共通の文章構造

- `aEffectParts(effectId, variants)`: 固定文字列と`{ key }`の配列。
  正式文と設定UIは同じ配列を使い、UIだけがfieldをselect/固定spanへ置き換える。
- `aFieldOptionText(key, option)`: 状態名・増減などの表示語彙。
- `aTriggerText(id)`: trigger IDの正式文。未知形式には`null`。
- `aTriggerEditor(legal, current)`: `getATriggerOptions()`の既存行から出目・比較UIを構成。
  合法triggerの直積を作らない。all・未選択・使用不可の保存値は全条件selectorで表示する。

候補は`aEditorCatalog()` / `effectSelectionFields()`から取得する。
候補が1つで保存値と一致するfieldは固定テキスト、複数候補や未選択・不正値はselect。
未選択の1択fieldを表示時に補完しない。自動確定は従来どおり
`changeAClause()`による明示編集時にのみ行う。
出目専用効果の正常なtarget/diceAction/固定amountは内部識別情報として保持し、
不要な出目番号や数量を効果文へ足さない。不正・不足している数量などは再選択用に表示する。

設定画面の効果種別selectorと独立した通常攻撃キャンセルは維持する。
効果枠下の重複した`a-completed-sentence`は廃止し、編集可能な文章そのものを表示する。
ポイント内訳、compiled skill、catalog、balance、selection schemaは変更しない。
