# DiesDuckBattle

開発版の静的HTML/JavaScriptゲームです。

## 新規登録・ログイン（auth.html）

INDEXの「新規登録・ログイン」から開きます。HTTP(S)で配信してください。
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
`auth.html`、`js/`、`css/`に加え、内部email helperの.mjsもJavaScript MIMEで配信してください。
server専用moduleはbrowserへimportしません。開発serverも内部email helper以外の
Supabase moduleを公開しません。

## 検証と現在の実環境

2026-09-30、remoteの初回migration適用履歴とregister-accountのACTIVE状態を
読み取り確認しました。今回の作業では実Supabaseへの新規登録・ログインは行っていません。
DB、Edge Function、Auth設定の変更も行っていません。

`node --test tests/*.test.mjs`：819件成功（既存784＋認証35）、0件失敗。
モックで入力、登録payload、ENoの精度、失敗文言、再送なし、ログイン、
session復元、logout、access 0/1/複数、二重送信防止、非同期応答の競合を確認しています。
開発serverの.mjs配信とserver専用module拒否も確認しています。
ブラウザでは外部通信をCSPで遮断し、SDKと登録応答をモックへ置き換えて、
登録成功、不一致エラー、ENo引き継ぎ、ログイン、再読み込み復元、logoutを確認しました。
実Auth／実Edge Functionとの結合テストは未実施です。CDN障害、実環境のAuth要件や
配信環境の設定は、本人による動作確認時に確認してください。

SETTINGオンライン保存、キャラクター一覧、ENo切り替え・リンク、recovery、
CAPTCHA／rate limit、INDEX全体の完成は未実装です。
DB・登録バックエンドの詳細は [supabase/README.md](supabase/README.md) を参照してください。
