# 新版Cスキル作成基盤

ユーザーは作成開始時に`mode: "normal"`または`mode: "special"`を選ぶ。
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
  effects: [
    { effectId: "turn-at-self-up", options: {
      amount: "運営が定義する数量option ID",
      duration: "運営が定義するturn数option ID"
    } }
  ]
}
```

DTOが保持するのはeffect IDと各軸のoption IDだけ。
生effect、value、costAP、apDelta等の申告値は拒否する。
数値IDを自由入力へ置き換えるAPIではなく、catalogが定めた候補にだけ解決する。

effect定義はid / category / label / modes / polarity / optionAxes / mirrorId / semanticsを持つ。
optionAxesは軸名→option set ID、optionSetsはID→`{ id, label, value, apDelta }[]`。
semanticsは既存effect type、対象、符号、各軸の用途などの信頼済み情報であり、compiler実装ではない。

共有候補はnormal/specialの両方、reviveはspecialだけに登録する。
同一effectの重複を許可し、各行をそのまま数え、価格も行ごとに加算する。
復活がない特殊CやdrawbackのみのCも構築意図を理由に拒否しない。

## 枠数とAP計算

確定ルールは1～5effect、baseAP=5、minimumAP=5、追加benefit枠1つにつき+1AP。
別の作成用スキルポイントは使用しない。

```text
effectCount = benefitCount + drawbackCount
slotCost = max(0, benefitCount - 1) × additionalBenefitSlotAP
optionDelta = 全行の全option軸の符号付きapDelta合計
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

productionの数値option setは空。既知のstatus/scope候補も価格はnull。
テスト用fixtureの数値・価格はゲームバランスの確定値ではない。

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
100%未満を含め価格は未確定。自分への割合ダメージdrawbackは公開しない。

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

repeatReviveChanceの最終値は未確定。createCSkillRulesの設定はnullで、50%等は採用していない。
割合reviveを反復実行するtrusted Cには運営/テスト側で0～1の値を明示する必要がある。
初回は未設定でも確定成功するが、2回目の割合reviveに設定がなければTypeErrorで
設定不備を示す。暗黙に0%/50%へ補完しない。ユーザーselectionへこの値を持たせない。
割合復活optionのAP価格と、再抽選確率のゲームルールは別設定である。

## 旧buildRulesとの関係・未確定事項

旧案のresources.cModules/statPointCostは互換用の空設定として残し、新版Cの見積では使わない。
calculateBuildResourcesの未使用statポイント算出も壊さないが、新版Cには消費させない。
今回のCは専用rules/catalog/resourcesで独立してAPを計算する。

固定量/割合/stack/turn/AT/DF/timed rule/復活率ごとの最終option表・AP価格、
repeatReviveChance、本番UI、最終buildCompiler、generic DTO統合は未実装・未確定。
A/B価格やD新版、cooldown、既存status自体のルールも変更しない。

## テスト

Node標準テストで`tests/cSkillResources.test.mjs`、`tests/cSkillEngine.test.mjs`、`tests/cSkillCompiler.test.mjs`を実行する。
AP内訳・mirror・注入拒否・未確定価格・純粋性、割合ダメージ、全解除、命中ruleの時系列と寿命、
特殊Cの発動/AP/復活・再抽選・旧互換を検証する。
仮数量/価格/確率はテストfixture内に限り使用する。

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
  effects: [{ effectId: "damage-enemy", options: { amount: "dev-damageAmount-30" } }]
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

specialにだけ、trusted rulesの有効なrepeatReviveChance（0～1）をコピーする。
productionのnullは補完せず出力から省く。割合reviveを2回以上試す場合は、
開発ページの別テスト設定で0%/50%/100%を指定する。この設定はselectionに入らない。

### 起動と操作

リポジトリ直下で実行する（Node標準機能のみ）。

```powershell
node scripts/serve-a-skill-test.mjs
# 既に4173が使用中なら別portを指定
node scripts/serve-a-skill-test.mjs 4174
```

`http://127.0.0.1:4173/c-skill-test.html`へアクセスする。
portを変更した場合はURLも合わせる。既存`a-skill-test.html`も同じserverで開ける。
serverは127.0.0.1限定で、A/C HTMLとjs/cssの許可パスだけを配信する。
`.git`、docs、任意ローカルファイルは配信しない。

本番catalogは初期状態でcompile不能になることが正常。
「開発用fixture」をONにすると`createCDevCatalog()`が独立catalogを作り、
数量候補とapDelta=0を設定する。production catalog自体は変更・保存しない。
固定量10/30/50/100、割合ダメージ10/30/50/100%、stack・AT/DF量1/2/3、
turn数1/2/3/4、復活1/10/30/50%はすべて開発確認用で、ゲーム仕様ではない。
status/scopeの未確定価格もfixture内だけ0にする。
追加benefit枠APは通常どおりなので1/2/3メリットのcostAPは5/6/7になる。

mode・カテゴリ・effect・複数option軸を選び、最大5行まで追加・削除する。
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
