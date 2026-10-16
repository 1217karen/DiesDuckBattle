# プロフィール紹介文

`profile.html` の FAVORITE BATTLE とPL名の間に、初期状態で閉じた「紹介文（件数）」を表示します。0件・読込失敗は紹介文欄だけに表示し、プロフィール本体の表示を妨げません。

## 操作・表示

- ログイン中の選択アカウントから、他人のプロフィールに1件投稿できます。自分自身・未ログインの場合は閲覧のみです。
- 本文は装飾タグ込みUnicodeコードポイント500文字まで。既存の装飾ツール・安全なレンダラーを使用します。
- 投稿者のデフォルト／追加10枠からアイコンを選択し、枠番号だけを保存します。表示時には投稿者の現在の画像URLを参照し、未登録・読込失敗時にはデフォルト／固定画像へ戻します。
- 任意のHTTP(S)画像URLを1つ設定できます。既存カットイン検証を再利用し、読込不能・480×480px超過時は保存できません。小さい画像の警告は保存可能です。表示時は縦横比を保持し、最大480×480px・画面幅以内に収めます。
- カードには投稿者の現在の背景・パネル・文字・アクセント色を適用し、閲覧先のプロフィール全体の色は変更しません。
- 保存前に確認ダイアログを表示します。既存本文を空白・改行・対応装飾タグだけにした場合は削除確認に切り替え、アイコン・画像URLにかかわらず削除します。新規白紙は保存不可です。
- 確認のキャンセル・Escapeでは編集中の内容を維持します。編集欄のキャンセルでは保存せず表示に戻ります。ダイアログのフォーカスはキャンセルボタンから開始し、閉じると元の操作へ戻します。
- 未保存の変更や保存中の離脱を保護し、既存のアカウント変更ガードを使用します。固定アカウントclientでセッションと投稿者を再検証し、切り替え後の古い編集権限では保存しません。認証復元処理自体は変更しません。

## データと公開境界

追加migration：`supabase/migrations/20261016095831_profile_introductions.sql`（Supabase CLIで生成）。

- `diesduck_private.profile_introductions` に投稿者・紹介先の内部UUID、本文、アイコン枠、画像URL、作成・更新日時、revisionを保存します。
- 投稿者＋紹介先を一意にし、自己投稿・500文字超過・実質白紙レコード・不正な枠／画像URLをDBでも拒否します。
- 両アカウントへのFKは `ON DELETE CASCADE`。RLSを有効にし、クライアントへのテーブル権限は付与しません。
- `list_profile_introductions(uuid)` は未ログインでも実行できます。本文と必要な投稿者公開情報だけを返し、Presentation全体・非公開設定・他のアイコン枠は返しません。
- `save_profile_introduction(...)` はログイン必須。`auth.uid()` と `game_account_access` の組み合わせで投稿者を検証し、該当アクセスをトランザクション終了までロックします。publicはinvokerラッパー、権限が必要な実体は非公開schemaのdefiner関数とし、search_pathを空に固定しています。
- 新規投稿はINSERT、編集は同じIDのUPDATE、白紙はDELETEです。編集では `created_at` を変更しません。表示順は `created_at ASC, id ASC`。削除後の再投稿は新しいID・日時になります。
- ID＋revisionで競合を検出し、別画面の更新・削除・再投稿を古い編集内容で上書きしません。競合・不明な保存結果は自動再送せず、内容を維持して再読込を案内します。

## 適用方法（本番未適用）

この作業では本番DBを変更していません。既存 `supabase/README.md` に記載のとおり、本番とローカルで過去のmigration番号が異なる可能性があります。

1. 対象プロジェクトと適用済み履歴を確認し、既存のprivate schema・アカウントテーブル・権限が適用済みであることを確認します。`diesduck_private` をData APIの公開schemaに追加しないでください。
2. ステージング／バックアップを用意したうえで、上記SQLファイル全体をSupabase SQL Editorで1回実行します。SQLにはBEGIN/COMMITとPostgRESTのschemaキャッシュ更新通知を含みます。既存migrationを再適用しないでください。
3. 履歴が正しく揃ったCLI運用環境では、`supabase migration list --linked` と `supabase db push --linked --dry-run` で対象を確認し、今回のmigrationだけが適用対象になる場合に限り、運用者が `supabase db push --linked` を実行する方法もあります。番号の不一致を `--include-all` で強行しないでください。
4. 未ログインで一覧を取得できること、ログインして他人に投稿・編集・削除できること、本人プロフィールに投稿ボタンがないことを確認します。

フロントだけ先に配信された場合は、紹介文欄にDB準備未完了の案内が出ます。プロフィール本体は引き続き表示されます。

## 検証

追加テスト：`tests/profileIntroduction.test.mjs`、`tests/profileIntroductionDatabase.test.mjs`、`tests/profileIntroductionBrowser.test.mjs`。既存 `tests/profilePage.test.mjs` にも紹介文の障害分離テストを追加しています。

使い捨てPGliteに全migrationを適用し、anon／authenticatedの実権限、自己投稿・投稿者偽装・直接テーブル操作の拒否、一意性、文字数・白紙判定、編集順維持、競合、削除・再投稿、最新カラー／アイコン投影、両側の削除連鎖を確認しました。

Chromiumでは装飾・不正HTMLの無害化、画像サイズ／読込エラー、アイコン復元、確認ダイアログとEscape、キャンセル、未保存変更・アカウント切り替え保護、PC・390px・320px表示を検証しました。既存の実Supabase SDK認証復元テストも実行しています。

全体テストの結果と既存失敗の一覧は下記に記録します。本番DB・本番ブラウザーからの疎通試験と、接続先DBのadvisorsは未実施です。外部画像の内容・寸法はURL先で後から変更され得ますが、表示側でも最大寸法を制限します。

## 追加・変更ファイル

- `js/profileIntroductions.js`：折りたたみ一覧・カード・編集欄・確認ダイアログ・各種ガード。
- `js/profileIntroductionController.js`：表示／編集状態、保存確認、削除、競合・セッション変更時の停止。
- `js/profileIntroductionService.js`：紹介文専用RPC、公開DTO検証、保存前後の投稿者確認。
- `js/profilePage.js`：既存プロフィール表示後に紹介文を独立してマウント。
- `js/accountScopedClient.js`：紹介文RPCの許可と投稿者UUIDのスコープチェックだけを追加。
- `css/profile.css`：紹介文カード・編集欄・スマホ表示。
- `supabase/migrations/20261016095831_profile_introductions.sql`：専用テーブル・制約・インデックス・読み書きRPC・最小権限。
- `tests/profileIntroduction.test.mjs`：状態遷移・サービス・実アカウントスコープのテスト。
- `tests/profileIntroductionDatabase.test.mjs`：実SQL／権限／削除連鎖のテスト。
- `tests/profileIntroductionBrowser.test.mjs`：実ブラウザー操作・画像・装飾・表示・ガードのテスト。
- `tests/profilePage.test.mjs`：紹介文マウントと失敗時のプロフィール継続表示。
- `docs/profile-introductions.md`：仕様・変更内容・適用手順・検証結果。

既存の戦闘・スキル・認証復元・アカウント管理の仕様は変更していません。

### 全体テスト結果

最終コマンド（依存パスは検証環境の作業用ディレクトリを指定）：

```sh
PGLITE_MODULE=... PLAYWRIGHT_MODULE=... BROWSER_EXECUTABLE=/usr/bin/chromium \
SUPABASE_SDK_BUNDLE=... node --test --test-concurrency=2 tests/*.test.mjs
```

2,419件中2,407件成功、12件失敗、スキップ0件。紹介文の追加テストとプロフィール連携テストはすべて成功しました。PGliteには全migrationを適用して検証しています。

11件は変更前 `main`（`4c59676`）の全体テストでも同じ箇所で失敗しました。今回の範囲外なので変更していません。

| テスト | 既存の不一致 |
| --- | --- |
| `aSkillSettingUi.test.mjs` | コスト超過文言（1件） |
| `buildSaveInspection.test.mjs` | コスト超過文言（1件） |
| `characterList.test.mjs` | カード文言（1件） |
| `commonPage.test.mjs` | 既存レイアウトの期待値（1件） |
| `resultAura.test.mjs` | ターン効果ログの期待値（3件） |
| `resultLogRestoration.test.mjs` | 既存ログ文言・区切り・表示順の期待値（3件） |
| `rulebook.test.mjs` | 目次順の期待値（1件） |

残り1件は `accountPageResumeBrowser.test.mjs:124` の別タブでのアカウント選択後の画面遷移待ちタイムアウトです。変更後の先行全体テストでは成功、最終全体テストとその後の単独再検証ではタイムアウトしました。変更前mainの全体テストと単独実行では成功しています。紹介文の機能テストではなく、認証復元処理も今回変更していませんが、この結果の不安定さは未解決として記録します。

既存の実Supabase SDKを使う `accountSdkResumeBrowser.test.mjs` は、固定バージョンのSDKをバンドルして実行し成功しました。最初の依存なし実行でスキップされていたDB／ブラウザーテストは、依存を用意した最終実行ではすべて実行しています。本番接続の試験は行っていません。
