// Bのwhenと個別effect.whenが共有する条件DSL。状態を変更せず、発動やAP消費は行わない。
// 既存仕様: null/undefinedはtrue、all優先、空all=true/空any=false。
// == / != は厳密比較、大小比較はNumber変換。未知pathはundefinedのまま比較する。
export function evaluateCondition(spec, ctx) {
  if (spec == null) return true;
  if (spec && typeof spec === "object") {
    if (Array.isArray(spec.all)) return spec.all.every(item => evaluateCondition(item, ctx));
    if (Array.isArray(spec.any)) return spec.any.some(item => evaluateCondition(item, ctx));
  }
  if (!spec || typeof spec !== "object") return false;
  const left = readConditionValue(String(spec.left ?? ""), ctx);
  const right = spec.right;
  switch (String(spec.op ?? "==")) {
    case "==": return left === right;
    case "!=": return left !== right;
    case ">=": return Number(left) >= Number(right);
    case "<=": return Number(left) <= Number(right);
    case ">": return Number(left) > Number(right);
    case "<": return Number(left) < Number(right);
    default: return false;
  }
}

// 任意のドットpathを辿らず、公開した項目だけ読む。
export function readConditionValue(path, ctx) {
  if (typeof path !== "string") return undefined;
  for (const [side, fighter] of [["self", ctx?.actor], ["enemy", ctx?.enemy]]) {
    for (const [prefix, values] of [
      ["status:", fighter?.status],
      ["cdTurn:", fighter?.cooldowns?.turn],
      ["cdPhase:", fighter?.cooldowns?.phase],
    ]) {
      const fullPrefix = `${side}.${prefix}`;
      if (path.startsWith(fullPrefix)) {
        const key = path.slice(fullPrefix.length).trim();
        return Number(values?.[key] ?? 0);
      }
    }
    if (path === `${side}.hpPct`) {
      const hp = fighter?.hp;
      const max = fighter?.maxHP;
      // 通常の有限数値では旧B/effect双方と同じ。不正なHPはeffects側のガードへ統一。
      if (!Number.isFinite(hp) || !Number.isFinite(max) || max <= 0) return undefined;
      return hp / max;
    }
    for (const key of ["hp", "ap", "at", "df", "sp", "actionsThisTurn"]) {
      if (path === `${side}.${key}`) return fighter?.[key];
    }
  }
  switch (path) {
    case "turn": return ctx?.turn;
    case "phase": return ctx?.phase;
    case "dice": return ctx?.diceValue;
    // 既存Bスキルの参照を維持。
    case "self.nextAttackATPlus": return ctx?.actor?.nextAttackATPlus ?? 0;
    case "attack.kind": return ctx?.attack?.kind;
    case "attack.dice": return ctx?.attack?.dice;
    case "attack.damage": return ctx?.attack?.damage;
    case "attack.hit": return ctx?.attack?.hit;
    case "attack.avoided": return ctx?.attack?.avoided;
    case "attack.isCounter": return ctx?.attack?.isCounter;
    default: return undefined;
  }
}
