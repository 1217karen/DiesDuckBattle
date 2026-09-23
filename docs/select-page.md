# Character select（第1段階）

`select.html` を開き、中央の1P DUCKから保存済みDuckを選択します。未選択で開始し、選択状態はページ内だけに保持します。reload時はstorageを再読込します。

baseのselect.html / css/select.css / js/select.jsを参照し、左右のBattler枠、中央のDuck / 爆発型VS / Duck、大きなタイトル、赤い1P・青い2Pの下部情報欄、下から開くtrayを維持しています。画像はCSSのplaceholderで、外部画像・フォントに依存しません。

- `js/selectState.js`：pureなstate、Duck一覧、選択、catalog由来の表示文。暫定の自分metadataは`SELF_BATTLER`へ集約。将来は`createSelectState(loadResult, metadata)`へ注入できます。
- `js/select.js`：storage adapterのloadだけを呼び、DOMへ反映。保存・履歴・戦闘実行はしません。
- `duckChoices()` / `selectOwnDuck()`：`inspectBattleLoadout()`を使います。他Duckの不正はready Duckの選択を妨げません。未完成・使用不可のDuckも一覧に残し、理由は開閉できます。
- 2Pは相手データ未接続。`battleStartStatus()`は常に開始不可で、VSはdisabledです。
- storage異常は理由を表示し、初期化や書き込みをしません。0 Duckでは設定ページへの案内を表示します。

開発server：`node scripts/serve-a-skill-test.mjs 4190` → `http://127.0.0.1:4190/select.html`

テスト：`node --test tests/selectState.test.mjs tests/devServer.test.mjs tests/battleLoadoutCompiler.test.mjs`
