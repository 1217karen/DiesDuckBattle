# 新版スキルカテゴリの責務境界

この文書は、新版のユーザー作成スキルにおけるA/B/C/Dの役割と、
各カテゴリが公開できるtrigger・effectの境界を定める設計基準である。
現在の戦闘データ形式をそのままユーザー入力形式として認めるものではない。

戦闘時系列の実装位置は[triggers.md](triggers.md)、AT/DF補正の寿命は
[buff-durations.md](buff-durations.md)、現在のA作成基盤は
[a-skill-building.md](a-skill-building.md)を参照する。

## capabilityを分ける

次の2つは別の集合として扱う。

```text
engine capability
  effects.jsが信頼済みの内部データとして実行できるeffect

user-exposed capability
  各カテゴリの作成画面で選択し、保存・compileできるeffect
```

エンジンが実行できることは、全カテゴリでユーザーへ公開する理由にならない。
既存データ互換や運営定義スキルのためにengine capabilityを維持しながら、
新版のユーザー作成範囲はカテゴリ別の信頼済み定義で限定する。

想定する責務の流れは次のとおり。

```text
カテゴリ別catalog
  公開するtrigger・effect・対象・数値候補・価格を定義
        ↓
validator
  ユーザーDTOのIDと組み合わせをcatalogに照らして検査
        ↓
compiler
  信頼済み定義からエンジン用rule/effectへ変換
        ↓
battle engine
  compile済みの内部データを実行
```

UIから選択肢を隠すだけでは境界にならない。validatorはカテゴリ、trigger、effect、
target、amount option等の組み合わせを拒否できなければならず、compilerもユーザーが
送った生のeffect、任意の数値、任意のpointCostを信用しない。

## カテゴリ概略

| Category | 主目的 | 主な発動窓 | 専用・限定機能 |
| --- | --- | --- | --- |
| A | 出目に反応して現在phaseを変化させる | `beforeDiceResolve` | 出目固有操作、通常攻撃キャンセル、phase AT/DF補正 |
| B | 条件・イベントへの反応 | 各種trigger / 将来の`whileCondition` | 条件付き常時AT/DF補正 |
| C | AP消費型の大きな能動効果 | ダイス直前 / 全行動終了後・勝敗判定前 | `turns:N` AT/DF buff |
| D | 戦闘開始時のダイス構成変更 | `battleStart` | `addDice` |

「専用・限定」は新版ユーザー作成に対する公開方針である。
`effects.js`から機能を削除することや、旧データを無効にすることを意味しない。

## A：出目解決への介入

Aは、確定した出目に反応し、そのphaseの戦闘内容を変化させるスキルである。
基本triggerは`beforeDiceResolve`とする。

```text
ダイス確定
→ afterRoll
→ beforeDiceResolve（Aの判定・発動）
→ 通常攻撃と出目固有効果の解決
```

Aは出目の確定後、その出目による処理全体へ入る前に発動する。
新版でA専用またはA中心として扱う候補は次のとおり。

- 自分の通常攻撃キャンセル
- 出目固有効果の抑制・変更
- 出目2の攻撃回数変更
- 出目6の反動変更
- その他の出目解決へ直接干渉する効果
- `duration: { kind: "phase" }`のAT/DF補正

phase補正は付与対象の次のphaseではなく、付与時点で進行中のphase終了まで有効である。
旧AS15の「出目4の時、この攻撃フェイズ中相手DF-2」はこの用途に当たる。
新版のユーザー作成Aには`duration: turns`の持続buffを公開しない。

Aでも共有候補として、小規模な固定ダメージ、HP回復、AP増減、状態異常付与、
状態強化付与、次回通常攻撃AT補正を利用できる。ただし公開する効果、値、対象、
価格、drawbackはA catalogが決める。同じeffect typeをCでも使う場合に、
AとCのamount optionや価格を共通にする必要はない。

## B：イベント反応と条件付き常時補正

Bは、戦闘中のイベントまたは状況に反応するスキルである。

### B1：イベント反応型

既存の`beforeAttack`、`beforeTakeDamage`、`afterDamage`等のtriggerでconditionを評価し、
成立した場合にeffectを実行する。

```text
trigger + condition + effect
```

例として「通常攻撃時、相手に状態異常があれば通常ダメージを1.5倍にする」は、
適切な攻撃triggerとcondition、`changeAttack`の組み合わせとして表す。

Bではtriggerごとに許可effectを限定する。たとえば`beforeAttack + changeAttack`を
許可する一方、`beforeAttack + 3ターンAT+2`のように時系列上不自然な組み合わせは、
エンジンが実行できてもcatalog / validator / compilerで生成させない。

### B2：常時modifier（conditional / scaled）

B専用機能として、`passive + modifier`の共通形式を用いる。
conditionalはconditionがtrueの間だけ固定AT/DF補正、scaledは現在値から補正量を算出する。
canonical形式・再評価・旧互換は[b-passive-modifiers.md](b-passive-modifiers.md)を参照。

```text
condition == true  → 補正有効
condition == false → 補正無効
```

これは「条件成立時にNターンbuffを付与する」処理ではない。
自分HP50%以下、自分または相手のAP、相手の状態など、共通conditionで参照できる値が
変化したときに両者を再評価する。旧`passiveHp`はconditional、旧`passiveAp`はscaledへ
互換変換する。builderの公開条件・数値・価格をここで確定するものではない。

新版のユーザー作成Bには`duration: turns`のbuffを公開しない。

## C：AP消費型の能動効果

CはAPを消費して発動する、Aより大きな固定ダメージ、回復、複合効果等を担う。
Cには現在2つの発動窓がある。新版は作成開始時にnormal/specialを選ぶ。
専用catalog・AP計算・追加engine capabilityは[c-skill-building.md](c-skill-building.md)を参照。

### 通常C：ダイス直前

```text
phase開始
→ フィールド効果
→ phaseStart trigger
→ beforeStatus trigger
→ 状態処理
→ afterStatus trigger
→ 行動キャンセル判定
→ beforeRoll trigger
→ 通常C発動判定
→ ダイス確定
```

通常Cは「phase開始直後」ではなく、フィールド・状態処理が終了した後のダイス直前に発動する。
荒波等によりダイス前に行動自体がキャンセルされた場合、通常Cは発動しない。

### 特殊C：全行動終了後・勝敗判定前

```text
そのターンの全phase終了
→ 特殊C発動判定
→ beforeTurnEnd trigger
→ turn buff減算
→ turnEnd trigger
→ 勝敗判定
```

これは漠然とした「戦闘終了前」ではなく、そのターンの全行動終了後かつ勝敗判定前の窓である。
復活等を勝敗決定より前に適用できる。新版は`mode: "special"`、旧互換はmodeなしの
`trigger: "beforeTurnEnd"`で識別し、発動判定は`beforeTurnEnd` triggerの前に行われる。
特殊Cは復活必須ではなく、HP<=0かつAP十分なら固定ダメージだけでも発動できる。

C専用のユーザー作成機能として、`duration: { kind: "turns", count: N }`のAT/DF buffを扱う。
付与時にremainingTurns=Nとなり、保持した状態でターン末の減算処理を通るたび1減り、
0で消える。付与時刻自体は考慮しない。`turnEnd` triggerで付与された場合はそのターンの
減算が済んでいるため、次のturnEndまで残る。新版のA/B/Dにはturns buffを公開しない。

Cの共有effect候補は固定ダメージ、現在HP割合固定ダメージ、固定HP回復、状態付与・全解除、
turns AT/DF補正、期限付き通常命中status付与。特殊Cだけに最大HP割合reviveを追加する。
AP操作・割合healは公開しない。基本/最低5AP、1～5effect、追加benefit枠+1APは確定し、
具体的な数値option価格と復活再抽選率は未確定とする。

## D：戦闘開始時のダイス構成変更

Dは`battleStart`に一度、ダイス構成へ干渉するスキルとする。
新版の現在案ではユーザーはDを1つ選び、たとえば自分へ任意の出目を1個追加するか、
相手へ0を1個追加する。

自分へ追加する値は初期dice frameの範囲外でもよい。lightへ5や6を追加でき、
Dの結果として同じ出目が4個になってもよい。これは初期6スロットの構築制約とは別で、
戦闘開始後のダイスプール変更として扱う。

`addDice`は新版ユーザー作成ではD専用とする。A/B/Cへは公開しない。
Dには固定ダメージ、回復、phase/turns buff等を公開せず、戦闘開始時のダイス構成変更に限定する。

## effectの共有・限定方針

effect typeそのものをカテゴリごとに重複実装する必要はない。

| 機能 | 新版ユーザー作成での扱い |
| --- | --- |
| `fixedDamage` | A/C等で共有可能。カテゴリごとに値と価格を定義 |
| `heal` | A/C等で共有可能。カテゴリごとに値と価格を定義 |
| AP操作 | Cには公開しない。他カテゴリは許可方向・対象・値を個別定義 |
| 状態異常・状態強化付与 | 複数カテゴリで共有可能。status・対象・値を個別定義 |
| 次回通常攻撃AT補正 | Aで公開可能。triggerとの整合も検査 |
| 出目固有効果操作・通常攻撃キャンセル | A専用またはA限定 |
| phase AT/DF buff | A中心。少なくともAで公開し、turnsとは分離 |
| `changeAttack` | Bの適切な攻撃trigger等、組み合わせを限定 |
| 条件付き常時AT/DF補正 | B専用 |
| turns:N AT/DF buff | C専用 |
| `addDice` | D専用 |

同じeffect typeを共有しても、数値範囲、価格、target、amount option、drawback、
利用可能triggerはカテゴリごとのcatalog定義にしてよい。

## triggerとeffectの組み合わせ

カテゴリ許可だけでは不十分である。将来の信頼済み定義は少なくとも、
「category + trigger + effect + option」の組み合わせを表現できるようにする。

`beforeAttack + changeAttack`のように発火時点とeffectの意味が一致する組み合わせは許可できる。
一方、`beforeAttack + turns:3 AT+2`のように取得済みの攻撃値や内部順序へ依存し、
ユーザーから見た意味が不自然な組み合わせは拒否する。

エンジン側ですべての組み合わせに新しい意味を与えるのではなく、catalogが候補を定義し、
validatorがIDと関係を検査し、compilerが許可済み定義だけを内部effectへ変換する。
カテゴリ別DTOには生の`effects.js` effect objectや任意のcost/valueを保持させない。

## 現行コードとの関係

この文書のカテゴリ境界は今後の新版作成基盤に対する方針であり、現時点では未実装の制限を含む。

- `effects.js`はカテゴリを知らず、対応effectを汎用的に実行する。
- `ruleEngine.js`のD compileは`battleStart`へ既存Dのeffectをそのまま渡し、`addDice`だけには制限しない。
- B compileは既知triggerであればeffectとの組み合わせを限定しない。
- C専用catalog/AP計算・selection用compiler・開発戦闘ページは実装済み。battleEngineはtrusted内部データを読み、generic buildCompilerと本番作成UIへの統合は未実装。[C作成基盤](c-skill-building.md)を参照。
- 現在のA作成catalogには共有effect候補と出目専用候補があるが、phase AT/DF補正はまだ登録されていない。
- 常時補正は`passive + modifier`のconditional/scaledへ共通化済み。旧passiveHp/passiveApは互換入口。
- 現行エンジンはDによる追加値・重複数を新版D catalog相当のルールでは検査していない。

これらはこの文書と矛盾してコードを誤って動かしているというより、将来catalog / validator /
compilerで実装すべき境界がまだエンジン入口にない状態である。旧データ互換を保つため、
新版の境界実装時にも汎用engine capabilityを不用意に削除しない。

なお、`buff-durations.md`に記載のとおり、現行攻撃処理は`beforeAttack`より前に実効AT/DFを
取得する。そのため`beforeAttack`で追加したAT/DF buffは現在の一撃へ遡及しない。
trigger別catalogを設計するときは、この時系列依存を明示的に禁止または定義する必要がある。

## この文書で確定しない事項

- A/B/C/Dのポイント価格、effectごとの最終コスト
- 固定ダメージ量、回復量、statusの価格
- Cの数値option別AP価格と割合revive再抽選率（基本AP・発動窓等はC別紙で確定済み）
- B常時modifierのbuilder公開候補・価格（engine評価・再評価は別紙に実装仕様を記載）
- cooldownの再設計
- buildCompiler、validator、catalog、UIの具体的実装
- 各カテゴリの最大effect数

これらの値や方式を未確定のまま保ち、今後それぞれの信頼済み設定と仕様で決定する。
