# 初回オンラインDB骨格

このディレクトリには初回migrationと第2段階の登録Edge Functionがあります。
2026-09-30時点で、プロジェクト ibuqntqzkqnwyhzdxskn の初回migration適用履歴
（remote version: 20260929231111）と register-account のACTIVE状態を読み取り確認済みです。
4 tableとRLSの適用済み状態はユーザー確認によります。
今回の画面実装ではremote DB・Function・Auth設定を変更していません。
browser用認証clientと auth.html は追加済みです。Storage・account linkは未実装です。

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

## 第2段階：新規ゲームアカウント登録

登録バックエンドのコードを追加した第2段階ではremoteへの適用は行いませんでした。
その後、上記のとおり初回migration適用とEdge Function deployが完了しています。
今回もremote Auth user作成や設定変更は行っていません。追加migrationは不要で、
既存migration・RLS・many-to-many構造を変更していません。

### 入口とファイル構成

- `functions/register-account/index.ts`：Deno.serveの入口。server専用admin clientを生成
- `functions/register-account/deno.json` / `deno.lock`：SDK 2.117.2と依存の固定
- `functions/_shared/registration-handler.mjs`：HTTP、入力、CORS、固定エラーresponse
- `functions/_shared/registration.mjs`：登録順序とbest-effort cleanup
- `functions/_shared/internal-email.mjs`：ENoから内部emailへの依存なしES module
- `functions/_shared/admin-client.mjs`：server環境変数からadmin clientを生成
- `config.toml`：register-accountのみ `verify_jwt = false`。登録前なのでログイン不要

POST JSONの入力は `{"characterName":"名前","password":"入力したパスワード"}` です。
名前はstringかつtrim後に非空のみを検査し、trimした名前を保存します。
重複を許可し、文字数や禁止文字を新設していません。
passwordはstringかつ6文字以上（Unicodeコードポイント数）、半角英字と数字を各1文字以上含むことを確認し、trimしません。
6文字未満は400 password_too_short、英数字混合不足は400 password_alphanumeric_requiredです。
いずれも管理者client初期化・UUID生成・INSERT／ENo採番前に拒否します。追加文字や記号は禁止しません。

成功はHTTP 201、`{"ok":true,"eno":"123"}` です。
DBのbigint全域をJavaScriptで丸めないため、ENoは十進文字列で返します。
内部email、gameAccountId、authUserId、passwordは返しません。
GET等は405、非JSON Content-Typeは415、JSON不正・入力不正は400です。
Authのweak_passwordは固定文言の400、それ以外の作成失敗は段階別の固定コードと502、
環境設定等の失敗は固定コードと500です。上流APIの生エラーを返しません。

OPTIONSは204。全responseにCORSとCache-Control: no-storeを付けます。
originは `*`、methodはPOST/OPTIONS、headerはauthorization/x-client-info/apikey/content-typeです。
cookie credentialsは許可しません。production domainは固定していません。
CORSは認証やabuse対策の代わりではありません。

### 登録順序と初期データ

1. 入力検証
2. serverで内部UUIDを作りgame_accountsへINSERT。ENoを指定せずDB identityに任せる
3. `select("eno::text")` で採番結果を正確な文字列として取得
4. helperで `eno-123@auth.diesduck.invalid` のような内部emailを作る
5. `auth.admin.createUser({email, password, email_confirm:true})`
6. 作成したAuth user IDとgame account IDをgame_account_accessへINSERT
7. battlersに `presentation: {name: trim済みの名前}` をINSERT。buildはDB defaultの `{}`
8. ENoのみを成功responseへ返す

ENoは再利用せず、失敗による欠番を許容します。max(eno)+1やアプリ採番はありません。
登録直後はBattler 1件、Duck 0件、public_duck_idはNULLです。
キャラ名はlogin IDではなく、後から通常のpresentation編集で変更できます。

admin createUserを使いemail_confirm:trueで作成するため確認mailは送りません。
signUp、inviteUserByEmail、メール送信処理は呼びません。
user_metadataに権限やENoを入れず、既存のauth.uid()+game_account_accessで認可します。
内部emailは実メールではなく、ユーザー向けUIへ表示しません。
helperは秘密を含まず、将来browserから同じモジュールをimport／bundleして利用できます。
ログイン実装時も式を複製しないでください。内部emailは秘密の認証要素ではありません。

### Cleanupと運用上の限界

各作成処理がエラーを返す／例外を投げると、対象のgame_accountをDELETEし、
Auth user IDを受け取れていればAuth userもDELETEします。
DB削除でaccess/Battlerはcascadeします。DB cleanupが失敗してもAuth cleanupは試行します。
identity衝突でも新しいENoでretryせず、既存Auth userへの紐づけ／削除もしません。

accountのUUIDをINSERT前に確保するため、INSERT responseが失われた場合も
そのUUIDを使ってcleanupを試行できます。ENo自体は必ずDB採番です。
ただしAuth APIとDBは単一transactionではありません。実行プロセスの強制終了、
通信の成否不明、cleanup失敗では孤立データが残る可能性があります。
特にAuth createUserが成功してもIDを受け取れなければ安全に削除対象を特定できません。
emailで既存userを探して削除する回復処理は追加していません。
配備後は障害時ログとDB/Authの照合による管理者の確認が必要です。
成功responseの消失を含め、再送のidempotency保証も今回の範囲外です。

元の失敗段階をresponse/logに残し、cleanupのエラーで上書きしません。
ログは固定event・段階・server生成UUIDだけです。
password、キャラ名、内部email、request body、上流error message/details、
secretをログへ渡しません。logger自体の例外でもcleanupを続行します。
passwordの保存先はSupabase Authのみで、public tableやmetadataへは保存しません。

### Secretと公開範囲

Supabase提供の `SUPABASE_URL` と `SUPABASE_SECRET_KEYS` JSONの `default` を使います。
default secretがないlocal環境等では `SUPABASE_SERVICE_ROLE_KEY` へ明示的にfallbackします。
不正JSONはエラーとし、キー値をログへ出しません。ソースには秘密値を含めません。
admin clientのsession永続化・自動refresh・URL session検出は無効です。
requestのAuthorizationをadmin clientへ転送しません。
server専用モジュールをbrowserへimportしないでください。

登録のserver入口に限定してadmin操作を行い、browserへaccess INSERT権限を追加しません。
auth userとgame accountは別entityのまま、登録時はaccess 1件を作ります。
既存RLSの弱体化や、Auth設定変更はありません。
envファイルはsupabase/.gitignoreで除外します。

### 未実装

第3段階で登録UI、login UI／処理、session復元、logoutを追加しました。
SETTINGオンライン保存、account link／switch、
password recovery、CAPTCHA、rate limit、IP制限、bot対策は未実装です。
複数アカウントは禁止しません。将来のabuse対策はこの登録入口へ追加できます。
register-accountは現在remoteでACTIVEです。第3段階では再deployしていません。

### 第2段階の検証

```sh
node --test tests/registration.test.mjs
node --test tests/*.test.mjs
deno check --config supabase/functions/register-account/deno.json supabase/functions/register-account/index.ts
deno test --config supabase/functions/register-account/deno.json supabase/functions/register-account/register-account.test.ts
```

Node v24.21.0で新規31件、既存753件、計784件成功／0件失敗。
Deno 2.9.6とSupabase互換のDeno 2.1.14で型チェック成功。
固定SDKをmock fetchと組み合わせた4テストも両バージョンで成功。
lockfileはDeno 2.1.14が生成したversion 4を採用しています。
依存を更新せず確認する場合はDeno 2.1で上記コマンドに --frozen を付けてください。
Denoテストにはネットワーク権限を付けていません。
テスト用Denoはrepo外の作業用ディレクトリに置き、アプリの依存には追加していません。
入力・処理順・初期名・Duck未作成・password非加工・内部email・各段階失敗・cleanup
失敗・secret設定・HTTP/CORSを確認しています。
実際のlocal Supabase／hosted Authへの登録・ログイン結合テストは未実施です。
Functionはその後deploy済みであることを第3段階で読み取り確認しました。
初回migrationと既存ゲームJSに差分がないことはGitで確認しています。

参考：
[Auth admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser)、
[Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)、
[Edge Function認証](https://supabase.com/docs/guides/functions/auth)。

### INDEX・共通メニュー追加段階

認証フォームをINDEXオーバーレイとauth.htmlで共有し、共通メニューはアクセス関係経由で
ENoとbattlers.presentation.nameを取得します。複数ENoの自動選択やオンライン保存は行いません。
公開helper registration-password.mjsをブラウザと登録処理で共有し、6文字未満を採番前に拒否します。
既存migration・RLSは変更していません。remoteの既存FunctionはACTIVEですが、
前工程時点では6文字検証コードは未デプロイでした。実DB/Auth操作・実登録・実ログインは行っていません。
Nodeテスト835件成功、Deno 2.1.14型チェック成功、モックHTTPテスト4件成功。

### 認証画面仕上げ・登録条件統一

共有helperが長さと英数字混合を検証します。Node 851件、Deno型チェックと4件の関連テストが成功。
本番Auth設定は未確認です。Dashboardの最小長6・英字＋数字の必須文字設定を確認してください。
FunctionのデプロイとAuth設定変更は別操作です。今回Auth設定やDB migrationは変更しません。

デプロイする場合はコミット済みのregister-account/index.ts、deno.json、deno.lockと
同階層の_shared/*.mjsを送信します。entrypointはregister-account/index.ts、
import mapはregister-account/deno.jsonとし、../_shared/という相対importを維持します。
以前のDashboard配置（index.tsとその下の_shared）へそのまま貼るとパスが変わるため注意してください。
既存のverify_jwt=falseを維持し、登録入口以外のRLS・権限は変更しません。

### オンライン保存第1段階

原子的な保存RPC・競合revision用の追加migrationを作成しました。本番未適用です。
本番初回migrationのtimestamp差異に注意してください。
SQLの影響、モデル対応、権限、検証、次段階の手順は [ONLINE_STORAGE.md](ONLINE_STORAGE.md) を参照してください。
