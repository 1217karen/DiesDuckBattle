# Bスキル実戦確認ページ（開発専用）

リポジトリで `node scripts/serve-a-skill-test.mjs` を実行し、
`http://127.0.0.1:4173/b-skill-test.html` を開く。ポートは引数で変更できる。
A/B/Cページ上部から相互移動できる。追加依存パッケージは不要。

## 操作

1. トリガー型または特性型を選ぶ。
2. トリガー型は発動タイミング→条件→効果→必要な指定statusを選ぶ。
   特性型はcatalogのtraitを1つ選ぶ。
3. productionでは未確定値を「未確定」と表示する。selectionがvalidでも未解決なら戦闘不可。
   開発用fixtureをONにすると既存dev fixtureの仮値でcompileできる。
4. P1/P2それぞれの開始HP/AP、AT/DF/SP、固定ダイス、status 0～3、最大ターン数を設定する。
5. 回復時Bの確認には開発用回復をONにし、回復対象と量を選ぶ。
6. 「戦闘する」でログと最終snapshotを確認する。設定変更後のログは前回の結果と明示される。

例：fixture ON、トリガー型「回復時／常に／回復対象に指定強化を付与」、指定状態「集中」、
開発用回復ON・対象P2。P2開始HPを700にすると、P1がP2を回復しP1のBからP2へ集中が付与される。
満タンへの実回復0では新版afterHeal Bは発動しない。

## 接続と信頼境界

`bSkillTestPage.js` はcatalogを絞り込んでIDのみのselectionを生成する。
日本語trigger/condition/effect/trait・status・tuningの表示metadataとquery helperは `bSkillCatalog.js` に置く。
合法性をページ側へ複製しない。B候補・semantics・本番値は変更していない。

`runBSkillTestBattle(selection, { catalog, settings, rng })` は必ずcompileを再実行する。
不正・未解決selectionでは `battle: null` を返す。成功時だけcompile結果をP1のbSkillsへ載せる。
P2にはBを載せない。開発回復ONの場合だけP1に `B_DEV_HEAL` ruleを追加する。
UIのraw JSONは読み取り専用。DOMから不正IDが入ってもcompilerで拒否する。

開発開始値は両者のD battleStartで独立して設定する。AT/DF/SPはdummy DUCK.statsに設定する。
開発用回復はturn=1かつP1.actionsThisTurn=1のphaseStartのみ。両者のD初期化後に走り、
P1が全体phase2以降に行動する場合も正しい。選択BのphaseStart ruleの後に開発回復ruleを並べる。
通常のheal effectからhelpers.heal→afterHealを通り、engineや回復contextを模擬しない。

開発battleの入力範囲はHP 0～1000、AP/AT/DF 0～1000、SP 1～10、ダイス0～6、
maxTurns 1～50、回復量0～1000。最大HP1000、フィールドなし。
これらはテストページの入力制限・既定値であり、本番ゲーム仕様やBバランスではない。
ターン開始時AP加算、status消費・減衰、死亡判定などは通常engineに従う。

最終HP/AP/statusは既存battleEnd snapshotを表示する。各ログのraw JSONと戦闘全体JSONで
originSkill/groupId、実行時selection/settings/compile結果を追跡できる。

## 検証

`node --test tests/bSkillTestHarness.test.mjs tests/bSkillCompiler.test.mjs tests/devServer.test.mjs`

metadata・合法絞り込み・実戦接続・初期値・開発回復・代表event/traitと、
A/B/Cおよび依存JS/CSSの配信、whitelist外拒否を確認する。

保存・本番登録・DB・build DTO統合・本番バランス決定・ポイント制は対象外。
