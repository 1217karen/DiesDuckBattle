# アカウント削除

右上のアカウントメニューから、同意チェックと最終確認の二段階を経て削除します。削除対象はサーバーで確認した ENo・ゲームアカウント UUID・認証ユーザー UUID・バトラー名に固定します。未ログイン、特定不能、複数 ENo、共有アクセスは拒否します。

## サーバー処理

`prepare_account_deletion` は対象の確認のみを行います。`delete_own_account` はログイン中の本人、現存する Auth セッション、対象への排他的なアクセスを再検証します。親行とアクセス行をロックし、確認後にアクセス関係が変化した場合も拒否します。

既存設計と同じ公開 SECURITY INVOKER RPC → private SECURITY DEFINER 関数の構成です。管理者キーはブラウザに渡しません。公開アヒル参照を解除し、ゲームアカウントと既存 FK の配下データ（アヒル・プロフィール・スキル保管庫など）、最後に Auth ユーザーを同一トランザクションで削除します。Auth 側の削除に失敗した場合もゲームデータをロールバックします。Storage 所有オブジェクト等の追加 FK が削除を妨げる場合は、安全側で失敗します。

`battles` は更新・削除しません。参加者のスナップショットと ENo 検索は残ります。ENo シーケンスは変更しません。既存のフィードバック本文は既存 FK の SET NULL 方針を維持します。

削除成功を確認した後にローカルログアウト、表示キャッシュ破棄、トップページへの移動を行います。通信結果が不明な場合は成功扱いにも自動再送にもしません。ログアウトだけ失敗した場合は、削除 RPC を再実行せずログアウトを再試行できます。

## 本番適用（この作業では未実施）

1. 隔離された Supabase 環境で migration と実 Auth のログイン・削除・再ログイン不可を確認します。特に Auth セッション・identity・refresh token の FK と Storage 所有データを確認します。
2. 通常の migration 適用手順で `supabase/migrations/20261014161100_account_deletion.sql` を適用します。過去の migration は変更しません。
3. 今回変更したフロントエンドを公開します。Edge Function の追加・デプロイ、ブラウザ用管理者キーは不要です。
4. PC・スマホの隔離アカウントで二段階確認、キャンセル、公開一覧からの除外、戦闘履歴維持を確認します。

Auth ユーザーの削除だけでは発行済み JWT の有効期限そのものは変わりません。本 RPC は現存セッションも確認し、既存のゲームアクセスは削除されます。

## テスト

`node --test tests/accountDeletion.test.mjs tests/commonMenuInteraction.test.mjs tests/logoutNavigation.test.mjs tests/authDisplayStability.test.mjs`

DB テストは `PGLITE_MODULE` に PGlite のモジュールパスを指定し、`node --test tests/accountDeletionDatabase.test.mjs` を実行します。全 migration と隔離データを使用し、認可・ロールバック・他アカウント保護・公開一覧・戦闘履歴保持を検証します。Auth テーブルの FK はテスト用モデルであり、GoTrue の実ログイン試験ではありません。

`tests/accountDeletionBrowser.test.mjs` はローカルのモック RPC のみを利用します。`PLAYWRIGHT_MODULE` に Playwright のモジュールパス、必要なら `BROWSER_EXECUTABLE` にブラウザ実行ファイルを指定して実行します。PC とスマホ幅、二段階確認、通信失敗、二重クリック、ログアウト遷移を検証します。未設定時は明示的にスキップします。`ACCOUNT_DELETION_ARTIFACT_DIR` を指定するとスクリーンショットを保存します。

今回の環境では実ブラウザの起動・ローカルページへの接続に失敗し、このブラウザテストは未実施です。DB テストはスキップせず実行済みです。
