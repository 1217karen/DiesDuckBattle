# INDEXのひとこと

新規migration: `20261008160629_index_messages.sql`。既存migrationの後に適用する。
今回の変更ではremoteへ適用していない。適用前のINDEXはひとこと欄に読込エラーを表示し、ゲームメニュー等は利用できる。

- `game_account_messages`: ゲームアカウントを主キーとする現在値1件。削除時cascade。履歴なし。
- `get_index_messages(p_eno bigint)`: `{eno, ownMessage, others}`。他人はランダム最大3件。
- `set_index_message(p_eno bigint, p_message text)`: `{eno, message}`。空白だけなら行削除。
- いずれもauthenticated専用。単一のアクセス可能アカウントのENoとの一致を検証する。
- テーブル直接アクセスは不可。private SECURITY DEFINERとpublic SECURITY INVOKER wrapperで公開範囲を限定する。
- 他人の公開項目は`eno / battlerName / defaultIconUrl / message`のみ。
- DBの`char_length`、ブラウザの`codePointLength`で60文字。ブラウザはtrim後に判定する。
- `updated_at`は内部管理専用。抽選や表示順には使わない。
- presentation・固定プロフィールメッセージ・player save_revisionとは独立。

ローカル検証（remote接続なし）:

```powershell
$env:PGLITE_MODULE='<installed @electric-sql/pglite>/dist/index.js'
node --test tests/indexMessagesDatabase.test.mjs tests/indexMessageService.test.mjs tests/indexMessagesView.test.mjs tests/indexDashboard.test.mjs tests/authPolish.test.mjs tests/commonMenu.test.mjs
```

DBテストは全migrationを一時Postgresへ適用し、ACL・60文字境界・上書き・削除・抽選・公開項目・revision非干渉を確認する。
`PGLITE_MODULE`未指定時はDBテストをskipするため、最終結果のskip件数も確認する。
