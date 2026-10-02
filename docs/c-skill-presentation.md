# Cスキルの文章と設定UI

`js/cSkillPresentation.js` の `presentCSkill(selection, options?)` はDOM非依存の正式文章APIです。
戻り値は `{ complete, text, requiredAP, branches, issues }`。未完成・不正・廃止済みの選択は `text: null` とし、入力を変更しません。
`requiredAP` は `calculateCSkillResources()` の結果を使用します。`options` には既存の trusted catalog / rules を渡せます。

発動方式、分岐、枝内の効果順を保持し、先頭の `〈AP…〉`、枝番号、全角 `＋` を生成します。
`cEffectParts()` の文章トークンと `cFieldOptionText()` を正式文章と設定UIで共有します。
設定UIでは効果種別を先に選び、文章中の複数候補のみselectにします。未選択・不正な固定値は明示的な設定操作を要求します。重複プレビューは設けません。

## 今回の公開効果整理

- 回復は確定発動。保存済みの成功率は使用不可として保持。
- 旧指定状態／グループ全解除を廃止し、ランダムな付与中状態の1解除を3回行う `removeRandomStatusStack` に変更。option AP差分は0。
- AT/DFは自分増加・相手減少のみ。方向は対象の明示編集で確定。
- オーラの状態は全合法候補から選択し、状態強化なら自分、状態異常なら相手を明示編集時に確定。内部の `addTimedHitRule` は維持。
- 既知の廃止legacy IDは移行時もそのまま保持。新効果へ置換せず、再選択するまで検証エラー。

`effects.js`、`battleEngine.js`、CのAP計算ロジック・数値表・分岐料金・固定ダメージ成功率割引・20％保証・復活再発動確率は変更していません。
固定ダメージの失敗量表示はcompilerと同じ `C_HP_FAILURE_MULTIPLIER` を参照します。

## 検証

`tests/cSkillPresentation.test.mjs` で全効果、分岐、AP、デメリット、成功率、切り捨て、旧保存値、実戦闘の3回個別解除を検証。
`tests/cSkillSettingUi.test.mjs` で文章構造、固定値、select、オーラの対象、特殊発動の分岐非表示、保存・再読込と使用不可値を検証。
既存Cテストと移行テストは廃止仕様の期待値だけを更新しています。
