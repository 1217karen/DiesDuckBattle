// ruleEngine.js
// スキル処理の責務（このファイルの範囲）
// - Triggers 定義（文字列の列挙）
// - runTrigger: 指定トリガーに一致する「self側の rules」だけを評価して発動させる
//   - ctx.actor / ctx.enemy をここで上書きしてから実行する（副作用あり）
//   - 発動ログ（skillTriggered）を1つ積み、その後のeffectログには originSkill と groupId が付く
// - data（battler / duck）→ 内部 rules への変換（compile）
//
// ※ effect の実行そのものは effects.js に委譲する


import { applyEffect } from "./effects.js";
import { evaluateCondition } from "./conditionEvaluator.js";

export const Triggers = {
  // === システム進行 ===
  battleStart: "battleStart",     // 戦闘開始時
  turnStart: "turnStart",         // ターン開始時
  phaseStart: "phaseStart",       // フェイズ開始時
  phaseEnd: "phaseEnd",   // フェイズ終了時（行動終了後）

  // 状態処理の前後（行動者側）
  beforeStatus: "beforeStatus",   // 状態処理の直前
  afterStatus: "afterStatus",     // 状態処理の直後

  // === 行動者（能動）側 ===
  beforeRoll: "beforeRoll",       // ダイス前
  afterRoll: "afterRoll",         // ダイス後
  beforeAttack: "beforeAttack",   // 攻撃前（ヒット判定前）
  afterHit: "afterHit",           // ヒット確認後
  afterDamage: "afterDamage",     // ダメージ確定後（与ダメ確定）
  afterHeal: "afterHeal",         //回復後

  // === 防御側（受動）側 ===
  beforeTakeDamage: "beforeTakeDamage", // ダメージ適用前
  afterTakeDamage: "afterTakeDamage",   // ダメージ適用後

  // === ターン終端 ===
  beforeTurnEnd: "beforeTurnEnd", // ターン終了前（勝敗判定前）
};

/*
ルール構造（内部）
{
owner: "P1"|"P2",
category: "D"|"A"|"B"|"C",
id, name, description,
trigger: Triggers.*,
when: (ctx) => boolean,
apply: (ctx) => void
}
 */
export function runTrigger(triggerName, self, enemy, ctx, getRules) {
  const rules = getRules(self.side);
  ctx.actor = self;
  ctx.enemy = enemy;

  for (const r of rules) {
    if (r.trigger !== triggerName) continue;
    if (typeof r.when === "function" && !r.when(ctx)) continue;

    const skillInfo = {
      owner: self.side,
      category: r.category,
      skillId: r.id,
      skillName: r.name,
    };

    // このスキル発動に紐づくログを束ねるID
    const groupId = ctx.newGroupId();

    // スキル発動ログ（親）
    ctx.push("skillTriggered", self.side, {
      code: "SKILL_TRIGGERED",
      skill: { category: r.category, skillId: r.id, skillName: r.name },
      trigger: triggerName,
      groupId,
    });

    // 以降の effect ログは自動で originSkill と groupId が付く
    ctx.withOrigin({ originSkill: skillInfo, groupId }, () => {
      r.apply(ctx);
    });
  }
}

/* =========================
   data → rules 変換（最小）
   - D：battler.dSkill を battleStart で発動する rule にcompileする
   - A：duck.aSkill を afterRoll（ダイス条件 + Headwind判定）で発動する rule にcompileする
   - B：battler.bSkill / battler.bSkills を rule にcompileする
   - C：ここではcompileしない（別エンジン側が直接扱う前提）
========================= */

export function compileAllRulesForFighter(f) {
  const out = [];

  /* ----- D：Battler.dSkill(battleStart) ----- */
  if (f.battler?.dSkill?.effect) {
    const ds = f.battler.dSkill;

    out.push({
      owner: f.side,
      category: "D",
      id: ds.id,
      name: ds.name,
      description: ds.description,
      trigger: Triggers.battleStart,
      when: () => true,
      apply: (ctx) => {
        applyEffect(ds.effect, ctx);
      },
    });
  }

  /* ----- A：duck.aSkill(afterRoll) ----- */
  const aSkill = f.duck?.aSkill;

  if (aSkill?.effect) {
    out.push({
      owner: f.side,
      category: "A",
      id: aSkill.id,
      name: aSkill.name,
      description: aSkill.description,
      trigger: Triggers.afterRoll,

      when: (ctx) => {
        const matched = matchDiceTrigger(aSkill.trigger, ctx.diceValue);
        if (!matched) return false;

        const canceled = rollCancelASkillByHeadwind(ctx);
        return !canceled;
      },

      apply: (ctx) => {
        applyEffect(aSkill.effect, ctx);
      },
    });
  }

/* ----- B：battler.bSkill / battler.bSkills -----
仕様（このファイル側）：
- Bスキルは単体（bSkill）/複数（bSkills）どちらも受け取る
- trigger は Triggers に含まれる文字列のみ有効
  - Triggers に無い trigger（タイポ/未知）は黙ってスキップされる
- trigger === "passiveHp" のような常時バフ系は、ここでは扱わない想定
  （battleEngine 側の refreshPassiveBonuses() 等で別処理される）
*/


  const bSkillSingle = f.battler?.bSkill ?? null;
  const bSkillList = Array.isArray(f.battler?.bSkills)
    ? f.battler.bSkills
    : null;

  const bSkills = bSkillList ?? (bSkillSingle ? [bSkillSingle] : []);

  for (const bs of bSkills) {
    if (!bs || !bs.effect) continue;

    const trigger = String(bs.trigger ?? "");
    if (!Object.values(Triggers).includes(trigger)) continue;

    const whenFn = compileWhen(bs.when);

    out.push({
      owner: f.side,
      category: "B",
      id: bs.id ?? null,
      name: bs.name ?? "(B-skill)",
      description: bs.description ?? "",
      trigger,
      when: whenFn,
      apply: (ctx) => {
        applyEffect(bs.effect, ctx);
      },
    });
  }

  return out;
}

/* =========================
   A用：ダイス条件（文字列仕様）
   - onDiceIn:1,2,3
   - onDiceNotIn:1,2,3
   - onDice>= 3 / onDice<= 3 / onDice> 3 / onDice< 3
   - onDice= 3 / onDice!= 3
   - 未知の形式は false（発動しない）
========================= */

function matchDiceTrigger(trigger, diceValue) {
  const t = String(trigger ?? "").trim();
  if (!t) return false;
  if (diceValue == null) return false;

  // 1) onDiceIn
  if (t.startsWith("onDiceIn:")) {
    const list = t
      .slice("onDiceIn:".length)
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    return list.includes(diceValue);
  }

  // 2) onDiceNotIn
  if (t.startsWith("onDiceNotIn:")) {
    const list = t
      .slice("onDiceNotIn:".length)
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    return !list.includes(diceValue);
  }

  // 3) 比較系
  let m = /^onDice(>=|<=|>|<)\s*(-?\d+)$/.exec(t);
  if (m) {
    const op = m[1];
    const n = Number(m[2]);
    if (!Number.isFinite(n)) return false;
    if (op === ">=") return diceValue >= n;
    if (op === "<=") return diceValue <= n;
    if (op === ">") return diceValue > n;
    if (op === "<") return diceValue < n;
  }

  // 4) 等価/不等価
  m = /^onDice(!=|=)\s*(-?\d+)$/.exec(t);
  if (m) {
    const op = m[1];
    const n = Number(m[2]);
    if (!Number.isFinite(n)) return false;
    if (op === "=") return diceValue === n;
    if (op === "!=") return diceValue !== n;
  }

  // 未知は false
  return false;
}

// Bのwhenを共通DSLへ委譲。triggerやpassiveHp/passiveApの扱いは変更しない。
function compileWhen(spec) {
  return (ctx) => evaluateCondition(spec, ctx);
}

// =========================
// 逆風（Headwind）：Aスキル発動を確率でキャンセル（スタックは全消費）
// - Aスキルの発動判定（afterRollのwhen）の直前にチェック
// - 成否に関わらずスタックを全消費する
// - スタックが多いほどキャンセル確率UP（20%×n、上限95%）
// 戻り値：true なら「Aスキルをキャンセル」
// ※ ログ上は actionCanceled を出すが、ここで止めているのはAスキル発動のみ
// =========================

function rollCancelASkillByHeadwind(ctx) {
  const actor = ctx?.actor;
  const stacks = Number(actor?.status?.Headwind ?? 0);
  if (!Number.isFinite(stacks) || stacks <= 0) return false;

  const before = Math.trunc(stacks);

  // 全消費
  actor.status.Headwind = 0;

  // 消費ログ
  ctx.push("statusChange", "system", {
    code: "STATUS_CONSUMED_ON_TRIGGER",
    target: actor.side,
    status: "Headwind",
    before,
    after: 0,
    consumeKind: "trigger",
  });

  // 判定
  const clampFn =
    ctx.helpers?.clamp ??
    ((v, lo, hi) => Math.max(lo, Math.min(hi, v)));

  const prob = clampFn(0.2 * before, 0, 0.95);
  const ok =
    (typeof ctx?.rng === "function" ? ctx.rng() : Math.random()) < prob;

  ctx.push("headwindResult", "system", {
    code: "STATUS_HEADWIND_ROLL",
    target: actor.side,
    status: "Headwind",
    stacks: before,
    success: ok, // trueならキャンセル
    probability: prob,
    canceled: ok,
  });

  if (ok) {
    ctx.push("actionCanceled", "system", {
      code: "ACTION_CANCELED_HEADWIND",
      target: actor.side,
      reason: "Headwind",
    });
  }

  return ok;
}
