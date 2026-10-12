# 公開プロフィール取得 v2

`createOnlineProfileService(client).getProfile(eno)` が
`public.get_online_profile(p_eno bigint)` を呼び出す。成功時は
`{ ok: true, status: "loaded", profile }`、失敗時は `{ ok: false, status, message }`。
ページやDOMには依存しない。プロフィール描画・保存・effect text生成は担当しない。

## レスポンス

```text
profileVersion: 2 (Presentation schemaVersionとは独立)
accountId: UUID
eno: decimal string
isOwner: boolean
battler:
  name, standingImageUrl, defaultIconUrl: string
  profileIcons: [{ slot: integer 1..10, url: string }] (昇順・重複なし・最大4件)
  profile:
    text: string
    message: string (プレーンテキスト、保存時100 code point以内)
    messageTail: boolean
    theme: { background, panel, text, accent } (#RRGGBB)
  skills: { B: skill, D: skill }
duck: null | {
  id: UUID, name: string, iconUrl: string
  profile: { text, type, attributes, statLabelPreset, flavorStats }
  stats: { AT, DF, SP } (保存値のnumberまたはnull)
  skills: { A: skill, C: skill }
}
skill: { selection: null | partial selection DTO, label: { name: string, ruby: string } }
featuredBattle: null | {
  battleId: UUID, battleNo: decimal string, dateISO: timestamp, result: P1_win | P2_win | draw
  p1, p2: { eno, battlerName, duckName, battlerDefaultIconUrl, duckIconUrl }
}
```

Duck profileのenum・Unicode code point・配列長・value範囲はPresentation v2と同じ。
本文の空白・改行、色の大文字小文字は保持する。SQLでHTML化しない。
選択済み追加アイコンはURLが空でも返す。表示側で画像を省略してよい。
ENoとbattleNoはbigintの精度を保つ文字列。decoderもcanonical decimal stringを返す。

## 公開境界

- private `public_profile` は `SECURITY DEFINER`、public entrypointは `SECURITY INVOKER`。
  全functionのsearch_pathは空。entrypointとprojectionはanonとauthenticatedにEXECUTEを付与。
  private schemaはexposed schemaへ追加しない。補助functionはAPIロールにEXECUTEを付与しない。
- 認証は不要。own accountのresolve・access件数制限・本人除外はない。
  `isOwner` は対象accountと現在のauth UIDに対応するaccess行の有無。未ログイン時はfalse。
- 公開Duck未設定でもBattlerを返し、Duckはnull。設定されている場合は対象accountの公開Duck1羽だけ。
- JSONBの全体返却は行わない。スキルselection内部も既知のキー・option axesだけを公開する。
  build v2/v3をサポートし、v2のlabelは空name/ruby。合法性やbattle-ready判定はしない。
- Presentation v1はprofile初期値、v2〜v6は保存profileを投影する。v1〜v4のmessage/messageTailは空文字/falseを補う。Duckのiconがnullなら空表示情報。
  登録直後のbuild `{}` + presentation `{name}` は空画像・空profile・null selection。
  未知versionや構造破損は拒否する。公開scalar値の不正はdecoderでも拒否し、初期値に丸めない。
- Featured Battleはbattleが存在し、対象accountのfavorite行が現在存在する場合だけ返す。
  参加者であることは要求しない。未設定・削除済み・favorite解除済みならnull。
  未検証featuredBattleId、他favorite、events、loadoutは返さない。
- 保存presentationはv6。v1〜v5は厳密な元の形を照合して移行し、未知fieldは拒否する。
  public_battle_dataとlist_charactersもv6に対応する。既存table grants/RLS・書き込み関数ACLは変更しない。

## Client boundary

`decodeOnlineProfile` は固定キー、API version、UUID、ENo、profile・skill・summaryを検証する。
selection構造は既存build modelのvalidationも再利用する。未知レスポンスfieldは拒否する。
通信前後のauth identityを確認し、変更時（未ログインからログインした場合も含む）はレスポンスを採用しない。
未ログインの読み取りは正常系として扱い、本人用カラー編集UIは表示しない。

主なstatus: `invalid-eno`, `session-changed`, `profile-not-found`,
`migration-required`, `unsupported-data`, `forbidden`, `load-failed`。
RPC不存在でtable直接取得へfallbackしない。

## 検証

`tests/onlineProfileService.test.mjs` と `tests/onlineProfileDatabase.test.mjs`。
DBテストは既存と同じ `PGLITE_MODULE` を指定してローカルPostgresで実行する。
migrationファイルの作成のみで、リモート適用は別工程。

## 匿名読み取りmigration

`20261011155515_public_page_anonymous_reads.sql` は次の4 RPCと対応するprivate実装だけにanonのEXECUTEを追加する。

- `list_online_characters()`
- `get_online_profile(bigint)`
- `list_online_battle_results(integer,integer,text,bigint,text,boolean,uuid)`
- `get_online_battle_result(uuid)`

公開用projection・過去の公開戦闘snapshotの内容は維持する。非公開Duck・未選択アイコン・内部設定・認証情報は公開しない。
お気に入りの個人用照会は引き続きaccount accessを検証し、保存・編集・お気に入り変更・対戦準備の匿名実行は拒否する。
匿名の履歴初期表示はENo指定なし、本人のENoを解決できるログインではそのENoで絞り込む。
ENo未解決時は全履歴を表示してお気に入りを無効にし、複数アカウントの場合の案内は残す。

`tests/anonymousPublicDatabase.test.mjs` は権限差分が対象8関数のanon EXECUTEだけであることも検証する。
本番反映にはmigrationの別途適用が必要。
