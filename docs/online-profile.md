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
  全functionのsearch_pathは空。entrypointとprojectionはauthenticatedだけにEXECUTEを付与。
  private schemaはexposed schemaへ追加しない。補助functionはAPIロールにEXECUTEを付与しない。
- `auth.uid()` が必要。own accountのresolve・access件数制限・本人除外はない。
  `isOwner` は対象accountと現在のauth UIDに対応するaccess行の有無。
- 公開Duck未設定でもBattlerを返し、Duckはnull。設定されている場合は対象accountの公開Duck1羽だけ。
- JSONBの全体返却は行わない。スキルselection内部も既知のキー・option axesだけを公開する。
  build v2/v3をサポートし、v2のlabelは空name/ruby。合法性やbattle-ready判定はしない。
- Presentation v1はprofile初期値、v2〜v5は保存profileを投影する。v1〜v4のmessage/messageTailは空文字/falseを補う。Duckのiconがnullなら空表示情報。
  登録直後のbuild `{}` + presentation `{name}` は空画像・空profile・null selection。
  未知versionや構造破損は拒否する。公開scalar値の不正はdecoderでも拒否し、初期値に丸めない。
- Featured Battleはbattleが存在し、対象accountのfavorite行が現在存在する場合だけ返す。
  参加者であることは要求しない。未設定・削除済み・favorite解除済みならnull。
  未検証featuredBattleId、他favorite、events、loadoutは返さない。
- 保存presentationはv5。v1〜v4は厳密な元の形を照合して移行し、未知fieldは拒否する。
  public_battle_dataとlist_charactersもv5に対応する。既存table grants/RLS・関数ACLは変更しない。

## Client boundary

`decodeOnlineProfile` は固定キー、API version、UUID、ENo、profile・skill・summaryを検証する。
selection構造は既存build modelのvalidationも再利用する。未知レスポンスfieldは拒否する。
通信前後のauth identityを確認し、変更時はレスポンスを採用しない。

主なstatus: `invalid-eno`, `not-signed-in`, `session-changed`, `profile-not-found`,
`migration-required`, `unsupported-data`, `forbidden`, `load-failed`。
RPC不存在でtable直接取得へfallbackしない。

## 検証

`tests/onlineProfileService.test.mjs` と `tests/onlineProfileDatabase.test.mjs`。
DBテストは既存と同じ `PGLITE_MODULE` を指定してローカルPostgresで実行する。
migrationファイルの作成のみで、リモート適用は別工程。
