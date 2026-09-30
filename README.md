# DiesDuckBattle

開発版の静的HTML/JavaScriptゲームです。

## 新規登録・ログイン（auth.html）

INDEXの「ログイン」「新規登録」で共通フォームのオーバーレイを開きます。
`auth.html` は単独でも利用できます。閉じるボタン／Escで閉じ、元のボタンへフォーカスを戻します。HTTP(S)で配信してください。
ローカル確認には `node scripts/serve-a-skill-test.mjs` を起動し、
`http://127.0.0.1:4173/auth.html` を開けます。
この通常ページは実プロジェクトへ接続します。テストアカウントを作らず、
最初の実登録はユーザー本人が行ってください。

- 新規登録：キャラ名、パスワード、確認用パスワードを入力します。
  確認用passwordは送信せず、Edge FunctionへcharacterName/passwordのみPOSTします。
- 成功時のENoは十進文字列のまま大きく表示します。コピー／ログイン欄への引き継ぎができます。
  ENoとパスワードを控えてください。自動ログインはしません。
- ログイン：ENo＋パスワードでSupabase Authへログインします。
  内部email変換は既存の `supabase/functions/_shared/internal-email.mjs` を直接再利用します。
- sessionはSDKが保存・復元します。アクセス関係から現在のENoを取得します。
  Auth user IDとgame account IDは別物です。
- アクセス0件は異常状態、1件は現在のENo、複数件は一覧と未実装案内を表示します。
  複数件から書き込み先を自動選択しません。
- ログアウトはこのブラウザのsessionを終了します（signOutのscope: local）。

passwordはURL・localStorage・sessionStorage・アプリログ・エラーメッセージへ書き込みません。
フォーム送信時・切り替え時等に入力欄を空にします。
SDKのsession token等は専用storage key `diesduck-auth-session` に保存されます。
既存オフラインデータの保存キーは触らず、DBへのアップロード／削除もしません。

登録の通信失敗や応答解析失敗は、成功responseだけ失われた可能性があるため、
「登録結果を確認できませんでした」と案内し、自動再送しません。
再登録で別ENoが発行される可能性があります。
入力不正、Authのpassword要件違反、固定コードのserver失敗を区別します。
ログイン失敗はENoの存在有無を示さない共通メッセージです。
上流APIの生エラーや内部emailは表示しません。

## 公開接続設定

`js/supabasePublicConfig.js` がURLとpublishable keyの唯一の設定箇所です。

- project：`ibuqntqzkqnwyhzdxskn`
- URL：`https://ibuqntqzkqnwyhzdxskn.supabase.co`
- 有効なdefault publishable keyを読み取り取得して設定済み
- service-role／secret keyは禁止。開発・本番で変更する場合もこの設定を更新する

SDKは `https://esm.sh/@supabase/supabase-js@2.117.2?bundle` から
固定バージョンのbrowser ESMとして読み込みます。ビルド工程はありません。
CDNへ接続できない場合はフォームを有効化せず、読み込み失敗を表示します。
`auth.html`、`js/`、`css/`に加え、内部email／password長検証helperの.mjsもJavaScript MIMEで配信してください。
server専用moduleはbrowserへimportしません。開発serverも公開用の上記2 helper以外の
Supabase moduleを公開しません。

## 検証と現在の実環境

2026-09-30、remoteの初回migration適用履歴とregister-accountのACTIVE状態を
読み取り確認しました。今回の作業では実Supabaseへの新規登録・ログインは行っていません。
DB、Edge Function、Auth設定の変更も行っていません。

`node --test tests/*.test.mjs`：851件成功、0件失敗。
モックで入力、登録payload、ENoの精度、失敗文言、再送なし、ログイン、
session復元、logout、access 0/1/複数、二重送信防止、非同期応答の競合を確認しています。
開発serverの.mjs配信とserver専用module拒否も確認しています。
ブラウザでは外部通信をCSPで遮断し、SDKと登録応答をモックへ置き換えて、
登録成功、不一致エラー、ENo引き継ぎ、ログイン、再読み込み復元、logoutを確認しました。
実Auth／実Edge Functionとの結合テストは未実施です。CDN障害、実環境のAuth要件や
配信環境の設定は、本人による動作確認時に確認してください。

SETTINGオンライン保存、キャラクター一覧、ENo切り替え・リンク、recovery、
CAPTCHA／rate limitは未実装です。
DB・登録バックエンドの詳細は [supabase/README.md](supabase/README.md) を参照してください。

## 共通メニューとINDEX

result以外のindex/auth/select/setting/character/storageに共通メニューを設置しました。
セッション確認中はログイン前後のメニューを表示せず、確認後に切り替えます。
閉じた状態でもENoとDBのbattlers.presentation.nameを表示します。取得失敗時にローカル名は使用しません。
複数アクセス時はENo一覧を表示し、先頭アカウントを選択しません。
未ログイン時はキャラクター選択・戦闘設定・表示設定・ログアウトを非表示にします。
これはURL直打ち制限ではありません。ルールブック／キャラリストはリンクのない未実装表示です。

登録passwordは6文字以上（Unicodeコードポイント数）、半角英字A-Z/a-zと数字0-9を各1文字以上、確認用一致を送信前に検証します。
記号・追加文字は禁止せず、大文字小文字の両方や記号は必須にしません。空白はtrimしません。
Edge Function側も同じhelperで管理者client初期化・UUID生成・INSERT／ENo採番前に検証します。
DB／Auth設定はこのコード更新では変更しません。Function本番反映は別のデプロイ操作が必要です。
Node 851件、Deno 2.1.14の型チェックとモック4件が成功しています。
実アカウントでの登録・ログイン結合テストは今回も未実施です。

今回のモックブラウザ検証では390px幅のSELECT／INDEXオーバーレイ、Escとフォーカス復帰、
DB名表示、再読み込み復元、ログアウト後のメニュー切り替えを確認しました。

### 認証画面の仕上げ

登録成功時はENoパネルを維持します。ログイン失敗時にも消しません。
ログイン成功時は登録ENoとコピー・引き継ぎ用の状態を消去し、INDEXのオーバーレイだけ自動で閉じます。
閉じた後はログイン中ステータスへフォーカスを移します。auth.html単独利用も可能です。
6文字未満はpassword_too_short、英数字混合不足はpassword_alphanumeric_requiredで案内します。
Auth側の拒否とcleanup処理は従来どおりです。

Auth本体の本番設定値はこの作業環境では未確認です。DashboardのAuthentication設定で、
Minimum password lengthを6、Required charactersを英字＋数字（大文字小文字両方／記号必須ではない選択肢）に合わせてください。
コードをデプロイしてもAuth設定は更新されません。
本人による確認はENo.2でログイン→ENo・DB名→再読み込み復元→ログアウトして2ボタン表示、
続いてENo.3で同じ順に行ってください。今回の自動テストはモックのみで、実登録は行いません。

## オンライン保存層（画面未接続）

`js/onlinePlayerDto.js` / `js/onlinePlayerStorage.js` に、アカウント別の保存・復元層を追加しました。
原子的なRPCとrevision競合検出には追加migrationが必要です。**本番未適用**です。
setting/characterの保存先は従来どおりで、既存ローカルデータは変更しません。
ログイン・ログアウト成功は共通トーストへ移し、エラーは自動消去しません。
SQLの影響、DTO対応、使い方、次段階の作業は [オンライン保存設計](supabase/ONLINE_STORAGE.md) を参照してください。
