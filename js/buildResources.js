import { createBuildRules } from "./buildRules.js";
import { getDiceFrame } from "./diceFrames.js";

/**
 * 作成資源の純粋な計算。入力・設定を変更せず、0も取り除かない。
 * stats/diceは独立に計算し、型不正・不明素体・安全な整数範囲外は該当欄をnullにする。
 * 負の残高はそのまま返す（0への補正で不足を隠さない）。
 * 合法性の判定ではない。出目範囲・枠数・個数上限等はvalidateBuildで検査する。
 * 運営側設定の不正はTypeError。rulesをユーザーから受け取らないこと。
 */
export function calculateBuildResources(build, rules = createBuildRules()) {
  const { dicePointsPerEmpty, dicePointsPerTriple } = rules.resources;
  for (const value of [rules.stats.totalMax, dicePointsPerEmpty, dicePointsPerTriple]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid resource rule");
  }
  let stats = null;
  let dice = null;
  const frame = getDiceFrame(build?.diceFrame);
  const at = build?.stats?.AT;
  const df = build?.stats?.DF;
  if (frame && Number.isSafeInteger(at) && Number.isSafeInteger(df)) {
    const used = at + df + frame.SP;
    const remaining = rules.stats.totalMax - used;
    if (Number.isSafeInteger(used) && Number.isSafeInteger(remaining)) {
      stats = { sp: frame.SP, used, remaining };
    }
  }
  if (Array.isArray(build?.dice)) {
    let emptyCount = 0;
    const counts = new Map();
    let validNumbers = true;
    for (const face of build.dice) {
      if (!Number.isSafeInteger(face)) { validNumbers = false; break; }
      if (face === 0) emptyCount++;
      else counts.set(face, (counts.get(face) ?? 0) + 1);
    }
    if (validNumbers) {
      // 3個以上の非0出目は種類ごとに課金。4個以上は別途validatorが拒否する。
      const tripleCount = [...counts.values()].filter(count => count >= 3).length;
      const earned = emptyCount * dicePointsPerEmpty;
      const spent = tripleCount * dicePointsPerTriple;
      const remaining = earned - spent;
      if ([earned, spent, remaining].every(Number.isSafeInteger)) {
        dice = { emptyCount, tripleCount, earned, spent, remaining };
      }
    }
  }
  return { stats, dice };
}
