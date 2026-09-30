# オンライン保存層（第1段階）

画面への接続前の保存APIです。setting.html / character.htmlと既存localStorage層は変更していません。
ブラウザの既存Supabase clientを `createOnlinePlayerStorage(client)` に渡します。publishable key＋sessionのみで動作します。
この段階ではauthRuntimeがclientを内部保持しているため、次段階で同じclientを保存層にも渡す窓口を追加してください。
新しいclientや別のsession保存キーを作る必要はありません。

## APIとアカウント選択

```js
const storage = createOnlinePlayerStorage(client);
const loaded = await storage.load(); // accessが1件のみなら自動解決
// loaded: {ok:true, status:'loaded', account:{id,eno}, authUserId, revision, data}
// data: {build, presentation, publicSettings, battlerName}
const saved = await storage.save(loaded, editedData);
// 成功時はsavedを次の保存の基準にする。revisionは文字列で扱う。
```

毎回現在のsessionからauth userを取得し、game_account_accessでアクセスを再確認します。
0件はno-access、複数件はselection-required。将来の明示選択ではload/saveのoptionsに
`{gameAccountId: selectedId}`を両方指定します。先頭のアカウントは選びません。
保存時には読込元のauthUserIdとgame accountも一致させ、別ENoへ古いドラフトを送らないようにします。
最終的な所有確認はSQLのauth.uid()、既存RLS、公開Duckの複合FKが行います。

## DTO対応

既存schemaVersion 2のbuild、schemaVersion 1のpresentation/publicSettingsを変更しません。
モデルの構造を検証しますが、compilerやカタログの合法性判定は呼びません。未完成の選択、null、未割り当て値も保存できます。
未知バージョンや欠落する形式はエラーとし、空データに置き換えて上書きしません。

| モデル | DB |
| --- | --- |
| Battler B/D | battlers.build（schemaVersion:2付き） |
| 登録名・将来のキャラ名 | battlers.presentation.name / data.battlerName |
| Battler画像URL・10枠アイコン・全セリフとiconSlot | battlers.presentation（schemaVersion:1付き） |
| DuckのUUID・配列順 | ducks.id / sort_order（配列index） |
| Duck stats/dice/diceFrame/A/C | ducks.build（schemaVersion:2付き） |
| Duck名 | ducks.presentation.name（読み込み時はbuild.ducks[].nameへ戻す） |
| DuckアイコンURL | ducks.presentation.icon（{iconUrl}、元のmapに存在しなければnull） |
| buildに存在しないDuckの表示設定 | battlers.presentation.detachedDuckPresentation（現行表示エディタが保持する設定を欠落させない） |
| 公開Duck | game_accounts.public_duck_id |

オンラインのDuck IDはUUIDである必要があります。crypto.randomUUID()で発行済みのIDをそのまま維持します。
旧ローカル仮データの非UUID IDを新しいIDへ変換する自動移行はありません。
公開Duckを削除する保存ではpublicSettings.publicDuckIdもnullにします。残っている不正な参照は送信前に拒否します。
画像はURL文字列のみ。Storage/uploadはありません。

登録直後の `battlers.build={}`、`presentation={name:...}`、Duck 0件、公開nullだけは既知の初期形式として、
アカウント固有のDB名＋空のオンラインモデルへ変換します。読み込みだけではDBへ書き込みません。
既存ENo.2/3の状態は取得・変更・初期化していません。

## 追加migration（本番未適用）

`migrations/20260930165424_online_player_storage.sql` をSupabase CLI 2.118.0のmigration newで作成しました。

- game_accounts.save_revision bigint NOT NULL DEFAULT 0 を追加。既存行には新しい競合検出メタデータ0が見えます。
- game_accountsの更新ごとにrevisionを進めるtriggerを追加。clientへrevisionのUPDATE権限は付与しません。
- battlers/ducksの直接INSERT/UPDATE/DELETEも親をtouchし、revisionを更新します。既存updated_atも更新されます。
- load_online_player(uuid)：所有者だけの全設定を、1つのSQL snapshotで読み込みます。
- save_online_player(uuid,text,jsonb)：親行をFOR UPDATEでlockし、期待revisionを比較して全体を保存します。
- 公開参照解除→Battler upsert→Duck upsert→削除対象Duck削除→公開参照設定が1transactionです。
- 途中エラーは全体rollback。古いrevisionは40001。UUID衝突で他accountのDuckへ移し替えません。
- すべてSECURITY INVOKER、search_path固定。既存テーブル権限・RLSは維持。RPCはauthenticatedだけに公開します。
- テーブル作り直し、buildリセット、ENo再採番、sequence reset、アカウント変更はありません。

今回確認した本番migration履歴は `20260929231111_initial_online_schema` で、ローカル初回のtimestampとは異なります。
テーブル定義・RLS・column grantsの整合はcatalogの読み取りで確認済みです。
**本番へdb pushをそのまま実行しないでください。** 適用工程では履歴の対応を確認して今回の追加SQLだけを対象にします。
この作業ではmigration apply、SQLによるデータ書き込み、Edge Function deployを実行していません。

## 競合・失敗時

revisionはopaqueな十進文字列で、保存1回につき1増加とは限りません。
古いrevisionの保存は全体拒否し、自動merge・自動retryしません。次段階のUIは編集中データを保持し、最新データを別途取得して比較できるようにします。
既存の直接DMLを同時に使う場合、Postgresがdeadlockを検出することがあります。その場合もrollbackし、conflictとして再読込を促します。
RPC送信後の通信断は既にcommitされている可能性があるためsave-unknownです。再送せず、読み込みで結果を確認します。
クライアントから「失敗したのでDELETEでcleanup」は行いません。
上流のerror message/detailsは戻り値・ログへ出さず、statusと固定日本語messageだけを返します。

## 共通トースト

`showToast({kind:'success', message:'保存しました。'})` は4秒表示。
同文を重複表示せず、1件だけ表示します。hover/keyboard focus中はタイマーを停止します。
`kind:'error'`は自動で消さず、表示中のerrorをsuccessで置き換えません。最新successだけを待機させます。
role=status / aria-live=polite / aria-atomicで通知し、表示時にフォーカスを奪いません。
pagehideで破棄し、localStorage/sessionStorageに通知を書かず、次ページや再読み込みで再表示しません。
認証のログイン・ログアウト成功を接続済みです。入力エラーはフォーム、ログアウト失敗は共通メニューに残します。

## 検証

`node --test tests/*.test.mjs` で既存・モックテストを実行します。
DBテストは任意の開発用PGlite 0.5.8をrepo外へインストールし、その`dist/index.js`への絶対パスを
環境変数PGLITE_MODULEに設定すると実行されます。未設定時は理由付きskipです。アプリに依存は追加していません。
PGliteのメモリDBにSupabase相当のauth.uid()/rolesを用意して、両migrationを実行し、実際のRLS/RPC/triggerを検証します。
本番へ接続するテストではありません。真の複数接続による同時transactionは未検証ですが、古いrevisionの拒否・直接更新による無効化・途中失敗のrollbackを検証しています。

## 次段階

1. 履歴の対応とSQLをレビューし、別操作として追加migrationを適用。
2. authRuntimeの既存clientを保存層へ渡す窓口を用意し、アカウント別にload。
3. setting/characterの編集ドラフトをオンライン用に分離。成功したloadを基準に、3モデルとbattlerName全体をsave。
4. 失敗時にドラフトを失わないUI、競合時の再読込・比較、結果不明時の確認を接続。
5. 成功だけトーストへ。ローカルデータの移行・消去、アカウント切り替えUIは別工程。

検証実績：Node全883件成功／失敗0／skip0（PGLITE_MODULE指定）。PGliteの実SQL検証9件を含みます。
モックブラウザでもログイン成功のトースト表示、共通メニューに成功文言が残らないことを確認しました。
