# B常時modifier

B1は既存の`trigger + when + effect`によるイベント反応型。
B2は戦闘状態からAT/DF補正を継続的に算出する常時modifier型である。
B2はeffectを発火せず、`fighter.buffs`へduration buffを入れない。

## canonical形式

```js
{
  id: "B_WHILE_HP",
  trigger: "passive",
  modifier: {
    kind: "conditional",
    when: { left: "self.hpPct", op: "<=", right: 0.5 },
    bonus: { AT: 2, DF: 0 }
  }
}
{
  id: "B_SCALE_AP",
  trigger: "passive",
  modifier: {
    kind: "scaled", source: "self.ap", targetStat: "AT",
    scale: 1, offset: 0, min: 0, max: 5
  }
}
```

数値は形式の例であり、価格やユーザー向けの上限の確定ではない。
`passive`は常時型の識別子で、`Triggers`には登録せず`runTrigger()`から発動しない。
既存のbSkill（単体）/bSkills（配列）のどちらにも指定できる。

実装は`js/bPassiveModifiers.js`へ分離する。
`normalizeBPassive()`が旧形式を読み替え、`evaluateBModifier()`が純粋に評価し、
`refreshPassiveBonuses()`が各fighterのruntimeと変化ログを同期する。

## conditional

`conditionEvaluator.js`の`evaluateCondition()`をそのまま利用する。
条件成立時だけ固定bonusを加え、不成立時はAT/DFとも0へ戻す。
all/any、`== != >= <= > <`の意味は共通DSLに従う。
条件成立を契機としたturn buff付与ではない。

新版builderの公開候補はturn、self/enemyのhp・hpPct・ap・status:<key>。
turn <= N（Nターン目まで）、turn >= N（Nターン目から）、turn == N（Nターン目だけ）を表現できる。
既存evaluatorのdice、attack、cooldown、phase、actionsThisTurn等のpathは変更していない。
ただしそれらを公開したわけではなく、今回の同期保証はHP/AP/status/turnの変更である。
一撃固有のctx値を使う常時条件を将来公開するなら、別途再評価契約の設計が必要になる。

canonicalは内部turn=0の初期化中には無効・無ログとし、1ターン目のAP加算後、
turnStartログ/triggerや実戦処理に入る前に初回評価する。battleStart効果の結果もそこで読む。
以後もターン更新・AP加算後に両者を評価する。0ターン目をユーザー仕様として新設しない。
旧形式は互換性のため従来どおり初期化時も評価する。

## scaled

```text
sourceValue × scale + offset
→ min～maxへclamp
→ targetStat（ATまたはDF）へ加算
```

canonicalは係数・結果を暗黙に整数化しない。負補正も表現可能。
省略時はscale=1、offset=0、min=-Infinity、max=Infinityで、エンジン上限5は設けない。
不明なsource、AT/DF以外のtargetStat、不正な係数・範囲、非有限な計算結果は補正0として扱う。
これはエンジンの防御的処理であり、将来の入力validatorを代替するものではない。

対応sourceは以下。

| source | 現在値 |
| --- | --- |
| self.ap / enemy.ap | 自分/相手のAP |
| self.status:<key> / enemy.status:<key> | 自分/相手の個別status stack。未存在は0 |
| self.statusTotal:debuff / enemy.statusTotal:debuff | 状態異常stack合計 |
| self.statusTotal:buff / enemy.statusTotal:buff | 状態強化stack合計 |

APと個別statusの読み取りは`readConditionValue()`を再利用する。
状態合計は`readModifierSource()`が`STATUS_GROUPS`の分類を参照して合計する。
scaled計算自体をcondition evaluatorには追加していない。

`js/statusGroups.js`は従来effects.jsにあった分類を共通化した唯一の分類表。
debuffはcrack / Headwind / roughWave / steam、buffはtailwind / focus / counter / clean。
同じ表からall/debuff/buffを導出し、effectsのグループ選択とclean防御判定もこれを参照する。
分類内容と既存@allの乱数選択順は変更していない。
例：crack2 + Headwind1 + steam2はdebuff合計5、tailwind2 + focus1 + counter1はbuff合計4。
未登録keyは集計へ入らない。

## 合算と状態同期

```text
基礎AT/DF + phase/turns buff合計 + B常時modifier合計
→ 既存の下限0処理
```

conditional/scaledを問わず単純加算する。同一id/sourceでも上書き・統合せず、
各Bの配列位置で状態を記録する。AT+2とAT-1はAT+1となる。
結果は`fighter.runtime.passive`に保持し、Cのturn buffやAのphase buffとは別系統。
durationのtick・消去仕様は変更しない。

戦闘状態変更後はctx.helpers.refreshPassivesを通じて両者を再評価する。
各所有者をself、その相手をenemyとして評価し直すため、受動側triggerでctx.actorが
入れ替わっていても参照は逆転しない。再評価は状態読取・runtime更新・ログだけであり、
effect実行や再帰triggerを伴わない。

| 変更経路 | 同期位置 |
| --- | --- |
| damage / heal | helpersのHP変更後。afterHealより前 |
| changeValue hp/ap / revive | 値変更後 |
| ターン進行・AP自然増加 | 両者のAP加算後、turnStartログ/trigger前 |
| 通常C・特殊CのAP消費 | 消費後、Cのeffect前（特殊Cに従来不足していた同期も追加） |
| changeStatus | stack書換え後 |
| cleanによる防御 | clean消費直後。デバフが完全に防がれる早期returnでも同期 |
| roughWave / Headwind / steam | 全消費直後 |
| tailwind / counter | stack消費直後 |
| focus | 全消費直後 |
| 出目4 | counter直接付与直後 |
| crack自然減衰 | 行動終了減衰後。荒波キャンセル経路も含む |

取得済みの一撃のAT/DFを、後から状態が変わったことで計算し直す処理は追加しない。
既存どおり実効AT/DF取得はbeforeAttackより前。同期結果は次に値を取得する処理へ反映される。
既存イベントBの発動順、when、effect、cooldown、changeAttackの処理は維持する。

## 旧入力互換

`passiveHp`はhpCondを`self.hpPct`のconditionalへ変換する。
従来の>=/<=のみ、既定op>=、bonusの整数化も維持し、旧専用evalHpCondは廃止する。

`passiveAp`はsource=self.ap、scale=1のscaledへ変換する。
apBonus.stat→targetStat、bias→offset、min/max→min/max。
従来のstat既定DF、bias既定0、範囲既定-999～999、AP/設定値の整数化を維持する。
adapterが付ける`sourceRounding: "trunc"`は旧AP整数化の互換メタデータで、builder公開項目ではない。

旧形式のための分岐はnormalize層に限定する。passiveStatus/passiveTurnのような用途別triggerは増やさない。

## ログ

conditionalはfalse→trueまたはtrue→falseのみ`passiveSkillStateChanged`を出す。
scaledはAT/DF補正値が変わった場合のみ`passiveModifierChanged`を出す。
元の値が変わってもclamp後が同じならログは出ない。
合計変化は既存`passiveBonusTotalChanged`を再利用する。

各modifierのログはskillId/name、modifierIndex、modifierKind、before/afterのAT/DF、
conditionalのactiveまたはscaledのsourceValueを含む。originSkill/groupIdはB所有者に紐付ける。
同一状態の再評価でログを重複させない。初期0→0も記録しない。
旧APにもmodifier単位の変更ログが加わるため、ログ件数そのものは旧版との一致対象ではない。

## 公開範囲・未確定事項

engine capabilityとuser-exposed capabilityを分離する。
ユーザーがsource、scale、max、targetStat、条件値、演算子、価格を任意申告する方式にはしない。
将来のcatalog / validatorが信頼済み候補と組み合わせを定義する。

バランス方針は「狭い条件ほど強い補正を許す」。turn条件の成立期間、scaledの係数・上限で
強さが変わる。AP/個別stack/debuff合計/buff合計の1単位につき+1・最大+5は当面の候補であり、
engineの固定上限でも公開済み仕様でもない。

価格、条件の狭さ評価、source/scale/max別価格、B UI、catalog/validator最終設計、
C catalog、D新版、A価格、cooldown再設計、buildCompiler全体は今回実装しない。

## 検証

`node --test tests/*.test.mjs`。
`tests/bPassiveModifiers.test.mjs`では純粋評価・効果適用・runBattle実行を組み合わせ、
両者のHP/AP/status/turn同期、全状態の消費経路、ログ抑制、重複加算、durationとの合算、
旧形式とcanonicalの戦闘結果、event型BのchangeAttack連携を検証する。
