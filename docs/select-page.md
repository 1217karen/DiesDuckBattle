# Character select

`select.html` は保存済み自分buildと相手sourceから選択し、両者のproduction compile成功後に既存engineで戦闘を実行します。baseの左右Battler、中央Duck / 爆発型VS / Duck、赤青の情報欄、下から開くtrayを維持しています。

## 相手sourceの境界

`js/opponentSource.js` の非同期API：

- `listOpponents()` → `Promise<Array<{id, name}>>`
- `getOpponent(id)` → `Promise<{id, name, build} | null>`

取得失敗はreject、見つからないIDはnullです。buildはv1 selectionモデルで、呼び出しごとに独立したobjectを返します。現在は開発用の「速攻」「耐久」2件だけです。名前とmoduleコメントで開発用と明記し、compile済みengine objectは持ちません。将来はこのmoduleだけをfetch adapterへ差し替えます。UIは待機・失敗・空一覧を扱い、閉じたtrayへの遅延応答は破棄します。

## 選択と戦闘

1Pは`SELF_BATTLER`の自分固定。1P Duckはstorage adapterからloadした自分buildのものだけです。2P Battler枠から相手を選び、2P Duck枠からその相手のDuckを選びます。相手を選び直すと2P Duckは解除します。

両側とも`inspectBattleLoadout()`でready判定します。未完成・不正も理由付きで一覧に残します。1Pのready Duck、相手、2Pのready Duckが揃うまでVSは無効です。

`js/selectBattle.js` の`startSelectedBattle(state)`は開始時に再検査し、P1/P2の双方を`compileBattleLoadout()`へ渡します。両方成功後にbuilder出力だけを`runBattle()`へ渡し、勝敗ラベルとターン数を返します。engineがIDで索引を作るため、両者のBattlerまたはDuck ID衝突は上書きせず開始エラーにします。画面はP1 WIN / P2 WIN / DRAWとターン数のみ表示します。選択変更時に古い結果表示は消去します。

storageへの書き込み、履歴保存、結果ページ、ログイン、ネットワーク取得はありません。選択と結果はページ内だけの一時情報です。

開発server：`node scripts/serve-a-skill-test.mjs 4190` → `http://127.0.0.1:4190/select.html`

テスト：`node --test tests/selectBattle.test.mjs tests/selectState.test.mjs tests/devServer.test.mjs tests/battleLoadoutCompiler.test.mjs`
