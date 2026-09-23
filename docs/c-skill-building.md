# 新版Cスキル作成基盤

作成の最上位構造は次の順で選ぶ。

```text
mode: normal / special（specialはflatのみ）
↓
分岐なし flat / 分岐あり
↓（分岐ありの場合）
random（等確率2択 / 3択） / hpCondition（自分HP割合のみ）
↓
各枝で共通のC effect editorを使う
```

branchのネスト、重み付け、4択以上、enemy HP/AP/status/turn条件は公開しない。
全枝の選択leaf effect合計が1～5。containerと自動生成する失敗時20%効果は数えず、各枝は1effect以上を持つ。
catalogは公開能力、engineは信頼済み内部データを実行する能力を担当する。
この基盤はgeneric build DTO / validateBuildとは独立する。C専用compilerと開発確認ページは実装済みで、本番UI・保存処理・generic buildCompilerは未実装。

## ファイルとAPI

- `cSkillRules.js` / `createCSkillRules()`：確定した枠数/APルールの唯一の設定元。
- `cSkillCatalog.js` / `createCSkillCatalog()`：公開効果・option set・将来compiler用の意味情報。
- `getCEffectAvailability()` / `getCEffectOptions()`：mode別選択可否と候補取得。
- `cSkillResources.js` / `calculateCSkillResources(selection, { catalog, rules })`：純粋なAP見積・選択検査。
- `cSkillCompiler.js` / `compileCSkill(selection, { catalog, rules })`：検査済みIDをtrusted cSkillへ変換。
- `timedHitRules.js`：戦闘内部の一時的な命中rule。静的B ruleとは別管理。

## 選択DTOとcatalog

```js
{
  mode: "normal",
  structure: { kind: "flat", effects: [
    { effectId: "turn-at-self-up", options: {
      amount: "運営が定義する数量option ID",
      duration: "運営が定義するturn数option ID"
    } }
  ] }
}
```

DTOが保持するのはeffect IDと各軸のoption IDだけ。
生effect、value、costAP、apDelta等の申告値は拒否する。
数値IDを自由入力へ置き換えるAPIではなく、catalogが定めた候補にだけ解決する。

旧新版selectionのトップレベル`effects`は受け付けない。`structure.effects`へ移行する。
これは作成DTOの移行であり、旧trusted `duck.cSkill`のengine入力には影響しない。

```js
// 各effectsの要素は上と同じeffect selection。
{ mode: "normal", structure: { kind: "random", branches: [
  { effects: [/* ... */] }, { effects: [/* ... */] }
] } }
{ mode: "normal", structure: { kind: "hpCondition", thresholdOptionId: "trusted ID", branches: {
  met: { effects: [/* 自分HP割合 >= threshold */] },
  unmet: { effects: [/* 自分HP割合 < threshold */] }
} } }
```

flatはeffect配列、randomは既存`randomPick.picks`の配列内配列へcompileする。
hpConditionは`{type:"conditional", when:{left:"self.hpPct",op:">=",right:threshold},met:[...],unmet:[...]}`へcompileする。
effects.jsに小さなcontainer処理だけを追加し、既存condition evaluatorで発動時に1回だけ判定する。
枝の途中の回復・自傷・reviveでHPが閾値を跨いでも、もう片方の枝や途中から別の枝を実行しない。
各leafにwhenを付けて逐次再判定する方式では排他性を保てないためであり、別の条件判定engineは作らない。

### chance / onFailと追加能力

chance対応は相手への固定ダメージ（damage-enemy）と自分への固定回復（heal-self）のみ。trusted effect定義のchanceEnabled: trueで明示し、未指定のeffectは許可しない。
この2effectは100%がdefaultで、省略可能。同じ効果量optionへ成功率100/70/50/25%を後付けする。その他はdrawbackを含め100%固定で、chanceOptionIdは"100"を含め指定自体をvalidation errorにする。
成功率別の効果量表は設けない。drawbackは100%固定。100%ではcompiled effectにchance/onFailを付けず、chance判定の乱数を消費しない（randomPickやランダムstatus本来の抽選は別）。

ユーザー指定onFailは廃止。chance関連のselection fieldはchanceOptionIdだけで、失敗時effectを編集できない。
100%未満なら共通leaf compilerが通常のmain effectを作り、そのtrusted値から以下を自動生成する。

| HPを直接増減するeffect | 自動onFail |
| --- | --- |
| 固定ダメージ / 固定回復 | floor(amount × 0.2) |

20%は確定ルール。整数はfloor、最低1保証なし。0なら何も起こらない。
現在HP割合・debuff総stack・turnStepダメージ、status付与（ランダム含む）・解除・AT/DF補正・timed hit・reviveなどにはgeneric chanceも自動onFailも生成しない。
reviveは初回確定、2回目以降は既存repeatReviveChanceだけを使い、二重抽選しない。特殊Cのheal-selfもchance対応だが、repeatReviveChanceの対象外。100%の固定回復は特殊Cが発動するたびに必ず実行する。
自動onFailにchanceやさらにonFailは付けない。失敗時20%は追加effectでも価格optionでもなく、effectCount/benefitCount/枠APへ数えず、追加APも課さない。
flat/random/hpConditionのどの枝でも同じleaf compilerを使い、既存engineのeffect.chance/onFailで実行する。

```js
// optionの量・価格は開発fixture。chance IDはproductionと共通。
{ effectId: "damage-enemy", options: { amount: "dev-damageAmount-70" }, chanceOptionId: "70" }
// compiled main: amount:70, chance:0.7,
// onFail:{type:"fixedDamage",target:"enemy",amount:14}
```

- status付与だけに`random-buff` / `random-debuff`のtrusted IDがあり、`@buff` / `@debuff`へcompileする。clearStatus/timed-hitへ流用しない。
- `debuff-total-damage-enemy`は`multiplier`を選び、相手のdebuff総stack×Nを既存`fixedDamage.byStatusCount`へcompileする。buffは含めない。
- `turn-step-damage-enemy`は`baseAmount / everyTurns / stepAmount`を選び、既存`fixedDamage.amount / turnStep`へcompileする。増分は`floor(turn/every) * add`で5/10turn境界を含む。
- `repeat`は公開しない。CS02の9回×各50%を完全再現する作成DTOは対象外。legacy engineのrepeatは削除しない。

raw onFail/failureRate/failureEffect/failureMultiplier/apDiscount/chanceDiscount/effect/target/value/chance/when/condition/randomPick/picks/turnStep/byStatusCount/costAP/apDelta/repeat/repeatReviveChanceと未知fieldは、DTO各階層で拒否する。

effect定義はid / category / label / modes / polarity / optionAxes / mirrorId / semanticsを持つ。
optionAxesは軸名→option set ID、optionSetsはID→`{ id, label, value, apDelta }[]`。
semanticsは既存effect type、対象、符号、各軸の用途などの信頼済み情報であり、compiler実装ではない。

共有候補はnormal/specialの両方、reviveはspecialだけに登録する。
同一effectの重複を許可し、各行をそのまま数え、価格も行ごとに加算する。
復活がない特殊CやdrawbackのみのCも構築意図を理由に拒否しない。

## 枠数とAP計算

確定ルールは1～5effect、baseAP=5、minimumAP=5、追加benefit枠1つにつき+1AP。
別の作成用スキルポイントは使用しない。

以下は従来のflat AP集計。chance対応2effectのleaf option価格から、そのleaf専用のchance割引を差し引く。その他のeffectではchance割引計算を行わない。

```text
effectCount = benefitCount + drawbackCount
slotCost = max(0, benefitCount - 1) × additionalBenefitSlotAP
benefit leafDelta = option軸価格合計 - min(option軸価格合計, apDiscount)
drawback leafDelta = -option軸価格合計
optionDelta = 全leafDeltaの合計
rawAP = baseAP + slotCost + optionDelta
requiredAP = max(minimumAP, rawAP)
```

5メリットならslotCostは合計4。0+1+2+3+4ではない。
2メリット+2デメリットは4枠を使用するが、slotCostは1。
デメリットも上限5枠へ数える一方、自身には枠追加APを発生させない。
デメリットだけでrawAPが低下してもrequiredAPは5未満にならない。

effectの種類自体には固定価格を持たせない。amount/duration/status/scope等、
選択したoption軸のapDeltaを足す。turn補正のamountとdurationも両方を加算する。
mirrorは同じoption set IDを参照し、benefitは正、drawbackは全軸を負にする。
デメリット専用価格表を設けず、片側だけ価格調整される構造を避ける。

戻り値はmode、effectCount、benefitCount、drawbackCount、baseAP、slotCost、
knownOptionDelta、optionDelta、rawAP、requiredAP、complete、errors、unresolved。
不正選択や未確定項目があれば最終optionDelta/rawAP/requiredAPはnull。
判明している符号付き小計はknownOptionDeltaへ残す。
未選択はOPTION_UNSELECTED、価格未定はPRICE_UNRESOLVEDで示し、明示的apDelta=0と区別する。

### production balance v0

正式値はcreateCSkillCatalog / createCSkillRulesに定義する。productionのみでcompile・戦闘可能。今回対象の未確定項目はない。

| option set | 候補 → option AP |
| --- | --- |
| damageAmount | 50/60/70/80/90/100 → 0/1/2/3/4/5 |
| healAmount | 30/40/50 → 0/1/2 |
| currentHpPct | 25/50/75/100% → 0/5/10/15 |
| statusStacks | 3 → 0 |
| 指定/random buff・debuff | 全種類0 |
| 単体status全stack解除 | 全種類0 |
| buffまたはdebuffの1group解除 | 2 |
| turnATAmount / turnDFAmount | 2/3/4 → 0/1/2 |
| turnCount | 2/3/4 → 0/1/2 |
| timedStacks | 1 → 0 |
| timedTurns | 3/4/5 → 0/1/2 |
| statusMultiplier | 10/15/20 → 0/1/2 |
| stepBaseAmount | 30 → 0 |
| stepEveryTurns | 5/10 → 1/0 |
| stepAmount | 5/10 → 0/2 |
| revivePct | 1/10/25% → 0/2/4 |
| hpThreshold | 25/50/75% → すべて-1 |

AT/DFはamount+duration、turnStepはbase+every+addのoption価格を合算する。mirror drawbackは対応benefitと共通表の価格を反転する。
chanceOptionsは100/70/50/25%、非負のapDiscountは0/1/2/3。割引はそのleaf価格を下限0まで下げるだけで、baseAP・追加枠・分岐・他effectには波及しない。

分岐は通常Cのみ。branchAggregationは正式名称sumで、全branchのleaf価格とbenefit枠を合算する。
branchAPDeltaはrandom2:-1、random3:-2、hpCondition:0。HP threshold自体の価格は一律-1。
requiredAP = max(5, rawAP)。特殊Cのrandom/hpConditionはSPECIAL_FLAT_ONLYで拒否し、UIではflatに初期化する。
マイナス価格はtrusted分岐/thresholdに限り許可し、通常effect option価格とchance割引は非負のまま。
effectBreakdownでoptionPrice/apDiscount/appliedDiscount/effectDelta、knownStructureDeltaで分岐・threshold合計補正を確認できる。

createCDevCatalog / createCDevRulesは構造・旧能力テスト用に残す。dev独自数量とoption価格・chance割引・分岐補正0はゲーム仕様ではない。集約方式sumとspecial flat制限はproduction共通。
nullのtrusted設定は引き続き未確定としてcompileを止めるが、production balance v0にはnullは残さない。

## 公開effect

| 系統 | benefit | drawback | option軸 |
| --- | --- | --- | --- |
| 固定ダメージ | enemy | self | amount |
| 現在HP割合固定ダメージ | enemyのみ | なし | amountPct |
| 固定heal | self | enemy | amount |
| debuff付与 | enemy | self | status / amount |
| buff付与 | self | enemy | status / amount |
| debuff全stack解除 | self | enemy | 単体はstatus、groupはscope |
| buff全stack解除 | enemy | self | 単体はstatus、groupはscope |
| turns AT/DF | self+ / enemy- | self- / enemy+ | amount / duration |
| 期限付き通常命中status | enemyへdebuff / selfへbuff | なし | status / amount / duration |
| 最大HP割合revive | self、special専用 | なし | maxHpPct |

status分類は`statusGroups.js`のSTATUS_GROUPSを参照する。
AP操作、addDice、出目固有操作、B常時modifier、割合healはC catalogへ登録しない。
旧エンジンの能力や旧Cデータからこれらを削除する意味ではない。

### 現在HP割合ダメージと固定heal

割合ダメージは既存`fixedDamage.amountPct`をそのまま利用する。
現在HP基準で切り捨て、HP<=0なら0、最低1保証なし。
HP101・30%なら30ダメージ、HP1・30%なら0、100%なら現在HP分となる。
100%未満はそれ単体では正の整数HPを0にしきれない。100%は必殺相当なので高いAPを想定するが、
価格はbalance v0で確定。自分への割合ダメージdrawbackは公開しない。

healは既存固定値加算。HP=-30に50なら20、HP=-100に50なら-50。
結果的に復帰してもhealであり、既存healログ/afterHealを通る。
最大HP割合heal・現在HP割合healは設けない。

### 状態全解除

内部effectは`{ type: "clearStatus", target: "self", status: "crack" }`、または
`{ type: "clearStatus", target: "enemy", group: "buff" }`。
指定したstatusの全stack、またはSTATUS_GROUPSのgroup内全種類を決定的に0へする。
group以外は残し、解除後に両者のB常時modifierを同期する。
`changeStatus status:"@debuff"`等は従来のランダム1種類選択のままで、全解除には流用しない。

### turn補正とtemporary rule

AT/DF補正は既存`addBuff duration:{ kind:"turns", count:N }`へcompileする。
付与時刻に関係なくターン末減算を通るたび-1、0で消滅。
特殊Cも減算より前なので、付けたターンに即1減る。

期限付き命中効果の内部入力例：

```js
{
  type: "addTimedHitRule", target: "self",
  duration: { kind: "turns", count: 3 },
  effect: { type: "changeStatus", target: "enemy", status: "crack", op: "add", value: 1 }
}
```

これは運営/将来compilerが生成する内部データで、ユーザーDTOではない。
fighter.timedHitRulesへ`trigger:"afterNormalAttackResolved"`、
`duration:{kind:"turns",remainingTurns:N}`、effect、originSkillを保持する。
この名前は内部の処理位置を示すだけで、通常BのTriggersへは追加していない。
この小さなcapabilityはchangeStatusを保持する用途に限定する。

通常攻撃1回のダメージ・afterTakeDamage・反撃・afterDamage終了後、次の攻撃へ進む前に実行する。
miss/avoided/counterでは実行せず、出目2の2回命中なら2回実行する。
次の一撃には付与状態を反映するが、すでに解決済みの一撃へ遡及しない。
命中結果は後続Bのheal等によるctx.attackの置換から独立して保持する。

同一idでも独立に保持・実行・減算する。静的なB rulesには混ぜない。
両者のturn buff減算後、turnEnd trigger前にtemporary ruleも減算する。
specialで付けたturns:1は同ターン末に消える。turns:2は次ターンに1回分残る。
付与statusは既存changeStatusを通るのでclean防御やB常時modifier同期も同じ経路。

## normal / specialと旧互換

```text
normal:
フィールド → phaseStart → beforeStatus → 状態 → afterStatus
→ 荒波キャンセル判定 → beforeRoll → 通常C → ダイス

special:
全phase終了 → 特殊C（P1→P2）→ beforeTurnEnd
→ turn buff減算 → temporary rule減算 → turnEnd → judge
```

normalは従来同様、荒波で行動キャンセルなら発動しない。
specialは自分HP<=0かつ必要AP所持の場合、その判定窓で発動する。
復活は必須ではない。道連れ固定ダメージで双方HP<=0になればjudgeでdrawとなり得る。
状態付与だけで敗北する構成、死亡状態では役立たないbuffのみの構成も禁止しない。

エンジンはtrusted compiled valueとして既存`cSkill.costAP`を消費する。
開発ページはC専用compilerを通して接続する。ユーザーDTOを直接engineへ渡さない。
modeがあればnormal/specialで経路を選び、modeなしなら旧trigger形式を解釈する。
modeなし`trigger:"beforeTurnEnd"`は従来の特殊C、その他は従来の通常C。
旧特殊CのcanActivateCSkill/once使用済み判定は維持し、既存固定HP復活も変更しない。

新版specialはAPを消費した発動ごとにruntime.specialCActivationCountを1増やす。
復活成功回数とは別。各判定窓でHP/AP条件を満たせば後のターンにも再発動できる。
ログにはactivationCount、costAP、apBefore、apAfterを追加する。

## specialの割合revive

内部形式は`{ type:"revive", target:"self", maxHpPct:0.3 }`。
旧`{ type:"revive", hp:150, once:true }`とは明確に分岐する。
新版variantはonceフラグを共有せず、各行を独立処理する。

```text
成功時 targetHP = floor(maxHP × maxHpPct)
HP = max(現在HP, targetHP)
```

healの加算ではない。maxHP1000/currentHP=-250/30%なら300。
30%+30%+50%が成功しても110%にはならず500となる。
低いreviveが後から高いHPを下げず、通常heal後のより高いHPも維持する。
effect配列は記載順に実行し、途中のダメージやheal等もその順序で適用する。
afterHealは呼ばずrevivedログとB常時modifier同期だけを行う。
floor結果への最低1保証は追加しない。

初回special発動中は各割合reviveが確定成功し、抽選用乱数を消費しない。
2回目以降は各行が独立してtrusted `cSkill.repeatReviveChance`で抽選する。
初回成功本数ではなくspecial発動回数で判別する。revive失敗でもAPは消費済みで返却せず、
後続の固定ダメージ・状態付与等を通常どおり実行する。

repeatReviveChanceはtrusted rulesに { 2: 0.5, 3: 0.25, default: 0.1 } を定義する。
初回100%、2回目50%、3回目25%、4回目以降10%。判定はrng() < probabilityで、境界値そのものは失敗。
各revive行は独立抽選し、generic chanceを重ねない。固定healや他effectには作用しない。
legacy/開発用の単一数値確率も引き続き実行可能。ユーザーselectionへ確率設定は持たせない。
割合復活optionのAP価格と、再抽選確率のゲームルールは別設定である。

## 旧buildRulesとの関係・未確定事項

旧案のresources.cModules/statPointCostは互換用の空設定として残し、新版Cの見積では使わない。
calculateBuildResourcesの未使用statポイント算出も壊さないが、新版Cには消費させない。
今回のCは専用rules/catalog/resourcesで独立してAPを計算する。

Cのoption表・AP価格・repeatReviveChanceはbalance v0として確定。本番UI、最終buildCompiler、generic DTO統合は今回対象外。
A/B価格やD新版、cooldown、既存status自体のルールも変更しない。

## テスト

Node標準テストで`tests/cSkillResources.test.mjs`、`tests/cSkillEngine.test.mjs`、`tests/cSkillCompiler.test.mjs`、`tests/cSkillStructure.test.mjs`、`tests/cSkillChance.test.mjs`を実行する。
AP内訳・mirror・注入拒否・未確定価格・純粋性、割合ダメージ、全解除、命中ruleの時系列と寿命、
特殊Cの発動/AP/復活・再抽選・旧互換を検証する。
仮数量/価格/確率はテストfixture内に限り使用する。

構造テストはCS11/15/16/18/21/23/24/25系の能力をselectionからcompiler・harness・battleへ接続する。
CS15系の能力テストは新版ではstatusを100%付与し、stack総数参照を維持する。旧75%の個別抽選は新版selectionの再現対象外。
CS23は旧実装の60を基準にする。旧CS03の80%・成功70/失敗30は新版で再現せず、legacy engine互換テストだけに残す。
新版70ダメージの失敗時は14。repeatは非公開で、CS02完全再現は引き続き対象外。
CS23の新分岐は今回仕様の>=50% / <50%なので、旧実装の<=49%との間にあった隙間は持たない。legacy入力自身の意味は維持する。
CS10/22の固定HP・onceへ新版reviveを戻さず、最大HP割合・特殊C再発動・repeatReviveChanceを維持する。

## C専用compilerと開発ページ

```text
selection DTO
→ calculateCSkillResources（catalog照合・AP計算）
→ compileCSkill
→ trusted cSkill
→ battleEngine.runBattle
```

`compileCSkill(selection, { catalog, rules })`は成功時に
`{ ok:true, skill, resources, errors:[], unresolved:[] }`を返す。
未選択・価格未確定・不正なDTOでは`ok:false, skill:null`となり、補完して実行しない。
壊れたtrusted semanticsや不正な内部数値はprogrammer errorとしてTypeErrorになる。

```js
// 開発fixtureのID例。productionの数量・価格ではない。
const selection = {
  mode: "normal",
  structure: { kind: "flat", effects: [{ effectId: "damage-enemy", options: { amount: "dev-damageAmount-30" } }] }
};
// compile成功時のskill:
// { mode:"normal", costAP:5,
//   effect:[{ type:"fixedDamage", target:"enemy", amount:30 }] }
```

変換はeffect ID別ではなくcatalogのsemantics.type・target・各axis・amountSignを参照する。
数量はtrusted optionのvalueから、costAPはresources.requiredAPから取得する。
配列順と重複を保持し、timed hitのnested effectもcompilerが生成する。
DTOのraw effect/value/costAP/apDelta/target/duration/repeatReviveChanceは拒否する。
入力catalog・rules・selectionは変更しない。

specialにだけtrusted rulesの回数別repeatReviveChanceをコピーする。legacy/fixture用の単一数値0～1も許可する。開発ページの0/50/100%上書きはfixture ON時だけであり、selectionには入らない。

### 起動と操作

リポジトリ直下で実行する（Node標準機能のみ）。

```powershell
node scripts/serve-a-skill-test.mjs
# 既に4173が使用中なら別portを指定
node scripts/serve-a-skill-test.mjs 4174
```

`http://127.0.0.1:4173/c-skill-test.html`へアクセスする。
portを変更した場合はURLも合わせる。既存`a-skill-test.html`も同じserverで開ける。
serverは127.0.0.1限定で、A/B/C/D HTMLとjs/cssの許可パスだけを配信する。
`.git`、docs、任意ローカルファイルは配信しない。

本番catalogは初期状態でcompile不能になることが正常。
「開発用fixture」をONにすると`createCDevCatalog()`が独立catalogを作り、
数量候補とapDelta=0、および`createCDevRules()`の開発用分岐価格を設定する。production catalog自体は変更・保存しない。
固定ダメージ10/30/40/50/60/70/100、回復10/30/50/100、割合ダメージ10/20/30/40/50/100%、stack・AT/DF量1/2/3、
turn数1/2/3/4、復活1/10/30/50%はすべて開発確認用で、ゲーム仕様ではない。
status/scope価格もfixture内では0にする。
成功率100/70/50/25%（確率は確定・fixture割引額0は仮）、HP threshold50%、debuff倍率5、turnStepの基礎10/40・間隔5/10・増分10も開発専用。
追加benefit枠APは通常どおりなので1/2/3メリットのcostAPは5/6/7になる。

mode → 分岐なし/あり → ランダム2/3択またはHP条件 → 各枝のeffect/optionの順に選ぶ。
構造切替時は各枝を初期効果へ戻す。各枝のeditorは同じ実装を使用する。
全枝の選択effect合計で最大5行まで追加・削除する。chance対応effectはeffect → option → 成功率の順で表示する。
成功率selectorはdamage-enemy / heal-selfだけに表示する。100%未満なら編集不可の「失敗時：主効果の20%」を表示する。その他のeffectにはselectorも失敗時説明も表示しない。失敗時effectの追加checkbox/editorは設けない。
重複選択も可能。normalではreviveを無効表示し、理由を示す。
AP内訳、errors/unresolved、selection、compiled cSkill、resource resultは常に確認できる。
raw effectを編集して投入する機能は設けない。

### 戦闘harness

`runCSkillTestBattle(selection, { catalog, rules, settings, rng })`は毎回compileしてから実行する。
P1は現在のcompiled C、P2はCなし。AT/DF各3・SP1・最大HP1000の固定dummyで、
各ダイスは指定値だけ、フィールドなし。開始HP/APはtrusted D battleStart効果で設定する。
P1開始HPは0・負数も可。通常のturn開始AP増加は止めない。
反復特殊Cのチェックは開発BのphaseEndでP1のHPを-1に戻す。
engineに開発専用分岐を加えない。

resultとbattleEndの最終HP/AP/statusを表示する。表示のAT/DF/SP/maxHPはdummy基礎値で、
最終実効buff値ではない。event一覧はturn/phase/actor/type/内容を表示し、
C・ダメージ・回復・復活抽選・status・buff・timed rule等を絞り込める。
raw JSONには実行時のselection/settings/compiled skillと全戦闘ログを残す（保存はしない）。
設定変更後は前回結果である旨を表示し、再実行を促す。

通常Cのダメージ・heal・割合ダメージ・turn補正・status、timed hitの同phase2回命中、
特殊Cの復活なし・heal・複数revive最大値・再抽選0/50/100%はcompiler/harnessテストで検証する。
engine・旧C入力・旧固定HP once復活はこの接続実装では変更しない。
