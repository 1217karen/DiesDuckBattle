import test from "node:test";
import assert from "node:assert/strict";
import { createCSkillCatalog } from "../js/cSkillCatalog.js";
import { createCSkillRules } from "../js/cSkillRules.js";
import { createCDevCatalog, createCDevRules } from "../js/cSkillDevFixtures.js";
import { compileCSkill } from "../js/cSkillCompiler.js";
import { applyEffect } from "../js/effects.js";
import { C_TEST_FIELDS, runCSkillTestBattle } from "../js/cSkillTestHarness.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";

const catalog = createCDevCatalog(), rules = createCDevRules();
const choose = (effectId, values, chance) => {
  const definition = catalog.effects.find(e => e.id === effectId);
  return { effectId, options: Object.fromEntries(Object.entries(definition.optionAxes).map(([axis, set]) => {
    const option = catalog.optionSets[set].find(o => o.value === values[axis]);
    assert.ok(option, `${effectId}.${axis}: ${values[axis]}`); return [axis, option.id];
  })), ...(chance ? { chanceOptionId: String(chance) } : {}) };
};
const damage = amount => choose("damage-enemy", { amount });
const heal = amount => choose("heal-self", { amount });
const grant = (group, target, status, chance) => choose(`grant-${group}-${target}`, { status, amount: 3 }, chance);
const buff = (stat, target, sign, amount, duration) => choose(`turn-${stat}-${target}-${sign}`, { amount, duration });
const step = (baseAmount, everyTurns) => choose("turn-step-damage-enemy", { baseAmount, everyTurns, stepAmount: 10 });
const flat = effects => ({ mode: "normal", structure: { kind: "flat", effects } });
const random = branches => ({ mode: "normal", structure: { kind: "random", branches: branches.map(effects => ({ effects })) } });
const hp = (met, unmet) => ({ mode: "normal", structure: { kind: "hpCondition", thresholdOptionId: "dev-hpThreshold-0.5",
  branches: { met: { effects: met }, unmet: { effects: unmet } } } });
const compile = (s, overrides = {}) => compileCSkill(s, { catalog, rules, ...overrides });
const compiled = s => { const c = compile(s); assert.equal(c.ok, true, JSON.stringify(c)); return c.skill.effect; };
function context({ hp = 400, turn = 1, rng = () => .1 } = {}) {
  const fighter = (side, hp) => ({ side, hp, maxHP: 1000, ap: 0, buffs: [], status: Object.fromEntries(STATUS_GROUPS.all.map(k => [k, 0])) });
  const actor = fighter("P1", hp), enemy = fighter("P2", 1000), logs = [];
  const ctx = { actor, enemy, turn, phase: 1, rng, push: (type, side, extra) => logs.push({ type, side, ...extra }), helpers: {} };
  ctx.helpers.dealDamage = (target, amount) => { target.hp -= amount; logs.push({ type: "damage", target: target.side, amount }); };
  ctx.helpers.heal = (target, amount) => { target.hp = Math.min(target.maxHP, target.hp + amount); logs.push({ type: "healing", amount }); };
  return { ctx, actor, enemy, logs };
}
const execute = (s, options) => { const h = context(options); applyEffect(compiled(s), h.ctx); return h; };

// 旧effect量と分岐を基準。CS15系のstatus付与は新版では100%固定。旧CS03の固有onFailはlegacyテストだけ。
const fixtures = {
  HP70: flat([{ ...damage(70), chanceOptionId: "70" }]),
  CS11: random([[damage(60)], [damage(40), grant("buff", "self", "counter")]]),
  CS15: flat([...["crack", "roughWave", "Headwind", "steam"].map(status => grant("debuff", "enemy", status)),
    choose("debuff-total-damage-enemy", { multiplier: 5 })]),
  CS16: flat([step(10, 5), buff("df", "self", "up", 2, 2)]),
  CS18: random([[damage(60)], [heal(50), grant("buff", "self", "clean")],
    [buff("df", "enemy", "down", 3, 4), buff("at", "self", "up", 3, 4)]]),
  CS21: flat([damage(40), grant("debuff", "enemy", "@debuff"), grant("buff", "self", "@buff")]),
  CS23: hp([damage(60)], [heal(50)]),
  CS24: random([.2, .3, .4].map(amountPct => [choose("current-hp-damage-enemy", { amountPct })])),
  CS25: flat([step(40, 10), buff("df", "enemy", "down", 2, 4)]),
};
for (const [id, selection] of Object.entries(fixtures)) test(`${id}: dev selection→compiler→harness→実battle`, () => {
  const result = runCSkillTestBattle(selection, { catalog, rules,
    settings: { ...Object.fromEntries(C_TEST_FIELDS.map(f => [f.key, f.value])), p1HP: 400, maxTurns: 1 }, rng: () => .1 });
  assert.equal(result.compilation.ok, true);
  assert.ok(result.battle.events.some(e => e.type === "cSkillActivated"));
  assert.equal(result.battle.events.some(e => String(e.code).includes("UNSUPPORTED")), false);
  assert.equal(result.battle.events.some(e => e.type === "cSkillActivated" && e.actor === "P2"), false);
});

test("新版70ダメージは失敗14、自動failureは1leafのまま", () => {
  assert.equal(compile(fixtures.HP70).resources.effectCount, 1);
  for (const [roll, damage] of [[.699, 70], [.7, 14], [.99, 14]]) {
    const h = execute(fixtures.HP70, { rng: () => roll });
    assert.equal(h.enemy.hp, 1000 - damage); assert.equal(h.logs.filter(e => e.type === "chanceRoll").length, 1);
  }
});
test("CS11/CS18: 2/3択は等確率、複数effect枝を順に全実行、CS18合計5leaf", () => {
  assert.equal(compile(fixtures.CS18).resources.effectCount, 5);
  for (const [name, n] of [["CS11", 2], ["CS18", 3]]) {
    const counts = Array(n).fill(0);
    for (let i = 0; i < 60; i++) {
      const h = execute(fixtures[name], { rng: () => (i + .5) / 60 });
      const picked = h.logs.find(e => e.type === "randomPick"); counts[picked.index]++;
      assert.equal(picked.total, n);
      if (name === "CS11") { assert.equal(h.enemy.hp, picked.index === 0 ? 940 : 960); assert.equal(h.actor.status.counter, picked.index === 0 ? 0 : 3); }
      else if (picked.index === 0) assert.equal(h.enemy.hp, 940);
      else if (picked.index === 1) { assert.equal(h.actor.hp, 450); assert.equal(h.actor.status.clean, 3); }
      else { assert.equal(h.enemy.buffs[0].amount, -3); assert.equal(h.actor.buffs[0].amount, 3); assert.equal(h.actor.buffs[0].duration.remainingTurns, 4); }
    }
    assert.deepEqual(counts, Array(n).fill(60 / n));
  }
});
test("CS15能力: 確定付与→debuff総stack×5、buffは数えない", () => {
  const h = context({ rng: () => { throw new Error("statusは成功率抽選なし"); } }); h.enemy.status.focus = 3;
  applyEffect(compiled(fixtures.CS15), h.ctx);
  assert.equal(h.enemy.hp, 940);
  assert.deepEqual([h.enemy.status.crack, h.enemy.status.roughWave, h.enemy.status.Headwind, h.enemy.status.steam], [3, 3, 3, 3]);
  assert.equal(h.logs.filter(e => e.type === "chanceRoll").length, 0);
  assert.equal(compile(fixtures.CS15).resources.effectCount, 5);
});
for (const [id, base, every] of [["CS16", 10, 5], ["CS25", 40, 10]]) test(`${id}: turnStepの境界とDF buff`, () => {
  for (const turn of [1, every - 1, every, every + 1, every * 2]) {
    const h = execute(fixtures[id], { turn });
    assert.equal(h.enemy.hp, 1000 - base - Math.floor(turn / every) * 10);
    const b = id === "CS16" ? h.actor.buffs[0] : h.enemy.buffs[0];
    assert.equal(b.stat, "DF"); assert.equal(b.amount, id === "CS16" ? 2 : -2);
    assert.equal(b.duration.remainingTurns, id === "CS16" ? 2 : 4);
  }
});
test("CS21: random statusは付与だけ、trusted IDから@groupを生成", () => {
  const effect = compiled(fixtures.CS21);
  assert.deepEqual(effect.slice(1).map(e => e.status), ["@debuff", "@buff"]);
  const h = execute(fixtures.CS21); assert.equal(h.enemy.hp, 960);
  assert.equal(STATUS_GROUPS.debuff.reduce((sum, k) => sum + h.enemy.status[k], 0), 3);
  assert.equal(STATUS_GROUPS.buff.reduce((sum, k) => sum + h.actor.status[k], 0), 3);
  for (const id of ["clear-debuff-single-self", "timed-hit-debuff-enemy"]) {
    const def = catalog.effects.find(e => e.id === id);
    assert.equal(catalog.optionSets[def.optionAxes.status].some(o => o.value.startsWith("@")), false);
    assert.equal(compile(flat([{ effectId: id, options: { status: "random-debuff" } }])).ok, false);
  }
});
test("CS23: self HP>=50% / <50%、49.9%も未満、途中のHP変化で枝は切り替わらない", () => {
  assert.deepEqual(compiled(fixtures.CS23)[0].when, { left: "self.hpPct", op: ">=", right: .5 });
  for (const hp of [499, 500, 501]) {
    const h = execute(fixtures.CS23, { hp });
    assert.equal(h.enemy.hp, hp >= 500 ? 940 : 1000); assert.equal(h.actor.hp, hp >= 500 ? hp : hp + 50);
    assert.equal(h.logs.filter(e => e.type === "conditionalBranch").length, 1);
  }
  const crossDown = hp([choose("damage-self", { amount: 70 }), damage(30)], [heal(50)]);
  const a = execute(crossDown, { hp: 500 }); assert.equal(a.actor.hp, 430); assert.equal(a.enemy.hp, 970);
  const crossUp = hp([damage(60)], [heal(50), heal(50)]);
  const b = execute(crossUp, { hp: 499 }); assert.equal(b.actor.hp, 599); assert.equal(b.enemy.hp, 1000);
});
test("CS24: 3択の現在HP20/30/40%", () => {
  for (const [roll, amount] of [[.1, 200], [.5, 300], [.9, 400]]) assert.equal(execute(fixtures.CS24, { rng: () => roll }).enemy.hp, 1000 - amount);
});

test("normal reviveは全枝で拒否、specialはflatのみ", () => {
  const revive = choose("revive-self", { maxHpPct: .3 });
  for (const s of [random([[damage(10)], [revive]]), hp([damage(10)], [revive])]) {
    assert.ok(compile(s).errors.some(e => e.code === "MODE_UNAVAILABLE"));
    assert.ok(compile({ ...s, mode: "special" }).errors.some(e => e.code === "SPECIAL_FLAT_ONLY"));
  }
  const result = runCSkillTestBattle({ ...flat([revive]), mode: "special" }, { catalog, rules: { ...rules, repeatReviveChance: .5 },
    settings: { ...Object.fromEntries(C_TEST_FIELDS.map(f => [f.key, f.value])), p1HP: -100, p1Dice: 0, p2Dice: 0, maxTurns: 1 }, rng: () => .1 });
  assert.equal(result.battle.events.find(e => e.type === "revived").hpAfter, 300);
});
test("2/3択のみ、全branchの選択leaf合計5、branchは非空でnest不可", () => {
  for (const n of [0, 1, 4]) assert.equal(compile(random(Array.from({ length: n }, () => [damage(10)]))).ok, false);
  assert.equal(compile(random([[damage(10), damage(10), damage(10)], [heal(10), heal(10), heal(10)]])).ok, false);
  assert.equal(compile(random([[], [damage(10)]])).ok, false);
  const withChance = { ...damage(70), chanceOptionId: "70" };
  const five = random([[withChance, damage(10)], [heal(10), heal(10), heal(10)]]);
  assert.equal(compile(five).resources.effectCount, 5); assert.equal(compile(five).ok, true);
  five.structure.branches[1].effects.push(heal(10));
  assert.ok(compile(five).errors.some(e => e.code === "EFFECT_COUNT"));
  for (const nested of [random([[damage(10)], [damage(30)]]).structure, hp([damage(10)], [heal(10)]).structure]) {
    assert.equal(compile(random([[nested], [damage(10)]])).ok, false);
    const s = random([[damage(10)], [damage(30)]]); s.structure.branches[0].structure = nested;
    assert.equal(compile(s).ok, false);
  }
});
test("chanceはIDのみ、drawback低確率不可、ユーザーonFailは全形式を拒否", () => {
  for (const chance of ["70", "25", "50"]) {
    assert.equal(compile(flat([{ ...choose("damage-self", { amount: 30 }), chanceOptionId: chance }])).ok, false);
  }
  for (const fallback of [[damage(30)], { ...damage(30), chanceOptionId: "100" }, { ...damage(30), onFail: damage(10) },
    { ...damage(30), structure: { kind: "flat", effects: [damage(10)] } }, random([[damage(10)], [damage(30)]]).structure]) {
    assert.equal(compile(flat([{ ...damage(70), chanceOptionId: "70", onFail: fallback }])).ok, false);
  }
  assert.equal(compile(flat([{ ...damage(70), onFail: damage(30) }])).ok, false);
  assert.equal(compile(flat([{ ...damage(70), chanceOptionId: .8 }])).ok, false);
  assert.equal(compile(flat([{ ...damage(70), chanceOptionId: "unknown" }])).ok, false);
});
test("全階層のraw injection拒否、旧新版flat DTOも明示的に移行が必要", () => {
  for (const field of ["onFail", "failureRate", "failureEffect", "failureMultiplier", "apDiscount", "chanceDiscount", "effect", "target", "value", "chance", "when", "condition", "randomPick", "picks", "turnStep", "byStatusCount", "costAP", "apDelta", "repeat", "repeatReviveChance"]) {
    const base = random([[damage(10)], [heal(10)]]);
    const variants = [s => s, s => s.structure, s => s.structure.branches[0], s => s.structure.branches[0].effects[0],
      s => s.structure.branches[0].effects[0].options];
    for (const locate of variants) { const s = structuredClone(base); locate(s)[field] = 1; assert.equal(compile(s).ok, false, field); }
  }
  for (const key of ["target", "left", "condition", "threshold"]) {
    const s = structuredClone(fixtures.CS23); s.structure[key] = "enemy.hpPct"; assert.equal(compile(s).ok, false);
  }
  assert.equal(compile({ mode: "normal", effects: [damage(10)] }).ok, false);
  assert.equal(compile(flat([{ type: "fixedDamage", amount: 10 }])).ok, false);
  assert.equal(compile(flat([{ effectId: "repeat", options: {} }])).ok, false);
  assert.equal(catalog.effects.some(e => e.semantics.type === "repeat"), false);
});
test("production価格確定、trusted fixtureのnullは最終AP=0にしない", () => {
  const prod = createCSkillCatalog(), pr = createCSkillRules();
  for (const set of ["hpThreshold", "statusMultiplier", "stepBaseAmount", "stepEveryTurns", "stepAmount"]) assert.ok(prod.optionSets[set].length);
  assert.deepEqual(prod.chanceOptions.map(o => o.value), [1, .7, .5, .25]);
  assert.equal(pr.branchAggregation, "sum");
  for (const s of [fixtures.CS11, fixtures.CS23]) {
    const r = compile(s, { rules: pr }); assert.equal(r.ok, true);
  }
  for (const [s, field] of [[fixtures.CS11, "branchAggregation"]]) {
    assert.equal(compile(s, { rules: { ...rules, [field]: null } }).resources.requiredAP, null);
  }
  for (const kind of ["random2", "hpCondition"]) {
    const s = kind === "random2" ? fixtures.CS11 : fixtures.CS23;
    assert.equal(compile(s, { rules: { ...rules, branchAPDelta: { ...rules.branchAPDelta, [kind]: null } } }).resources.requiredAP, null);
  }
  for (const [s, set] of [[fixtures.CS23, "hpThreshold"], [fixtures.CS15, "statusMultiplier"], [fixtures.CS16, "stepBaseAmount"],
    [fixtures.CS16, "stepEveryTurns"], [fixtures.CS16, "stepAmount"]]) {
    const c = createCDevCatalog(); c.optionSets[set].forEach(o => { o.apDelta = null; });
    assert.equal(compile(s, { catalog: c }).resources.requiredAP, null);
  }
  const c = createCDevCatalog(); c.chanceOptions.find(o => o.value === .7).apDiscount = null;
  assert.equal(compile(fixtures.HP70, { catalog: c }).resources.requiredAP, null);
});
test("legacy repeat/chance/onFail/when/randomPickは従来の実行経路を保持（CS02は新版公開しない）", () => {
  const h = context({ rng: () => .1 });
  applyEffect({ type: "fixedDamage", target: "enemy", amount: 9, repeat: 9, chance: .5 }, h.ctx);
  assert.equal(h.enemy.hp, 919); assert.equal(h.logs.filter(e => e.type === "chanceRoll").length, 9);
  const fail = context({ rng: () => .9 });
  applyEffect({ type: "fixedDamage", target: "enemy", amount: 70, chance: .8, onFail: { type: "fixedDamage", target: "enemy", amount: 30 } }, fail.ctx);
  assert.equal(fail.enemy.hp, 970);
  const legacy = context({ hp: 500 });
  applyEffect([{ type: "fixedDamage", target: "enemy", amount: 60, when: { left: "self.hpPct", op: ">=", right: .5 } },
    { type: "heal", target: "self", amount: 50, when: { left: "self.hpPct", op: "<=", right: .49 } }], legacy.ctx);
  assert.equal(legacy.enemy.hp, 940); assert.equal(legacy.actor.hp, 500);
});
