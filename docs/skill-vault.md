# スキル保管庫

設定画面のA/B/C/D各欄に設置。保管と削除は専用RPCで即時反映し、戦闘設定の保存処理・save_revisionを呼び出さない。読み込みは既存の `commit` → `online.edit` に限定し、選択中のアヒルのA/CまたはバトラーのB/Dと対応するskillLabelsだけを更新する。

## 構成

- `skillVaultModel.js`: 保存対象のコピー、現行の文章生成・完成判定、読み込み用パッチ。Aは `presentASelection` を使用し、ダイスや使用可能ptに依存しない。旧形式の既知の効果は既存の選択データ移行処理で編集形式に変換する。
- `skillVaultStorage.js`: 共有Supabaseクライアント、明示したauth user/game account、前後のセッション検証。
- `skillVaultController.js`: スコープ世代管理、二重送信防止、通信結果不明時の照合、同じ操作IDでの明示的な再実行。
- `skillVaultView.js`: 折り畳み、確認ダイアログ、読み込み、二段階削除。対象アヒル・ENo・ログイン・編集データ世代が変わると開いていた確認を無効化する。

## DB適用

本番未適用の新規migration: `supabase/migrations/20261014111357_skill_vault.sql`。

既存migration適用済みのDBに、このファイルを通常のデプロイ手順で適用する。今回の作業では本番DBに接続・適用していない。

`diesduck_private.skill_vault` と `skill_vault_counters` はRLS有効、PUBLIC/anon/authenticatedから直接アクセス不可。`list_skill_vault`、`store_skill_vault`、`delete_skill_vault` RPCだけをauthenticatedに公開し、全RPCで `auth.uid()` と `game_account_access` を検証する。新規保存は現行の許可された項目・ID・選択肢・分岐・効果数・競合を厳密に検証する。削除は内容を即時消去し、遅延した旧保管操作による復活を防ぐため、使用済みIDの墓標だけを残す。無名連番はアカウント・種別単位でロックし、削除後も番号を再利用しない。

選択データが正本。価格・完成文章・戦闘データは保管しない。取得時に現行ルールへ書き換えず、読み込み不能な旧選択肢には案内を表示して読み込みを無効化する。

`scripts/skill-vault-contract.mjs` は既存カタログからDBの許可項目を生成する。選択肢を変更する場合は、新しいmigrationで `skill_vault_contract()` を更新する（過去migrationや保存済み構成は書き換えない）。価格だけの変更では構成を変更せず、現行の文章生成・計算処理をそのまま利用する。

## 検証

`node --test tests/skillVault*.test.mjs tests/pageLoadGate.test.mjs`

DBテストは `PGLITE_MODULE` にPGliteの `dist/index.js` の絶対パスを設定する。未設定ならDBテストのみ明示的にスキップされる。全migrationをローカルPGliteへ適用し、所有権、未ログイン拒否、複数ENo、直接アクセス拒否、厳密な構成、連番、同名、冪等性、削除、revision非変更を確認する。

UIテストは実際のsettingPage・オンライン編集コントローラー・保管庫ビューを使用し、通信境界だけをメモリ内実装へ差し替える。ページを再構築して保管データが再取得されることも検証する。本番Supabaseや実ブラウザへの接続テストではない。
