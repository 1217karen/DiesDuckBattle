import { evaluateCondition, readConditionValue } from "./conditionEvaluator.js";

// 旧入力の解釈だけを分離。canonical評価に用途別のtrigger分岐を持ち込まない。
export function normalizeBPassive(skill) {
  if (skill?.trigger === "passive") return skill.modifier ?? null;
  if (skill?.trigger === "passiveHp" && skill.hpCond && skill.bonus) {
    const op = String(skill.hpCond.op ?? ">=");
    const right = Number(skill.hpCond.value);
    if (![">=", "<="].includes(op) || !Number.isFinite(right)) return null;
    return { kind: "conditional", when: { left: "self.hpPct", op, right },
      bonus: { AT: Math.trunc(Number(skill.bonus.AT ?? 0)), DF: Math.trunc(Number(skill.bonus.DF ?? 0)) } };
  }
  if (skill?.trigger === "passiveAp" && skill.apBonus) {
    const spec = skill.apBonus;
    return { kind: "scaled", source: "self.ap", targetStat: String(spec.stat ?? "DF"),
      scale: 1, offset: Math.trunc(Number(spec.bias ?? 0)),
      min: Math.trunc(Number(spec.min ?? -999)), max: Math.trunc(Number(spec.max ?? 999)),
      sourceRounding: "trunc" }; // 旧APの整数化だけを互換として保持。
  }
  return null;
}

export function readModifierSource(path, ctx) {
  if (typeof path !== "string") return undefined;
  const total = /^(self|enemy)\.statusTotal:(debuff|buff)$/.exec(path);
  if (total) {
    return readConditionValue(path, ctx);
  }
  if (/^(self|enemy)\.(ap|status:.+)$/.test(path)) return readConditionValue(path, ctx);
  return undefined;
}

// 純粋評価。effectを実行せずbuffも生成しない。価格・公開候補はここでは扱わない。
export function evaluateBModifier(modifier, ctx) {
  const none = { active: false, AT: 0, DF: 0 };
  if (modifier?.kind === "conditional") {
    const AT = Number(modifier.bonus?.AT ?? 0);
    const DF = Number(modifier.bonus?.DF ?? 0);
    if (!Number.isFinite(AT) || !Number.isFinite(DF)) return none;
    const active = evaluateCondition(modifier.when, ctx);
    return { active, AT: active ? AT : 0, DF: active ? DF : 0 };
  }
  if (modifier?.kind === "scaled" && ["AT", "DF"].includes(modifier.targetStat)) {
    let value = readModifierSource(modifier.source, ctx);
    if (!Number.isFinite(value)) return none;
    if (modifier.sourceRounding === "trunc") value = Math.trunc(value);
    const scale = Number(modifier.scale ?? 1), offset = Number(modifier.offset ?? 0);
    const min = Number(modifier.min ?? -Infinity), max = Number(modifier.max ?? Infinity);
    if (!Number.isFinite(scale) || !Number.isFinite(offset) || Number.isNaN(min) || Number.isNaN(max) || min > max) return none;
    const amount = Math.max(min, Math.min(max, value * scale + offset));
    if (!Number.isFinite(amount)) return none;
    return { ...none, active: true, [modifier.targetStat]: amount, sourceValue: value };
  }
  return none;
}

// 呼出ctxのactorが受動側へ入れ替わっていても、各B所有者をselfとして評価する。
export function refreshPassiveBonuses(ctx, fighter) {
  if (!ctx || !fighter) return;
  const enemy = ctx.actor === fighter ? ctx.enemy : ctx.actor;
  const ownCtx = { ...ctx, actor: fighter, enemy };
  fighter.runtime ??= {};
  const cache = fighter.runtime.passive ??= { AT: 0, DF: 0 };
  const previous = cache.modifiers ?? [];
  const next = [];
  const skills = Array.isArray(fighter.battler?.bSkills) ? fighter.battler.bSkills
    : fighter.battler?.bSkill ? [fighter.battler.bSkill] : [];
  let AT = 0, DF = 0;
  skills.forEach((skill, index) => {
    const modifier = normalizeBPassive(skill);
    if (!modifier) return;
    // canonicalには0ターン目を公開しない。初期化中は無効・無ログ、1ターン目AP加算後に初評価。
    if (skill.trigger === "passive" && ctx.turn < 1) return;
    const result = evaluateBModifier(modifier, ownCtx);
    const before = previous[index] ?? { active: false, AT: 0, DF: 0 };
    next[index] = result; // IDではなく定義位置で識別。同一IDも独立に評価・加算。
    AT += result.AT; DF += result.DF;
    const changed = modifier.kind === "conditional" ? before.active !== result.active
      : before.AT !== result.AT || before.DF !== result.DF;
    if (!changed) return;
    const skillInfo = { owner: fighter.side, category: "B", skillId: skill.id ?? null,
      skillName: skill.name ?? "(B-skill passive)" };
    const groupId = ctx.newGroupId?.() ?? null;
    const emit = () => ctx.push(modifier.kind === "conditional" ? "passiveSkillStateChanged" : "passiveModifierChanged", fighter.side, {
      code: modifier.kind === "conditional" ? (result.active ? "PASSIVE_SKILL_ON" : "PASSIVE_SKILL_OFF") : "PASSIVE_MODIFIER_CHANGED",
      target: fighter.side, skill: skillInfo, modifierIndex: index, modifierKind: modifier.kind,
      active: result.active, hpPct: readConditionValue("self.hpPct", ownCtx),
      bonus: modifier.kind === "conditional" ? { ...modifier.bonus } : { AT: result.AT, DF: result.DF },
      before: { AT: before.AT, DF: before.DF }, after: { AT: result.AT, DF: result.DF },
      sourceValue: result.sourceValue, groupId,
    });
    if (ctx.withOrigin) ctx.withOrigin({ originSkill: skillInfo, groupId }, emit); else emit();
  });
  const before = { AT: cache.AT ?? 0, DF: cache.DF ?? 0 };
  cache.AT = AT; cache.DF = DF; cache.modifiers = next;
  if (before.AT !== AT || before.DF !== DF) ctx.push("passiveBonusTotalChanged", fighter.side, {
    code: "PASSIVE_BONUS_TOTAL_CHANGED", target: fighter.side, before, after: { AT, DF },
  });
}
