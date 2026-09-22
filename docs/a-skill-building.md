# Aスキル作成・compile

開発UIは [A開発ページ](a-skill-test-page.md)。新版の選択DTOから
`calculateASkillResources → compileASkill → duck.aSkill → battleEngine` まで実装済み。
本番キャラ登録・保存とgeneric buildCompilerへの統合は対象外。
旧Aのtrusted内部データは変更しない。engine capabilityと新版の公開範囲は別である。

## APIと信頼境界

- `createASkillCatalog()`：毎回独立したtrusted定義。STATUS_GROUPSから全8statusを導出。
- `getATriggerOptions(frame, catalog?)`：trigger候補、素体上の対象種類、価格。
- `getAEffectOptions(frame, triggerId, catalog?)`：全候補とselectable/reason。専用effectも隠さない。
- `getAEffectAvailability(effectId, frame, triggerId, catalog?)`：専用条件の検査。
- `calculateASkillResources(build, selection, { rules?, catalog? })`：入力検証と純粋な見積。
- `compileASkill(build, selection, { rules?, catalog? })`：`{ ok, skill, resources, errors, unresolved }`。
  okならskillをduck.aSkillに設定できる。名前・IDは呼出側で付けられる。

catalog/rulesは運営だけが渡す。ユーザーから受け取らない。
resource計算は初期diceの6枠・素体・個数制限・資源を検査するが、statsや他カテゴリを含む
build全体の合法性は判定しない。ダイス資源はcalculateBuildResourcesを再利用する。

```js
const selection = {
  triggerId: "gte:3",
  effects: [
    { effectId: "heal-self", amountOptionId: "dev-5", chanceOptionId: "50" },
    { effectId: "grant-clean-enemy", amountOptionId: "dev-1" },
  ],
};
```

`dev-*`は開発fixture専用ID。本番の数量候補はまだ空。
DTOはtriggerIdとeffectsの配列のみ。各行はeffectId、amountOptionId、chanceOptionIdのみ。
未知field、raw effect、target/status/direction/value/amount/cost/chance数値/duration/type/key/opを拒否する。
compilerはID文字列を解釈してeffectを生成せず、catalogのsemanticsから生成する。

## 発動条件・頻度

発動窓は従来どおり `afterRoll → beforeDiceResolve（A）→ 通常攻撃・出目効果 → afterDiceResolve`。
HeadwindのAキャンセルは既存処理を使う。

| 条件 | 意味 | 作成コスト |
| --- | --- | --- |
| exact | 0または素体の非0出目に一致 | 0pt |
| lte / gte | 非0の出目に対する比較 | 素体上の対象種類1/2/3で0/1/2pt |
| all | 0を含む全出目 | 2pt |

canonical triggerは `{ kind: "exact" | "lte" | "gte", value }` または `{ kind: "all" }`。
rangeは0を除外する。ruleEngineはこの形式と旧文字列形式を別々に扱う。
旧`onDice<=3`の0一致等は変更しない。
baseFacesは作成価格・表示用で、戦闘中の対象リストではない。
Dでlightに5を追加すればgte:3は5にも一致する。

frequencyCountは初期6枠の実数。exact:0/allは0を数え、rangeは数えない。
1/2枠→rank1、3/4枠→rank2、5/6枠→rank3。
初期0枠の条件も作成可能（D追加で成立し得る）。0枠のrank仕様は未定義なのでnullを返す。
このnullは価格未確定のunresolvedではない。頻度は価格・還元には一切使用しない。

## ポイント・effect数

```text
availablePoints = basePoints 3 + dicePoints
  dicePoints = calculateBuildResources(build, rules).dice.remaining
benefitSlotCost = max(0, benefitCount - 1)
effectCost = Σ max(0, benefit本体価格 - chanceDiscount)
grossCost = triggerCost + benefitSlotCost + effectCost
netCost = grossCost - drawbackPoints
remaining = availablePoints - netCost
```

0枠+1pt、同じ非0出目3個の種類ごと-1ptは共通build計算に従う。
通常構成3pt、0を1つで4pt、0を1つと3個積みで3pt、全部0で9pt。
1～4effectが必須。drawbackも上限に数えるがbenefit枠コストを増やさない。
原則として重複・相殺を許可し、選択順で実行する。compilerは並べ替えも統合もしない。
例外として出目固有effectはcatalogの`allowDuplicate: false`に従い、同一effectを1スキル内で
複数回選択できない。異なる出目固有effectの併用可否は通常どおりtrigger条件で決まる。

benefit価格は数量optionのpointCost（数量不要ならeffect.pointCost）。
drawback還元は数量optionのdrawbackPoints（未定義ならeffect.drawbackPoints）。
drawback自体のbenefit価格は計上しない。数量による還元差をtrusted側で設定できる。

chance候補は100/50/25/10%。省略は100。drawbackの100以外はresource/compilerで拒否。
100%はcanonical effectから一貫して省略する。他はbenefit各effectへchanceを設定。
抽選は独立し、random statusはchance成功後にだけ抽選される。
割引で本体価格が0になってもbenefit枠コストは残る。

結果にはbasePoints/dicePoints/availablePoints、triggerCost、frequencyCount/frequencyRank、
effectCount/benefitCount/drawbackCount/benefitSlotCost、baseEffectCost/chanceDiscount/effectCost、
drawbackPoints/grossCost/netCost/remaining、effectBreakdownを含む。
chanceDiscount合計は実際に適用した割引。各行には指定割引と下限適用後の割引も残す。
availableDicePointsはdicePointsの互換名。
未確定合計はnull、既知小計はknownEffectCost/knownDrawbackPoints。
completeは見積完了で、負残高でもtrue。readyはcompleteかつ予算内。
compilerは未完了・errors・数量未選択・未確定価格・予算不足をすべて拒否する。

## 公開effect

| 機能 | benefit | drawback |
| --- | --- | --- |
| 固定ダメージ | 相手 | 自分 |
| 固定回復 | 自分 | 相手 |
| AP | 自分+、相手− | 自分−、相手+ |
| 指定/ランダムstatus付与 | 自分buff、相手debuff | 自分debuff、相手buff |
| 指定status 1stack解除 | 自分debuff、相手buff | 自分buff、相手debuff |
| 次回通常攻撃AT | 自分+、相手− | 自分−、相手+ |
| 現在phase補正 | 自分AT+、相手DF− | 自分AT−、相手DF+ |
| 通常攻撃回数 | 全triggerで+N | キャンセル、exact:2で−1 |
| 反動 | exact:6の既存反動軽減 | 全triggerで追加反動 |
| 出目固有キャンセル | — | exact:1/3/4/5でAP+1/回復/反撃+1/相手AP−1をskip |

指定解除はchangeStatus op:add value:-1を使用し、既存の0 clampに従う。
randomは@buff/@debuffで1種類付与。指定付与と同じ仮価格で、ランダム割引はない。
phase補正はaddBuff duration:{kind:"phase"}。次phaseへ持ち越さない。
attackTimesOverride/attackTimesAddは既存engineの上書き値＋加算値の合成に従う。
キャンセルと回数加算の相殺も許可する。

倍率・turns buff・addDice・revive・割合ダメージ/回復・passive modifier・
status全stack/group/ランダム解除・任意の生effectは公開しない。旧Aは引き続き実行できる。

## engineの小さな追加

- canonical trigger比較（rangeの0除外）。旧文字列の判定は維持。
- changeValueのphase tempキーskipDice1/3/4/5。逆effectで相殺せず出目処理をskip。
- changeValueのphase tempキーadditionalRecoil。phase開始でskipとともにreset。
- 通常攻撃処理と出目固有処理の後、afterDiceResolveの前に追加反動を1回処理。
  複数hitでも1回。キャンセル・湯気/効果MISS・連続行動命中率MISSでは発生しない。
  回避は既存出目6のhadNonMissAttackに合わせ「攻撃成立」として扱う。
  旧出目6は連続行動命中率判定前にhadNonMissAttackを立てるため、その従来挙動を保持し、
  新追加反動だけ別フラグで連続行動MISSも除外する。recoilMinusは追加反動には効かない。

## 未確定と検証

productionの数量option・effect価格・drawback還元・chance価格補正は未確定。
100%の割引0だけは補正なしとして定義。還元上限maxDrawbackPointsはnullの拡張口で未適用。
frequencyの価格への利用、0/6のrankは今後決定する。
`createADevCatalog()`の数値は開発確認用でゲームバランス仕様ではない。

対象テスト：`node --test tests/aSkill.test.mjs tests/aSkillEngine.test.mjs`。
engine近傍の互換確認：`tests/triggers.test.mjs`、`tests/buffDuration.test.mjs`。
