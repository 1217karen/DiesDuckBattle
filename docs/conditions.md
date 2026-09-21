# 共通条件判定

conditionEvaluator.jsのevaluateCondition(spec, ctx)を、ruleEngineのBスキルwhenと
effectsの個別effect.whenで共有する。readConditionValue(path, ctx)は以下を参照する。

- turn / phase / dice（ctx.diceValue）
- self / enemy の hp / hpPct / ap / at / df / sp / actionsThisTurn
- self.status:<key> / enemy.status:<key>
- self.cdTurn:<key> / self.cdPhase:<key> / enemy.cdTurn:<key> / enemy.cdPhase:<key>
- attack.kind / attack.dice / attack.damage / attack.hit / attack.avoided / attack.isCounter
- self.nextAttackATPlus（既存B互換、未設定0）

selfはctx.actor、enemyはctx.enemy。at/df/spはfighterの基礎値を読み、
常時バフや今回の攻撃途中の補正は加算しない。状態/cooldownの未設定キーは0。
攻撃情報等の未設定項目、未知pathはundefined。任意のドットpathを辿る処理は追加しない。

原子条件 `{ left, op, right }`、AND `{ all: [...] }`、OR `{ any: [...] }` を維持。
null/undefined条件はtrue、空allはtrue、空anyはfalse。allとanyが両方あればallを優先する。
== / != は厳密比較、>= / <= / > / < は既存同様Number変換。
演算子省略は==、未知演算子はfalse。未知pathもundefinedのまま比較するため、
例えば未知path != 1はtrueになる点も既存互換として残す。

HP比率は有限な数値のhp/maxHPかつmaxHP>0のみ計算する。
旧BはInfinity/NaNのガードがeffectsより緩かったが、共通化ではeffectsのガードに統一した。
通常の有限数値のHP、負のHPの比率、既存スキルの比較方法は変更しない。

effect.whenは配列内の各effectを実行する直前のctxを使う。
例えば無条件の固定ダメージ30と、enemy.status:crack >= 1の固定ダメージ20を並べれば、
亀裂があるときだけ合計50になる。C本体の発動判定やAP消費はこのモジュールの責務ではない。

effectの数値量を読むreadValuePathは条件DSLではないので今回変更しない。
Aのダイス条件、trigger、passiveHp/passiveAp、C発動/AP、duration、compiler、UIも対象外。
