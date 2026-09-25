# Character select

`select.html` は自分の保存済みbuildと公開相手sourceから選択し、両者のproduction compile成功後に既存engineで戦闘を実行します。baseの左右Battler、中央Duck / VS / Duck、赤青の情報欄とtrayレイアウトを維持します。

## 公開相手source

`js/opponentSource.js` の非同期API：

- `listOpponents()` → `Promise<Array<{id, name}>>`
- `getOpponent(id)` → `Promise<{id, name, build, presentation, publicDuckId} | null>`

1アカウントを1レコードとして保持し、一覧はDuckへ展開しません。現在は開発用の速攻・耐久の2アカウントです。速攻アカウントは複数Duckを持ち、先頭ではないDuckを公開します。presentationは空で、架空の画像URLは持ちません。

一覧とdetailの各取得時に `inspectBattleLoadout(build, publicDuckId).ready` を検査します。公開IDが未設定・空・削除済み、Duckのstats/A/CまたはBattlerのB/Dが不正・未完成など、loadoutがreadyでなければ一覧から除外し、detailはnullを返します。別Duckへのfallbackはありません。取得失敗はrejectです。

公開combat dataのコピーは保存しません。毎回current build + current presentation + publicDuckIdから解決し、detailは既存model helperでbuildとpresentationの独立したコピーを返します。`createDevelopmentOpponentSource(accounts)` はテストで一覧取得後の公開状態変更も検証できる小さなfixture factoryです。将来は取得元をDBへ交換できます。Supabase・新たな永続化・repository階層は追加していません。

## 選択と戦闘

1P Battlerは `SELF_BATTLER` 固定。自分のDuckだけを選択します。自分のtrayでは不正・未完成Duckも理由付きで表示し、readyだけ選択できます。

2P Battler枠からアカウントを選択すると、その `publicDuckId` のDuckが自動表示されます。2P Duck枠は読み取り専用で、選択API・イベント・trayはありません。stateは `opponent: {id, name, build, presentation, publicDuckId}` を保持し、Duck IDの別コピーを持ちません。相手切替は自分のDuck選択を保持します。

`battleStartStatus()` はP1のselectedDuckIdとP2のpublicDuckIdをproduction inspectionで再検査します。相手の公開loadoutが利用不能なら「この相手は現在対戦できません。」として開始を拒否します。`startSelectedBattle()` はさらに両者を `compileBattleLoadout()` に渡し、P2は必ず `state.opponent.publicDuckId` を使います。双方のcompile成功後に既存 `runBattle()` を実行します。Battler/Duck IDの衝突も開始エラーです。

## presentationと結果

SELECTのP2表示は選択された相手のcurrent presentationとpublicDuckIdから、Battler立ち絵と公開Duckアイコンを描画します。切替時に画像も更新し、未設定URL・読込失敗時は既存fallbackを使います。

VSクリック時にP1はplayerPresentationStorageから最新値を再取得し、P2は選択中のopponent.presentationとpublicDuckIdから `buildBattlePresentationSnapshot()` を作成します。結果保存には両者のsnapshotと既存engine eventsを使い、resultはsnapshotだけを表示します。公開設定自体をsnapshot化することはありません。

resultのヘッダーBattler/Duck、セリフ、ダイスログDuckアイコンは固定枠内で `object-fit: contain` により全体を表示します。枠サイズとレスポンシブサイズは維持します。

## 確認

開発server：`node scripts/serve-a-skill-test.mjs 4190` → `http://127.0.0.1:4190/select.html`

全テスト：`node --test tests/*.test.mjs`

公開source・state境界は `tests/opponentSource.test.mjs`、戦闘とsnapshotは `tests/selectBattle.test.mjs`、SELECT操作とpresentation接続は `tests/selectOpponentUi.test.mjs` / `tests/selectPresentation.test.mjs` で検証します。
