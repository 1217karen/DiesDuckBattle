# オンライン保存層と戦闘・表示設定の画面接続

## Presentation v6（現行）

Battler共通セリフは `presentation.battler.quotes`、Duck固有A/Cは
`presentation.ducks[id].quotes.skill.A/C` に保存する。Duck DTOでは既存の
`ducks.presentation.icon` 内に画像・profile・quotesをまとめる。追加列は不要。

v1〜v5は元の形をstrict検証してから、旧Battler A/Cをbuild Duck（表示未登録も含む）と
既存detached Duckへ独立コピーする。読み込みはDBへ書き戻さず、次回保存でv6になる。
新規Duckは空A/Cを持ち、削除時にはそのDuckの表示情報全体を削除する。

戦闘snapshotの `quotes.skill.A/B/C/D` は維持し、選択DuckのA/CとBattlerのB/Dを合成する。
セリフアイコンは引き続きBattlerのデフォルト／追加枠を使用する。
公開対戦RPCは公開Duckの基本A/Cだけを既存v1投影へ合成し、他Duck・追加行・ENoを公開しない。
公開プロフィールv2とキャラ一覧はセリフを返さない。RLS・ACL・関数の実行権限は維持する。

以下は導入時の保存設計と運用履歴。

setting.html / character.htmlからオンライン保存APIへ接続済みです。既存localStorage層とそのデータは変更しません。
ブラウザの既存Supabase clientを `createOnlinePlayerStorage(client)` に渡します。publishable key＋sessionのみで動作します。
authRuntimeの `getSupabaseClient()` が、認証とオンライン編集に同じclientを渡します。
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

## 適用済みmigration

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

2026-10-01に読み取り確認した本番履歴は `20260929231111_initial_online_schema` と
`20260930223450_online_player_storage` です。いずれもrepoのtimestampとは異なります。
テーブル定義・RLS・column grantsの整合はcatalogの読み取りで確認済みです。
**本番へdb pushをそのまま実行しないでください。** 追加SQLは適用済みなので再適用しません。今回ファイル名変更・履歴修復もしていません。
この作業ではmigration apply、SQLによるデータ書き込み、Edge Function deployを実行していません。

## 競合・失敗時

revisionはopaqueな十進文字列で、保存1回につき1増加とは限りません。
古いrevisionの保存は全体拒否し、自動merge・自動retryしません。UIは編集中データを保持し、最新データを別途取得して比較します。
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

## 画面の編集状態と競合解決

`onlineEditController.js` は読込時のaccount/authUserId/revision、全体ドラフト、dirty、busy、最新比較用スナップショットをメモリ内で管理します。
`onlineEditor.js` が確認ダイアログ、比較表示、認証監視、離脱警告、成功トーストを接続します。

- 戦闘画面が変更できるのはbuild/publicSettings。表示画面はpresentation。Battler名と担当外セクションは保持します。
- 通常保存は読込時の全体DTO＋revisionで行い、古い別タブのデータはRPCが拒否します。
- 競合やsave-unknownでは保存を停止。最新データの取得はドラフトを置き換えません。
- 比較後の明示操作で最新を採用するか、この画面の担当セクション全体を最新へ引き継いで再編集できます。フィールド単位の自動マージはしません。同じセクションの変更を置き換えることを確認ダイアログで案内します。
- 引継ぎ後は最新の担当外セクションとBattler名を保持し、新revisionを基準に保存します。その間に再更新されていれば再度競合します。
- 保存成功時だけdirtyを解除し、返されたrevisionを次の保存に使用します。破棄・再読込は確認後にdirtyを解除します。
- 操作中はエディタと保存操作を無効化。古い非同期結果は世代番号で破棄します。画像検証も画面の世代番号を確認します。
- 同一ページのログアウトはauthControllerのbeforeLogoutで確認します。別タブからの認証変更・権限喪失は確認で阻止できないため、旧データを非表示・破棄して画面に理由を残します。新しい対象は手動で再読み込みします。
- フォーカス復帰時もaccessを再確認。0件／複数件／読み込み失敗／未対応形式のまま空データを編集・保存しません。
- settingのモデル検査、未完成確認、characterの画像寸法検証は既存処理を再利用します。戦闘ルール・コンパイラ・モデルschemaは変更しません。

## ユーザー本人による実環境確認

この実装の検証はモックとローカルメモリDBのみです。本番ENo.2/3の自動書き込みテストは行っていません。

1. 本人がENo.2でログインし、戦闘設定の保存対象ENo・DB名と初期データを確認する。
2. 必要なアヒルを追加し、未完成確認を含む明示保存→再読み込みを試す。公開選択と、そのDuck削除後の公開解除も確認する。
3. 表示設定でURL・セリフ・アイコン枠を保存して再読み込み、戦闘設定が保持されることを確認する。
4. 同じENoを2タブで開き、一方を保存した後に他方を保存して競合表示・ドラフト保持・比較／再編集を確認する。
5. 未保存で再読込／ログアウトを試し、キャンセルで入力が残ることを確認する。
6. ログアウト→ENo.3でログインし、ENo.2の設定が混ざらないことを確認する。アカウントやsequenceをリセットしない。

## 未接続の画面と次段階

select.html、battle.html、storage.html、結果画面は今回オンラインへ接続していません。
既存ローカル版を引き続き参照するため、オンライン設定が戦闘へ自動反映される段階ではありません。
今後は対戦選択の読込・コンパイル入口を、権限とpublic Duckの公開範囲を守って接続します。
アカウント切替UI、ローカル移行、キャラ名変更、Storage upload、結果のオンライン保存は対象外です。
