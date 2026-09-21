# 戦闘trigger時系列

対象はbattleEngine.jsのrunBattleとruleEngine.jsのTriggers。
triggerとログイベントは別物。triggerは該当スキルを評価する入口であり、
発動スキルがなければtrigger名のログを毎回出すわけではない。
スキル発動は既存のskillTriggeredログにtrigger名を記録する。

## 実際の順序

```text
fighter作成・フィールド選択・先攻決定
battleStartログ
初期passive再計算・rulesコンパイル
battleStart trigger（P1 → P2）

各ターン:
  turn更新、phase=0、両者のactionsThisTurn=0
  AP増加 → passive再計算 → turnStartログ
  turn cooldown減少（P1 → P2）
  turnStart trigger（P1 → P2）
  SPから行動順作成、両者のtemp.dfPlus=0

  各phase（行動者のみ。死亡による即時打ち切りはしない）:
    phase加算・行動回数加算・行動者のphase cooldown減少
    attackTimesOverride / attackTimesAdd / recoilMinusリセット
    phaseStartログ
    フィールドの熱湯ダメージ／泡回復
    phaseStart trigger
    beforeStatus trigger
    状態処理（亀裂ダメージ → 荒波判定）
    afterStatus trigger
    荒波でキャンセルなら亀裂自然減衰のみ行い次phaseへ
      ※beforeRoll/C/roll/resolve/phaseEndはいずれも通らない
    beforeRoll trigger
    現行の通常C自動発動（AP判定・消費は従来どおり）
    ダイス確定 → rollログ
    afterRoll trigger
    beforeDiceResolve trigger（A + 該当B）
    resolveDiceAndAttack全体
    afterDiceResolve trigger
    phaseEnd trigger
    亀裂自然減衰

  現行C復活系処理（P1 → P2）
  beforeTurnEnd trigger（P1 → P2）
  tickTurnEndBuffs（P1 → P2、buffTick / buffExpiredログ）
  turnEnd trigger（P1 → P2）
  judge（勝敗判定）
  turnEndログ（判定結果）
  決着ならbattleEndログ・ループ終了
最大ターン到達で未決着ならdrawのbattleEndログ
```

## 新triggerとctx

| trigger | 位置・意味 | 対象 |
| --- | --- | --- |
| beforeDiceResolve | 出目確定後、その出目の処理全体へ入る直前 | 行動者 |
| afterDiceResolve | 攻撃・出目追加効果・反動を処理した直後 | 行動者 |
| turnEnd | 両者のturnバフ残り時間処理後、勝敗判定前 | P1 → P2 |

before/afterDiceResolveはそれぞれ独立したctxを作り、diceValueに確定した出目を渡す。
共通conditionのdiceが読める。attackは特定の一撃を表さないのでnull。
通常攻撃がmiss・回避・攻撃回数0でもresolveを抜けた後にafterDiceResolveは一度発火する。
ダイスまで到達しないキャンセルではどちらも発火しない。
turnEndのctxはdiceValue/attackともnullで、turn/phaseや最新HP等が読める。
新ctxにはgetRulesも渡し、回復効果からの既存afterHeal連携を利用できる。

turnEndの効果によるHP変化は同ターンの判定に反映する。
turnEndで新たに付いたturnバフは、このターンのtickが既に完了しているため同ターンにはtickしない。
tick関数・バフの持続仕様そのものは変更しない。
ログのturnEndは従来どおり判定後で、形式も変更しない。

## 出目解決内部（既存処理を保持）

1. 出目2は基本2回、それ以外1回。override/addから最終攻撃回数を決める。
2. ターン内最初の行動はダメージ用の出目を2倍にする（条件用の出目は変えない）。
3. 各攻撃で実効AT/DF取得 → beforeAttack → ダメージ計算（出目6はDF無視）。
4. 湯気とeffectのmiss判定。ここでmissならattackMissedのみで次の攻撃へ。
5. 2/3回目行動の命中低下判定。missならafterHit → 集中処理 → attackMissed、次の攻撃へ。
6. 追風回避。回避ならafterHit → 集中処理 → attackAvoided、次の攻撃へ。
7. 命中経路: afterHit → 集中処理 → beforeTakeDamage（受動側）→ 倍率/氷風呂補正
   → 次回AT補正消費 → ダメージ適用 → afterTakeDamage（受動側）。
8. 反撃があれば消費・反撃ダメージ → afterTakeDamage（元の行動者）
   → afterDamage（反撃者）。その後、通常攻撃のafterDamage（行動者）。
9. 全攻撃後に出目1の自分AP+1、3の回復、4の反撃付与、5の敵AP-1、6の反動を処理。
   出目6の反動は既存のhadNonMissAttack判定に従う。湯気等のmissのみなら反動なし、
   追風回避や連続行動missでは反動があり得る。今回この判定は変えない。

afterHealはhelpers.healから呼ばれ、出目3やスキル回復等の途中で発火する。
既存どおり要求回復量が正数かつsourceがafterHealBonusでない場合に発火し、実回復0でも発火し得る。

## A移行とafterRoll互換性

Aのcompile先のみafterRollからbeforeDiceResolveへ移す。
旧onDiceIn/onDiceNotIn/比較条件、条件一致時だけのHeadwind判定・全消費・確率は維持。
beforeDiceResolve内のルール配列順は従来のcompile順で、AがBより先に評価される。

afterRollは「出目確定イベント」として残す。既存BのafterRollもそのまま有効。
beforeDiceResolveは「出目処理全体への入口」であり、将来この間に処理が増えても意味を分けられる。
ただし旧来同じafterRoll内でA→Bだった相対順序は、B(afterRoll)→A(beforeDiceResolve)に変わる。
BがHP/AP/Headwind等を変更する組合せや乱数を消費する組合せでは結果が変わり得る。
新しい時系列に伴う変更であり、Aが通常攻撃・出目追加効果より前である点は維持する。

## 範囲外として残した事項

duration、passiveHp/passiveAp、tempDfPlus、turnバフ処理、C発動/AP、
A作成カタログ/価格、compiler、D新版、beforeDiceEffect/afterDiceEffectは変更・追加しない。

既存のbattleStart/turnStart/beforeTurnEnd等にはmakeCtxへgetRulesを渡していない呼び出しがある。
その経路で回復効果がafterHealを呼ぶとgetRules未定義による例外になり得る。
新triggerのctxは正しくgetRulesを渡すが、既存経路全体の修正は今回の範囲に含めない。

## テスト

`node --test tests/*.test.mjs`。
tests/triggers.test.mjsではrunBattleの実ログを使って順序、全非0出目、miss/回避/キャンセル、
turnEndの勝敗への反映、回復連携を確認。旧A条件形式とHeadwindの成否・消費も確認する。
