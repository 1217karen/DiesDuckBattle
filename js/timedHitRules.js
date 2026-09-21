// C等の信頼済み内部effectが生成する期限付き命中rule。静的B rulesとは独立。
export function addTimedHitRule(eff, ctx, emit) {
  const owner = eff.target === "enemy" ? ctx.enemy : ctx.actor;
  const count = eff.duration?.kind === "turns" ? eff.duration.count : null;
  if (!owner || !Number.isInteger(count) || count <= 0 || eff.effect?.type !== "changeStatus") return;
  owner.timedHitRules ??= [];
  const originSkill = ctx._originStack?.at(-1)?.originSkill ?? null;
  const rule = { id: eff.id ?? null, trigger: "afterNormalAttackResolved",
    duration: { kind: "turns", remainingTurns: count }, effect: structuredClone(eff.effect),
    originSkill: originSkill ? { ...originSkill } : null };
  owner.timedHitRules.push(rule);
  emit("timedRuleApplied", ctx.actor?.side ?? "system", { target: owner.side, id: rule.id, duration: { ...rule.duration } });
}

// 通常攻撃1回分のdamage・既存trigger・反撃が完了した位置だけから呼ぶ。
export function resolveTimedHitRules(owner, ctx, applyEffect) {
  const attack = ctx.attack;
  if (attack?.kind !== "normalAttack" || attack.isCounter || !attack.hit || attack.avoided || attack.miss) return;
  for (const rule of [...(owner.timedHitRules ?? [])]) {
    if (rule.duration.remainingTurns <= 0) continue;
    const groupId = ctx.newGroupId();
    ctx.withOrigin({ originSkill: rule.originSkill, groupId }, () => {
      ctx.push("timedRuleTriggered", owner.side, { id: rule.id, trigger: rule.trigger, groupId });
      applyEffect(rule.effect, ctx);
    });
  }
}

export function tickTimedHitRules(owner, push) {
  owner.timedHitRules = (owner.timedHitRules ?? []).filter(rule => {
    const before = rule.duration.remainingTurns;
    rule.duration.remainingTurns--;
    push("timedRuleTick", "system", { target: owner.side, id: rule.id, before, after: Math.max(0, rule.duration.remainingTurns) });
    if (rule.duration.remainingTurns > 0) return true;
    push("timedRuleExpired", "system", { target: owner.side, id: rule.id });
    return false;
  });
}
