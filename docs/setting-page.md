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

未設定に戻すと各selectionはnull。未入力stats、空効果、必要option未選択は未完成として確認後に保存できます。
ポイント不足・不適合な出目・未知IDなどの不正設定は、このページからは保存できません。
各sectionは「完成／未完成／不正」を表示。不正は入力直後から赤色で表示します。
SP／A条件／B条件変更では選択を自動修正せず、使用不可の現在値とエラーを表示します。
B種類・効果の変更は対応する入力項目を初期化します。C構造変更・分岐から特殊Cへの変更では、
効果がある場合に確認して空の構造へ切り替えます。ポイント超過による自動削除はありません。

emptyは空画面を返すだけで保存しません。corrupt／unsupported-version／storage-errorでは
編集を開始せず説明を表示します。save失敗時も編集内容を維持してエラーを表示します。
storage adapterによる既存の上書き防止を維持。自動復旧・削除は行いません。
保存前に離れる場合はブラウザの未保存確認を使用します。

## 保存inspection

`js/buildSaveInspection.js` の `inspectBuildForSave(build)` はBattlerと全Duckを検査し、
`{ canSave, complete, invalid, incomplete }` を返すpure helperです。
issueは `duckId / ownerName / section / code / path / message` を持ちます。
空のDuck名は `アヒル N` と表示し、名前の空欄自体は問題にしません。Duckが0件なら未完成です。

production compiler/resourcesのissue codeと、対応する入力が空かどうかを照合して分類します。
数値・コスト・組合せはproduction定義を参照。Bの部分入力もcatalog内の候補と照合し、
他に未入力があっても未知ID・不要field等を隠しません。Cの空branchは未完成、壊れたbranchは不正です。

`saveSectionSummary(inspection, section, duckId?)` は同じ結果から画面badgeを生成します。
`saveInspectedBuild(state, repository, { approveIncomplete }?)` が保存直前にも再検査し、
不正なら `invalid`、未承認の未完成なら `confirmation-required` を返してstorageを呼びません。
完成は直ちに保存、未完成はdialogの「このまま保存」からのみ保存。不正は無効風ボタン
（aria-disabled/class、disabled属性なし）から理由一覧を表示し、強行保存の選択肢はありません。
dirtyをfalseにするのはstorage保存成功時のみです。取消・不正・storage失敗では維持します。

inspection結果はstate.buildへ書き込まず、保存schema v1・storageの構造保存責務は変更しません。
storageそのものは引き続きゲームルール違反のdraftも扱えます。戦闘開始への接続はありません。

## 確認

`node --test tests/buildSaveInspection.test.mjs tests/settingState.test.mjs tests/playerBuild.test.mjs tests/devServer.test.mjs`

stateテスト：empty/異常、5件追加、切替、複製・削除、SP対応、不正dice保持、HP、
A/B/C/Dのv1保存・復元、null、C構造、未完成selection。
配信テストはsetting.htmlからのJS/CSS依存も確認します。
inspectionテストは完成・未入力・各カテゴリのルール違反・未知ID・壊れたDTO・全Duck検査、
承認前の書込み防止・dirty維持・承認後のv1 round-tripも確認します。
