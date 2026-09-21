# AT/DF補正の持続時間

新規effectのcanonical形式は明示的な`duration`。対象はself/enemy、statはAT/DF。

```js
{ type: "addBuff", target: "enemy", stat: "DF", amount: -2,
  duration: { kind: "phase" } }
{ type: "addBuff", target: "self", stat: "AT", amount: 2,
  duration: { kind: "turns", count: 3 } }
```

fighter.buffsでは、phaseは`duration: { kind: "phase" }`、turnsは
`duration: { kind: "turns", remainingTurns: N }`として保持する。
付与時のeffectやdurationオブジェクトを書き換えない。
旧`{ type: "addBuff", stat: "AT", amount: 2, turns: 3 }`も受け付ける。
duration省略時のみ旧turnsを参照し、省略時の既定値1も維持する。
duration指定時はそちらが優先。不明なkindや非正数・非有限のturn数は付与しない。
従来どおりamount/turn数は整数へ切り捨てる。once/flagKeyの明示的な一度限り制御も維持する。

## phase

付与先の行動phaseではなく、現在進行中のphaseの終了まで有効。

```text
出目解決 → afterDiceResolve → phaseEnd trigger
→ 両者のphase buff消去 → 行動終了の状態自然減衰 → 次phase
```

phaseEndの実行中はまだ有効で、phaseEnd内で新規付与した分も直後に消える。
荒波でphaseEndを通らない経路も、両者のphase buffを消してから次phaseへ進む。
phase外（battleStart/turnStart/turnEnd等）の付与には専用の有効期間を新設していない。
その場合も次に通るphase終了処理で消えるため、現在phase限定の用途ではphase内で付与する。

## turns:N

付与時remainingTurns=N。保持した状態でターン末の減算を通るたび1減り、0で消える。
付与時刻は考慮せず、途中で付いたturns:1も同じターン末で消える。

```text
現行C復活系処理 → beforeTurnEnd（P1/P2）
→ 両者のturn buff減算 → turnEnd trigger（P1/P2）→ 勝敗判定
```

turnEndで付けたbuffはそのターンの減算が済んでいるため、次ターン中も有効。
turns:1なら次ターンのturnEnd trigger直前の減算で消える。
既存buffAppliedログのturns（付与数）、buffTickのbefore/after、buffExpiredは維持。
buffAppliedにはdurationも記録する。phase消去のbuffExpiredにはduration.kind=phaseを付ける。

## 計算と重複

両durationとも既存sumBuffに入り、基礎AT/DF + buff合計 + 既存passive補正から
既存の下限0処理を行う。同じid/sourceでも独立して保持し、単純加算する。
自動上書き・延長・強弱選択・統合はしない。

## tempDfPlus互換

main内の全参照を調べた結果、エンジン以外に実スキルデータはなかった。
baseは読み取りのみで確認し、js/data.jsのAS15は
「出目４が出た時、この攻撃フェイズ中相手のDF-2」と明記されている。
この旧入力を壊さないためchangeValue key=tempDfPlusは互換入口として残す。
内部はlegacyKey=tempDfPlusを持つphase DF buffへ変換し、temp.dfPlus自体、
ターン開始リセット、攻撃計算への別加算は廃止した。baseのデータは編集していない。

add/set/setMin/setMaxは互換buffの合計値に対して計算し、差分を独立buffとして追加する。
通常addBuff由来のDF補正には干渉しない。valueChangedログも維持（tagはDF(phase)）。
新規データではaddBuffを使う。旧来の次ターンまでの漏れ、および負DFの別加算はなくなり、
共通の実効DF計算（下限0）に従う点は意図した変更。

## 併せて修正した不整合・範囲外

changeValueのhp/ap変更後に既存refreshPassivesを呼ぶ。
getRules定義後の全makeCtx呼び出しにgetRulesを渡し、既存triggerからのheal→afterHealを修正。
rules生成前の初期passive判定ctxだけは従来どおり（healを実行しない）。

passiveHp/passiveApの計算、whileCondition、nextAttackATPlus、condition、trigger位置、
C発動/AP、カタログ/価格/UIには変更なし。
beforeAttack以前に実効AT/DFを取得する既存の順序も維持するため、beforeAttack自身で付けた
buffは現在の一撃の取得済みAT/DFには遡及しない。これは今回変更していない。

## 検証

`node --test tests/*.test.mjs`。
tests/buffDuration.test.mjsでphase/turnsの寿命、敵対象、キャンセル、phaseEnd付与、
加算重複、旧入力、HP/passive再判定、既存triggerのheal連携を検証する。
