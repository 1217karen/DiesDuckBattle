# 新版B selection / catalog / compiler

`bSkillCatalog.js` は公開済み構造と合法な完成option、`bSkillCompiler.js` はID検証とengineデータ生成を担当する。
UI、登録buildとの接続、ポイント制は含めない。既存の `bSkill` / `bSkills` は引き続き使用できる。

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
after-take-hitのalwaysは指定status +1のみ、AP参照回復はmedium、AP消費回復と敵AP固定damageはhighのみ。

## productionと開発用仮値

各完成optionには `semantics.rules`、`optionAxes`、`tuning`、`tuningKinds` がある。
semanticsのtuning参照はcompilerが解決する内部表現であり、engineやselectionへ直接渡さない。
condition別optionは独立したtuningを持ち、厳しい条件に大きい効果量を割り当てられる。
productionの未確定値はすべてnull。検証は `valid: true, complete: false, unresolved: [...]`、
compileは `ok: false, bSkills: null` となり、0や1で穴埋めしない。

確定済みの構造上の値（status存在条件の1、被命中alwaysの+1、攻撃回数+1、実回復量>0）は固定する。
閾値、確率、stack数、repeat、AT量、回復量、AP消費量、最大HP消費率、passive補正、倍率・上下限は未確定。
AP参照回復はAPそのものを回復量に使い、`healCap` はnullなら未解決、trustedなfalseなら上限なし、非負整数なら上限あり。
buff総stack回復は既存byStatusCountへ `STATUS_GROUPS.buff` と未確定のperStackを渡す。

`bSkillDevFixtures.js` の `createBDevCatalog()` のみ仮値を注入する。**本番バランスではない**。
catalog引数は運営側の信頼境界であり、ユーザーが送ったcatalogを注入してはいけない。

```js
import { compileBSkill } from "../js/bSkillCompiler.js";
import { createBDevCatalog } from "../js/bSkillDevFixtures.js"; // 開発専用
const result = compileBSkill(selection, { catalog: createBDevCatalog() });
if (result.ok) battler.bSkills = result.bSkills;
```

成功結果は `{ valid: true, complete: true, ok: true, bSkills: [...], errors: [], unresolved: [] }`。
1つのtraitが複数ruleを生成でき、与被damage traitはbeforeAttack/beforeTakeDamageの2件になる。
HP/AP補正はcanonical passive、HP条件攻撃回数はbeforeRollへcompileする。
返されるruleは解決済みの独立objectで、catalogを変更しない。IDは完成optionとrule位置から生成する。
生のengine用B定義は引き続きlegacy/trustedデータ用であり、selection validatorの代替ではない。

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
HP閾値と消費率の大小関係、強条件/弱条件の数値順序はバランス未確定のため自動決定しない。
数値確定時はtrusted tuningの整合を運営側でレビューする。

## targeted tests

`node --test tests/bSkillCompiler.test.mjs tests/bSkillEngine.test.mjs`

変更した既存能力の回帰確認にはconditionEvaluator、bPassiveModifiers、randomStatusRemoval、buffDurationの各testを使用する。
