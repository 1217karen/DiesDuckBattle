// statsUtil.js
export const HP_FORMULA = {
  base: 100,
  AT: 25,
  DF: 30,
  SP: -10,
  min: 1,
  max: 999,
};

export function calcMaxHPFromStats(stats) {
  const at = Number(stats?.AT ?? 0);
  const df = Number(stats?.DF ?? 0);
  const sp = Number(stats?.SP ?? 0);

  let hp =
    (HP_FORMULA.base ?? 0) +
    at * (HP_FORMULA.AT ?? 0) +
    df * (HP_FORMULA.DF ?? 0) +
    sp * (HP_FORMULA.SP ?? 0);

  hp = Math.trunc(hp);
  return Math.max(HP_FORMULA.min ?? 1, Math.min(HP_FORMULA.max ?? hp, hp));
}
