# 新版B selection / catalog / compiler

`bSkillCatalog.js` は公開済み構造と合法な完成option、`bSkillCompiler.js` はID検証とengineデータ生成を担当する。
1キャラにつきBを1候補選び、選択コストはない。本番登録buildとの接続、ポイント/AP価格制は含めない。既存の `bSkill` / `bSkills` は引き続き使用できる。

## selection DTO

1つのselectionで1つの完成optionを選ぶ。イベント型はcatalog.events内の三つのIDが**同じ行**に一致する必要がある。

```js
const selection = {
  type: "event",
  triggerId: "after-hit",
  conditionId: "damage-medium",
  effectId: "enemy-debuff",
  options: { statusId: "crack" },
};
const traitSelection = {
  type: "trait",
  traitId: "damage-both-up",
  options: {},
};
```

`options` は必須。指定statusを持つoptionだけ `statusId` を要求し、それ以外は空object。
raw trigger/when/effect、数値、任意の追加field、違うgroupのstatusは拒否する。
phase-startにはstatus選択軸がない。before-attackはdebuff条件のみ。
after-take-hitのalwaysは指定status +1のみ、AP参照回復・AP消費回復・敵AP固定damageはいずれもhigh（受damage>=8）のみ。

## productionと開発用仮値

各完成optionには `semantics.rules`、`optionAxes`、`tuning`、`tuningKinds` がある。
semanticsのtuning参照はcompilerが解決する内部表現であり、engineやselectionへ直接渡さない。
condition別optionは独立したtuningを持ち、厳しい条件に大きい効果量を割り当てられる。
production balance v0はevent 56・trait 14、合計70候補。全tuningが確定し、production catalogのみでcompile可能。
trusted fixtureでnullを明示した場合は引き続き `valid:true, complete:false, unresolved:[...]`、
compileは `ok:false, bSkills:null` となり、0や1で穴埋めしない。

確定済みの構造上の値（status存在条件の1、被命中alwaysの+1、攻撃回数+1、実回復量>0）は固定する。
数値の唯一の設定元はcatalog内のproductionTuning。AP参照回復はmin(現在AP,10)、buff総stack回復は既存byStatusCountへ `STATUS_GROUPS.buff` とperStack=3を渡す。

`bSkillDevFixtures.js` の `createBDevCatalog()` のみ仮値を注入する。**本番バランスではない**。
catalog引数は運営側の信頼境界であり、ユーザーが送ったcatalogを注入してはいけない。

```js
import { compileBSkill } from "../js/bSkillCompiler.js";
const result = compileBSkill(selection); // production balance v0
if (result.ok) battler.bSkills = result.bSkills;
```

成功結果は `{ valid: true, complete: true, ok: true, bSkills: [...], errors: [], unresolved: [] }`。
1つのtraitが複数ruleを生成でき、与被damage traitはbeforeAttack/beforeTakeDamageの2件になる。
HP/AP補正はcanonical passive、HP条件攻撃回数はbeforeRollへcompileする。
返されるruleは解決済みの独立objectで、catalogを変更しない。IDは完成optionとrule位置から生成する。
生のengine用B定義は引き続きlegacy/trustedデータ用であり、selection validatorの代替ではない。

## balance v0

phaseStartの通常ランダムstatusは1stack。常時50%型も1stack/50%。first-actionはself.actionsThisTurn==1で、通常型1stack、強型2stack/50%。
beforeAttackは自分/相手debuffが1stack以上でAT+3、自分debuff総stack>=4なら現在総stack数ぶんAT増加。counterは対象外。

| afterDamage条件 | 指定debuff | buff解除repeat | 相手次回AT |
| --- | --- | --- | --- |
| 常時 | 1 | 1 | -2 |
| damage>=5 | 1 | 2 | -4 |
| damage>=8 | 2 | 3 | -6 |
| counter | 1 | 2 | -3 |

afterTakeDamage常時は自分buff/相手debuff各1stack。damage>=5は2stack・次回AT±4、damage>=8は3stack・次回AT±6。
damage>=8限定で、AP比例回復（上限10）、AP1消費後15回復、相手現在APぶん相手固定damage（上限なし）を選べる。
旧damage-medium/heal-by-apは公開しない。

| afterHeal条件 | buff | debuff解除repeat | 次回AT | 追加HP回復 | AP |
| --- | --- | --- | --- | --- | --- |
| 常時 | 1 | 1 | +3 | +5 | なし |
| 回復後HP<=50% | 2 | 2 | +5 | +8 | +1 |
| 回復後HP<=25% | 3 | 3 | +8 | +10 | +2 |

HP25%以下の緊急回復は解除repeat2＋指定buff2stack。AP+1とAP+2は別の独立候補であり、同時に装備する段階効果ではない。
全afterHeal候補はheal.actual>0のみ。追加回復source=afterHealBonusから再帰発火しない。

phaseEndはbuff総stack×3回復と、常時AP変換3候補。ap-up-cost-5は最大HP5%固定damage→AP+2、ap-up-cost-8は8%→AP+3、ap-up-cost-10は10%→AP+4。
旧hp-high条件のAP/self-buff/self-debuff-removeは廃止。自傷は致死可能で、HP0以下でも残りphaseで行動・自傷・AP獲得を行い、ターン末に特殊Cを判定する。

| trait | balance v0 |
| --- | --- |
| HP>=60% / HP<=40% | AT+4、DF+4、またはAT+2/DF+2 |
| HP>=75% / HP<=25% | 通常攻撃回数+1 |
| AP比例AT/DF | scale1、min0、max5 |
| 与/被通常damageランダム倍率 | 一様0～2倍、counter除外 |
| damage-both-up | outgoing2、incoming2 |
| damage-both-down | outgoing0.5、incoming0.5 |

nextAttackATPlusは通常攻撃試行1回で消費し、MISS/回避でも持ち越さない。attackTimesOverride===0は追加攻撃より優先する。

## engineへの追加

- conditionとeffect数値readの `self.statusTotal:buff/debuff`、`enemy.statusTotal:buff/debuff`。passiveも同じ参照を使う。
- afterHeal中の `ctx.heal = { target, requested, actual, hpBefore, hpAfter, hpPctAfter }`。
  targetは実際のfighter参照、数値は元の回復イベントのsnapshot。
  conditionから `heal.requested/actual/hpBefore/hpAfter/hpPctAfter` を読める。
- trusted effectの `target: "healTarget"`。contextなしでは何もしない。actorは回復を起こした所有者のまま。
- `fixedDamage.amountMaxHpPct` は `floor(maxHP * pct)`。従来のamountPctは現在HP基準を維持。
- 荒波キャンセル時もphaseEndを1回実行してからphase buffを失効し、行動終了時statusを減衰する。

afterHealのlegacy発火基準は維持する。新版compilerのみ `heal.actual > 0` を暗黙条件に加える。
追加回復は `source: "afterHealBonus"` でafterHealを再発火させない。
回復イベント終了後は元のheal/attack contextへ戻す。後続の被命中Bが確定damageを参照できる。
通常攻撃用traitとbefore-attack optionはnormalAttackかつ非counterを条件にする。
攻撃命中後はafterDamageへcompileし、MISS/回避では発動しない。0damage命中・counterは対象。

HPコスト後は通常のfixedDamageと同じ扱いでpassive再評価を行う。生存保証や最低HP保証は追加していない。
phaseEnd AP変換にはHP閾値条件を設けない。A/C/D、0damage命中、counter、死亡後phase、特殊C判定順は変更しない。

## targeted tests

`node --test tests/bSkillProduction.test.mjs tests/bSkillCompiler.test.mjs tests/bSkillEngine.test.mjs tests/bSkillTestHarness.test.mjs`

変更した既存能力の回帰確認にはconditionEvaluator、bPassiveModifiers、randomStatusRemoval、buffDurationの各testを使用する。
