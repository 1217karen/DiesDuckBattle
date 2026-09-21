# Aスキル作成カタログと見積

既存のbuildValidatorのskills DTOとは独立した作成用API。
buildRulesは全体の作成制限、buildResourcesは素体とダイスから資源を計算し、
skillCatalogは従来の汎用選択基盤を維持する。A専用定義はaSkillCatalogへ分離する。
戦闘適用・compiler・HTML UI・保存可否判定は実装しない。

## API

- `createASkillCatalog()`：独立した運営設定を生成する。
- `getATriggerOptions(diceFrame, catalog?)`：素体で選べる条件ID、表示名、意味、素体上の対象出目、価格。
- `getAEffectOptions(diceFrame, triggerId, catalog?)`：カテゴリごとの全効果、対象・状態候補、数量候補、還元値、選択可否と理由。
- `getAEffectAvailability(effectId, diceFrame, triggerId, catalog?)`：条件に対する選択可否。数量や価格の確定状況とは別。
- `calculateASkillResources(build, selection, { rules?, catalog? })`：純粋なポイント見積。

catalog/rulesは信頼済みの運営設定。ユーザーから受け取らない。
効果IDは対象・状態・増減方向まで含む公開組合せ。
UIがtarget/status/directionからデメリットを再判定する必要はなく、
各効果の `targetId/statusId/direction/polarity/drawbackPoints` を参照する。
カテゴリのtargets/statusesで絞り込み、該当するeffectIdを選ぶ。
生のエンジンeffect、任意のvalue/pointCost/target/statusを入力へ混ぜるとerrorsになる。

## 選択データ

```js
const aSkill = {
  triggerId: "gte:3",
  effects: [
    { effectId: "damage-enemy", amountOptionId: "test-amount" },
    { effectId: "cancel-self-attack" },
  ],
};
```

`test-amount` はテスト専用の仮ID。本番で選べる数量候補はまだ空。
数量を伴う効果では、その効果のamountOptionsに登録したIDだけを指定できる。
候補は `{ id, label, value, pointCost }`。数量不要のキャンセル等はeffect.pointCostを使う。
本番価格はすべてnull。無料に決めた場合のみ明示的に0を設定する。
同じ効果を何件でも列挙でき、重複排除せず価格・還元を各件分加算する。

## 条件と出目専用効果

固定条件は0と元の素体出目。範囲条件のbaseFacesには0を含めない。
範囲価格は素体の非0出目の対象種類数が1/2/3なら0/1/2pt、全出目は2pt。
`baseFaces` は作成時の価格算定・表示用で、将来の戦闘で発動できる全出目の固定リストではない。
将来compilerはkind/valueの意味を変換し、lte/gteで0を除外する必要がある。
lightのgte:3にDで追加された5/6も発動対象になる意図は維持するが、今回戦闘処理は実装しない。

専用効果は常に一覧に存在する。exactFaceと同じ固定条件でのみselectable:true。
範囲・all・他出目では `reason: { code, message, requiredFace? }` を返す。
選択可能でも数量・価格が未確定なら計算は完了しない。
出目6の反動と出目4の反撃は別の効果。出目2の攻撃回数減少は2→1専用。
将来のcompilerに未対応の意味も含むため、カタログ登録は戦闘実装済みを意味しない。

## 見積結果

使用可能なダイス由来資源はcalculateBuildResources(build, rules).dice.remainingを利用する。
ステータス資源や旧仮設定aUpgradeDicePointCostはA計算へ流用しない。
例えばlight、ダイス `[0,0,0,1,1,1]` は3pt獲得・3個積み1pt消費で使用可能2pt。
上の選択にテスト専用のダメージ価格3pt・攻撃キャンセル価格0ptを設定した場合：

```js
{
  availableDicePoints: 2,
  triggerCost: 1,
  effectCost: 3,
  drawbackPoints: 1,
  grossCost: 4,
  netCost: 3,
  remaining: -1,
  knownEffectCost: 3,
  knownDrawbackPoints: 1,
  complete: true,
  errors: [],
  unresolved: []
}
```

completeは計算完了だけを表す。負のremainingでもtrueであり、保存可能を意味しない。
ビルド全体の合法性もここでは検証しない。入力選択の不正をerrors、価格未確定・数量未選択をunresolvedで返す。
未確定を含む合計はnull、判明済みの小計はknownEffectCost/knownDrawbackPointsで確認できる。
不正な選択があれば最終合計grossCost/netCost/remainingはnullになる。
運営価格の負数・非数値・無限値や計算のオーバーフローは設定ミスとして例外。

## 未確定事項

効果量候補、効果別価格、デメリット総還元上限は未確定。
maxDrawbackPointsはnullの拡張口のみで、現在は上限処理を行わない。
各デメリット定義のdrawbackPointsは現在1で、個別に変更可能。
将来追加する倍率・確率・ランダム状態・状態解除・DF操作などは公開カタログに含めない。

## 検証

`node --test tests/*.test.mjs`（追加依存なし）。
tests/aSkill.test.mjsの数量・価格fixtureはゲーム仕様ではない。
