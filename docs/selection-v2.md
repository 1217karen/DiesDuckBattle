# Selection v2

player buildの`schemaVersion`は2です。Battler B/D、DuckのID・名前・stats・diceFrame・dice・A/Cという責務は変えていません。

```js
{
  effectId: "grant-status",
  targetId: "enemy",
  statusId: "crack",
  options: { amount: "amount-1" },
  chanceOptionId: "100"
}
```

Aは`{ triggerId, effects }`、Bイベントは`{ type, triggerId, conditionId, effectId, targetId, statusId?, options }`、Cは`{ mode, structure }`のbranch内effectsにこの効果選択形式を使います。B traitとDは従来どおりです。効果に不要なstatus/chanceは省略します。未完成はnull・未選択ID・不足optionで表せます。

## Trusted catalogと互換境界

各`createASkillCatalog()` / `createBSkillCatalog()` / `createCSkillCatalog()`の`selectionEffects`が正規化効果一覧です。各definitionの`variants`に合法なtarget/status、追加option axes、chance可否、従来definitionを保持します。`effectSelectionFields()`がそのmetadataからUI欄を導出します。Bはtrigger/conditionでも候補を絞ります。

旧`effects`/`events`のvariant定義は価格とsemanticsの内部SSOTとして維持し、devページ・v1 opponent source互換にも使います。v2で旧variant IDを指定するとproduction inspectionが拒否します。`resolveSelection()`は合法な1 variantへ解決し、既存resource計算/compiler本体へ渡します。targetやstatusをengine effectへ自由注入する処理ではありません。

Aはdamage/heal/grant-status/remove-status等へ統合し、増減や出目固有効果は追加axisで選びます。Cも対象・状態をoption/variant名から切り離し、継続・倍率・周期・解除範囲はoptionsへ残します。Bの複合効果は既存の固定packageを維持します。HP消費APの複数package等は方式で選び、tuning数値は説明専用です。Bの合法な組合せを増やしていません。

対象・状態等が未選択でpolarityが決まらない場合、任意のvariantを仮定したコスト超過やchance違反で保存を禁止しません。未確定の最終ポイント/APはnull、未完成として扱います。未知IDや余計なaxisはこの場合もinvalidです。

## Migrationとstorage

- `migratePlayerBuild(value)` → `{ok:true,status:"migrated"|"current",build,fromVersion?}`。
- 安全に変換できない旧ID・矛盾する旧optionは`migration-required`。壊れた形式は`corrupt`、将来版は`unsupported-version`。置換buildは返しません。
- A/Bイベント/C全branchを変換し、Duck ID、順序、stats/dice、D、B traitは維持します。
- 現行key：`diesDuckBattle:player-build:v2`。存在しない場合だけ`diesDuckBattle:player-build:v1`を読みます。
- loadはメモリ上だけで明示的に移行し、`migratedFrom:1`を返します。設定画面にも移行済みで未保存であることを表示します。
- 保存ボタンでv2 keyへ書き込みます。v1 keyはバックアップとして残します。読めないv2からv1へ黙ってfallbackしたり、壊れたデータを上書きしたりしません。
- storageはゲームルールvalidatorではなく構造保存境界です。inspection/compiled結果は保存しません。

`clonePlayerBuild()`はv1/v2の構造をversion別に検査します。旧fixture・既存dev用途はv1のまま利用可能です。`inspectBuildForSave()`はv2を解決して従来のproduction判定を再利用し、`inspectBattleLoadout()` / `compileBattleLoadout()`もその境界を通ります。selectの取得・選択・戦闘フローは変更していません。表示helperのみv2に追従しています。

## Statusとbalance

`statusMetadata.js`が8状態のID・日本語名・groupの唯一の表です。`statusGroups.js`はそこから従来と同じgroup・順序を導出します。engineのstatus IDは変更しません。

ポイント、AP、還元、成功率、固定tuning、効果上限、最終engine semanticsは従来の定義・計算を使います。battleEngine/ruleEngine/effects、opponent source、base/SpaceDuckBattleは編集しません。

## 検証

`tests/selectionV2.test.mjs`で全A variant/amount/chance、全B合法イベント/status、全C option/chanceを移行前後比較し、engine出力と価格の一致を確認します。v1保護、未知version、変換不能、v2 round-trip/readiness、partialとinvalid、branch順序も検査します。既存balance/compiler・保存・設定・loadoutテストも回帰確認します。
