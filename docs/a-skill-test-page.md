# A開発ページ

`node scripts/serve-a-skill-test.mjs` で起動し、http://127.0.0.1:4173/a-skill-test.html を開く。
追加依存は不要。本番保存・キャラ登録は行わない。

1. 素体と初期6枠を選ぶ。基礎3ptと共通dice資源を表示する。
2. triggerを選ぶ。rangeは0を含まない。専用effectはexact一致のみ選択可能。
3. 1～4effectを上から実行順に選ぶ。重複・相殺可能。↑↓で順序を変える。
4. 「開発用の仮効果量・仮価格を使う」をONにすると独立fixtureの数量候補が使える。
   benefitは100/50/25/10%を選べる。drawbackは100%固定。
5. ポイント内訳、frequencyCount/rank、effect/benefit/drawback数、benefitSlotCost、
   本体価格・適用chance割引・還元・net/remaining、errors/unresolvedを確認する。
   入力JSONにはselection DTOとeffect別明細を表示する。
6. compiled trusted A欄でcanonical trigger/effectとcompile拒否理由を確認する。
   不正・未確定・予算超過では戦闘ボタンを有効にしない。
7. 戦闘を実行すると選択AをP1のduck.aSkillへ設定し、実際のrunBattleを3ターン実行する。
   初期6枠を使用。P1/P2とも確認用AT3/DF3/SP1/HP1000、P2は出目1。
   ログはbattle.eventsのJSON。A発動・chance・status・通常攻撃・出目固有・反動を確認できる。
   選択を変更すると旧ログ表示を消す。乱数は毎回独立で、選んだ条件が出ない場合もある。

productionの数量・価格・還元・100%以外のchance価格補正は未確定。
fixtureのfixedDamage/heal 5/10/20、AP/status/AT/DF 1/2/3、攻撃回数+1/+2、
追加反動2/3/4/5、chance割引0/1/2/3等は開発専用でゲームバランス仕様ではない。
production catalogを書き換えたり保存したりしない。

0/6のfrequencyRankは未定義(null)。頻度による価格変更はない。
A用の初期diceは検査するが、statsや他カテゴリを含むキャラ全体の合法性は判定しない。
D追加出目・MISS・legacy互換などの決定的な確認はA対象テストで行う。

主な実装：aSkillTestPage.js（UI）、aSkillDevFixtures.js（仮値）、
aSkillTestHarness.js（compiler→battle）、aSkillCompiler.js（trusted変換）。
仕様詳細は [A作成・compile](a-skill-building.md) を参照。
