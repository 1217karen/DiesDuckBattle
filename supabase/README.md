# 初回オンラインDB骨格

このディレクトリはmigrationのコードのみです。remoteへの適用、Auth設定、
Storage、JS client、登録・ログイン・リンクRPCは実装していません。

## データ構造

| Table | 役割 |
| --- | --- |
| game_accounts | UUID内部IDと、1ゲームアカウントにつき1つの公開ENo。公開Duckは未設定可 |
| game_account_access | Auth userとゲームアカウントのmany-to-manyアクセス関係 |
| battlers | game_account_idをPKにした最大1体のBattler |
| ducks | UUIDで識別する複数Duckと表示順 |

auth.usersとgame_accountsは別entityです。中間tableの複合PK
(auth_user_id, game_account_id)により重複だけを禁止し、どちら側の複数紐づけも
許容します。Auth user削除はアクセス行のみを削除し、ゲームアカウントは残します。
ゲームアカウント削除はアクセス行・Battler・Ducksをcascade削除します。

ENoはbigint GENERATED ALWAYS AS IDENTITY、1開始、NO CYCLE、UNIQUE、
NOT NULL、正数CHECKです。sequenceは削除やtransaction rollbackで巻き戻りません。
欠番を埋めず、運用でもsequenceのreset/reseed、identity override、TRUNCATE RESTART IDENTITYを
行わないでください。管理者によるDDLやsequence操作まで禁止する設計ではありません。
既存ENoの変更はBEFORE UPDATE triggerで拒否します。clientにはENoの列UPDATE権限も、
sequence使用権限もありません。

公開Duckは (game_accounts.id, public_duck_id) から
ducks(game_account_id, id)への複合FKで同一account所有を保証します。
NULLは許可し、削除はNO ACTIONです。公開中Duck単体の削除時は
同一transaction内で先にpublic_duck_idをNULLにしてください。

build / presentationはNOT NULLのJSON objectだけを要求し、初期値は空objectです。
A/B/C/D、コスト、合法性、diceなどのルールをSQLには持ち込みません。
現在のplayerBuildModel.jsのDuck生成はcrypto.randomUUID()です。
既存DTOからbuildとpresentationへの変換は将来の保存処理の仕事です。

created_at / updated_atはtimestamptzです。3つの更新対象tableは共通の
set_updated_at trigger functionでstatement_timestamp()を設定します。
アクセスtableにはcreated_atのみです。両functionはSECURITY INVOKER、
空search_pathで、clientへの直接EXECUTEは取り消しています。

## RLSと列権限

4 tableすべてRLS有効。PUBLIC / anon / authenticatedの既定table権限を
取り消してから必要な権限だけを付与します。service_roleは信頼するserver専用です。

| Policy | 意味 |
| --- | --- |
| game_account_access_select_self | auth.uid()と一致する自分のアクセス行のみSELECT |
| game_accounts_select_authenticated | authenticatedがアカウント一覧をSELECT |
| game_accounts_update_access | アクセスを持つaccountのみUPDATE |
| battlers_select_authenticated | authenticatedが対戦相手のBattlerもSELECT |
| battlers_insert_access | アクセスを持つaccountにのみINSERT |
| battlers_update_access | アクセスを持つaccountのみUPDATE |
| battlers_delete_access | アクセスを持つaccountのみDELETE |
| ducks_select_access_or_public | アクセスを持つaccountの全Duck、または他accountの公開DuckのみSELECT |
| ducks_insert_access | アクセスを持つaccountにのみINSERT |
| ducks_update_access | アクセスを持つaccountのみUPDATE |
| ducks_delete_access | アクセスを持つaccountのみDELETE |

UPDATEはUSINGとWITH CHECKの両方でアクセスを検査します。
アクセス判定は中間tableと(select auth.uid())によるexistsで行い、
SECURITY DEFINERやユーザーが編集可能なJWT metadataは利用しません。
参照はaccess → auth.uid()、accounts → access、ducks → access/accountsと
なり、SELECT policyの再帰を作りません。

clientによるaccount INSERT/DELETEとaccess INSERT/UPDATE/DELETEは
権限もpolicyもありません。anon向け権限・policyもありません。
accountはpublic_duck_idのみ、Battlerはbuild/presentationのみ、
Duckはsort_order/build/presentationのみUPDATEできます。
UUID、所有account、created_at、updated_atのclient改変も許可しません。
Battler/DuckのINSERTは所有accountとデータ列（Duckはidも）のみ許可します。

## Index / constraint

- 各tableのPK（accounts.id / accessの複合PK / battlers.game_account_id / ducks.id）
- accounts.eno UNIQUE、正数CHECK、identity NOT NULL
- ducks(game_account_id, id) UNIQUE：公開Duckの所有権FK用
- access(game_account_id) index：逆方向検索とaccount削除のFK確認
- ducks(game_account_id, sort_order) 非UNIQUE index：account内の表示順検索
- auth user / game accountへのFK、公開Duckの複合FK
- Battler/Duckの各JSON列のNOT NULL + object CHECK
- sort_order NOT NULL。並べ替え途中の同順位は許可

## 検証

既存環境にSupabase CLI・PostgreSQL・Dockerが見つからなかったため、
local DBへの適用・実行によるSQL syntax/RLS検証は未実施です。
依存のインストール・Supabase設定生成は行っていません。
CLI不在のためmigrationファイルはUTC timestampで直接作成しました。
CREATE TABLE → ducksの複合UNIQUE → ALTER TABLEで公開DuckのFK追加、
の順序と、権限・policy・constraintを静的に確認しています。

tests/initial_online_schema.sqlには、所有権、アクセス偽装拒否、公開/非公開、
many-to-many、JSON、ENo、cascade、timestamp等の検証を用意しています。
これは未実行です。将来、使い捨てのローカルSupabase DBにmigrationを適用後、
psqlの接続先を明示して実行してください（remote URLや環境変数の接続先を使わない）。

```sh
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/migrations/20260929132128_initial_online_schema.sql
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/initial_online_schema.sql
```

検証fixtureはrollbackしますが、identity採番の進行は戻りません。
既存ゲームテストはNode v24.21.0で `node --test tests/*.test.mjs` を実行し、
753件成功・0件失敗でした。既存JS/UIには変更を加えていません。

参考：
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、
[PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)。
