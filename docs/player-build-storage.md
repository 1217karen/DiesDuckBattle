# Player build 保存 v1

`js/playerBuildModel.js` はDOM/storage/compilerに依存しないmodel、
`js/playerBuildStorage.js` は同期Storage adapter。旧buildValidator DTOとは独立。
後続UIはadapterの `load()` / `save(build)` を経由する。

```js
{
  schemaVersion: 1,
  battler: { bSelection: null, dSelection: null },
  ducks: [{
    id: "UUID", name: "",
    stats: { AT: null, DF: null, SP: null },
    diceFrame: null, dice: [0, 0, 0, 0, 0, 0],
    aSelection: null, cSelection: null
  }]
}
```

未保存時は `ducks: []`。Battlerは1件、Duckは可変件数。
selectionは既存A/B/C/D compilerの入力DTOをそのまま保持する。
保存するのはユーザーの選択だけで、effect・compiled skill・catalog・engine stateは保持しない。
将来は戦闘開始時に最新production catalog/compilerで変換する（今回は未接続）。

## Model API

- `createEmptyPlayerBuild()`：空model。
- `createEmptyDuck({ idFactory } = {})`：空Duck。既定は `crypto.randomUUID()`。
- `addDuck(build, duck = createEmptyDuck())`：Duckを末尾追加。
- `duplicateDuck(build, id, { idFactory } = {})`：同じ内容・名前で新IDのDuckを末尾追加。
- `updateDuck(build, id, patch)`：ID以外を更新。stats/dice/selectionは値全体の置換。
- `deleteDuck(build, id)`：指定IDだけ削除。
- `updateBattler(build, patch)`：B/D selectionを更新。
- `clonePlayerBuild(build)`：保存形式を検査して独立copyを返す。

各操作は入力を変更せず、返り値と入力間、複製Duck間でも入れ子objectを共有しない。
不明IDはRangeError、不正な形式・重複IDはTypeError。UIは必要に応じて扱う。
IDは作成/複製時のみ生成し、編集/save/loadでは変更しない。削除IDを数え直して再利用しない。
注入するidFactoryも呼出しごとに新しい一意な文字列を返すこと（テスト用固定IDの再利用は呼出し側の責務）。
既定ID生成にはWeb CryptoのrandomUUID対応環境が必要。

## Draftと保存境界

null、未入力selection `{}`、selection内の未入力ID/nullや空配列を保存できる。
検査は保存上の型・fieldだけ。AT/DF/SP合計、出目範囲・重複、ポイント、選択IDのcatalog内存在、
組合せ合法性は検査しない。保存成功は戦闘可能を意味しない。

既存DTOのfieldだけを許可し、B/C optionsはID文字列（draftではnull）のplain object。
DTOを別形式に変換しない。将来compiler DTOのfieldを追加する場合は、この保存境界とテストも追従する。
root/Battler/Duckの未知field、関数、DOM等の非plain object、循環参照、accessor、symbol、
undefined、非有限数、疎配列等は拒否し、JSON.stringifyによる黙った欠落を防ぐ。
Duckの将来の表示fieldはその導入時にschemaへ追加する。

## Storage API

```js
const repository = createPlayerBuildStorage(); // browser。ここではlocalStorageへアクセスしない
const result = repository.load();
if (result.ok) {
  const next = addDuck(result.build);
  const saved = repository.save(next); // saved.ok / saved.statusを確認する
}
// Node: createPlayerBuildStorage(memoryStorage) としてgetItem/setItemを注入。
```

固定keyは `PLAYER_BUILD_STORAGE_KEY = "diesDuckBattle:player-build:v1"`。
`load()` は `{ ok, status, build }`：

- `empty`：未保存。新しい空modelを返す。
- `loaded`：正常。毎回独立したmodelを返す。
- `corrupt`：JSON破損・形式不正。buildはnull。
- `unsupported-version`：未知の正整数version。buildはnull、schemaVersionを返す。
- `storage-error`：保存領域アクセス不可。buildはnull。

`save(build)` は `{ ok, status }`。成功は `saved`、入力形式不正は `invalid-build`。
書込み前に既存値を再読込し、`corrupt` / `unsupported-version` / `storage-error`なら
同じstatusで拒否する。quota等の書込みエラーも `storage-error`。
loadは書き込まず、異常データの自動初期化・移行・削除はしない。
異常からの復旧UI/APIは今後設計する。複数タブ間のトランザクションや競合解決は未実装。

## Test

`node --test tests/playerBuild.test.mjs`

empty/draft、4件以上、編集・複製・削除、ID、参照分離、全カテゴリのproduction DTO形状、
round-trip、破損/version/不正保存値、storage拒否・quotaをmemory storageで確認。
UI、戦闘接続、旧validator、balance、SpaceDuckBattleは変更しない。
