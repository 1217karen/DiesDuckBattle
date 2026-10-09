# 報告・要望掲示板

`notice.html` の「報告・要望」をSupabase RPCで取得します。「お知らせ」は引き続き `js/noticeData.js` の静的配列です。

## 適用前の状態

新規migration `20261009144805_feedback_board.sql` はローカルファイルとして追加しただけで、remoteには未適用です。既存migrationは変更していません。未適用の環境では報告・要望の取得エラーが表示されますが、静的お知らせとタブは利用できます。

migrationの適用は別作業です。適用後、運営Authユーザーを管理者が手動登録してください。アプリからの登録・昇格機能はありません。SQL例はpsql変数を使用します（実際のUUIDをソースへ保存しないでください）。

```sql
insert into diesduck_private.feedback_moderators(auth_user_id)
values (:'moderator_auth_user_id'::uuid)
on conflict do nothing;
```

運営ユーザーが返信するにはアクセス可能なgame accountも必要です。状態変更・非表示は運営Authユーザーであれば利用できます。

## 公開境界と操作

- `diesduck_private` の4テーブルはRLS有効、anon/authenticatedの直接アクセス権限なし。
- publicの関数はSECURITY INVOKERのラッパー。SECURITY DEFINER本体はprivate内、空のsearch_path、明示的なAuth/アクセスチェック、個別ACLを使用。
- 読み取りは `list_feedback_threads` / `list_feedback_replies`。公開DTOへAuth UUID、game_account_id、ENo、同意者一覧を含めません。
- 書き込みは `create_feedback_thread` / `create_feedback_reply` / `toggle_feedback_reaction` / `withdraw_feedback_thread`。ENoは入力として受け取り、game_account_accessから本人がアクセスできるaccountのみ解決します。
- 運営操作は `moderate_feedback_status` / `hide_feedback`。RPC内部の非公開運営テーブルで認可します。
- 投稿・返信の編集／削除APIはありません。取り下げでも本文・返信・同意を保持します。
- 非表示は物理削除しません。親投稿を非表示にした場合は一覧と返信取得から除外します。返信を非表示にした場合は返信一覧と返信件数から除外します。運営向け公開DTOも隠された本文を返しません。
- 同意トグル、返信作成、非表示は親投稿行をロックし競合を直列化します。同意の複合PKで1アカウント1票を保証します。
- 本文は改行保持のプレーンテキスト。JSのUnicodeコードポイント数とPostgresのchar_lengthでタイトル100、本文2000文字を検証します。
- 返信は初回展開時に取得。フィルタと並び替えは取得済み一覧で実行します。Auth変更時は保留レスポンス、権限、入力中の下書き、返信キャッシュを破棄します。

既存のAuth画面と同様、複数アカウントの選択UIはありません。単一のアクセス可能アカウントが確認できる場合に投稿UIが有効になります。RPC自体はアクセス権を検証したENoを扱えます。

## ローカル検証

```powershell
# インストール済み @electric-sql/pglite の dist/index.js の絶対パスを指定
$env:PGLITE_MODULE = '<local path>/node_modules/@electric-sql/pglite/dist/index.js'
node --test tests/feedbackDatabase.test.mjs tests/feedbackService.test.mjs tests/feedbackView.test.mjs tests/noticePage.test.mjs
```

DBテストは使い捨てのPGliteへ全migrationを順に適用し、anon/authenticated/運営のACLと状態遷移を検証します。実環境のAuth/PostgREST通信やブラウザーの描画を代替するものではありません。UIテストはDOM fixture上のイベントと非同期処理を検証します。

関数境界の参考：[Supabase Database Functions](https://supabase.com/docs/guides/database/functions)。
