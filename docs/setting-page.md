# 戦闘設定ページ

`setting.html` は本番catalogを使う作成・編集・保存ページ。戦闘開始機能はありません。
ローカル確認はリポジトリで `node scripts/serve-a-skill-test.mjs` を実行し、
`http://127.0.0.1:4173/setting.html` を開きます。既存devページのURLも引き続き利用できます。
ES modulesとWeb Cryptoを使うため、localhostまたはHTTPSで配信してください。

## 操作

- BATTLER SETTING：共通のB（イベント型／特性型）とD（production 8択）。
- DUCK SETTING：可変件数のタブから選択。追加・複製・削除・設定名を編集。
- STATUS：AT/DF、SPを入力。SPはdiceFramesから素体と同時更新し、HPはstatsUtilから表示。
- DICE：6枠の出目、重複制限と資源を表示。SP変更で不適合になった出目も保持。
- A：発動条件、効果の追加・削除、効果量・成功率とポイントを表示。
- C：通常／特殊、分岐なし・ランダム2/3・HP条件。分岐ごとの効果と必要APを表示。
- 「設定を保存」でBattlerと全Duckを一括保存。再読込時は先頭Duckを選択。

SpaceDuckBattleの大きなページ見出し、section divider、statGrid、設定名、
patternタブ、スキルカード、保存ボタンの配置を参考にした独立CSS。
Spaceの共通メニュー、固定3枠、storage schemaは使用しません。

## 責務

`js/settingState.js` はDOM非依存のページstateと表示用summary。
`createSettingState(loadResult)`、`changeSetting(state, action, { idFactory }?)`、
`selectedDuck(state)`、`SP_OPTIONS`、`battlerSummary`、`duckSummary`、
`cBranches`、`createCStructure` を提供します。
CRUDはplayerBuildModelへ委譲し、dirtyとselectedDuckIdは一時stateにだけ保持します。

`js/settingPage.js` はDOMとイベントを担当。入力のたびにstateを更新するので、
タブ切替で編集内容は失われません。名前の日本語入力中やAT/DFの入力中にはフォームを再生成しません。
保存は `createPlayerBuildStorage().save(state.build)`、初期読込は同adapterの `load()`。
保存schema/keyは前段階から変更なし。ページからlocalStorageを直接操作しません。

catalogの候補とcompiler/resourcesの結果を使用し、compiled skillは表示・保存しません。
ステータスの範囲はbuildRules、合計とdice資源はbuildResources、dice合法性は
A resourcesの既存検査を使います。旧buildValidator DTOへの変換は行いません。

## Draft・不適合・読込異常

未設定に戻すと各selectionはnull。未入力stats、空効果、ポイント不足や不適合な出目も保存可能です。
「設定完了」は個別セクションの状態表示であり、全体の戦闘開始可否判定ではありません。
SP／A条件／B条件変更では選択を自動修正せず、使用不可の現在値とエラーを表示します。
B種類・効果の変更は対応する入力項目を初期化します。C構造変更・分岐から特殊Cへの変更では、
効果がある場合に確認して空の構造へ切り替えます。ポイント超過による自動削除はありません。

emptyは空画面を返すだけで保存しません。corrupt／unsupported-version／storage-errorでは
編集を開始せず説明を表示します。save失敗時も編集内容を維持してエラーを表示します。
storage adapterによる既存の上書き防止を維持。自動復旧・削除は行いません。
保存前に離れる場合はブラウザの未保存確認を使用します。

## 確認

`node --test tests/settingState.test.mjs tests/playerBuild.test.mjs tests/devServer.test.mjs`

stateテスト：empty/異常、5件追加、切替、複製・削除、SP対応、不正dice保持、HP、
A/B/C/Dのv1保存・復元、null、C構造、未完成selection。
配信テストはsetting.htmlからのJS/CSS依存も確認します。
