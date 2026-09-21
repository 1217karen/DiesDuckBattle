import test from "node:test";
import assert from "node:assert/strict";
import { runBattle } from "../js/battleEngine.js";
import { applyEffect } from "../js/effects.js";

const first = { all: [{ left: "turn", op: "==", right: 1 }, { left: "phase", op: "==", right: 1 }] };
const turn1 = { left: "turn", op: "==", right: 1 };
const rule = (id, trigger, effect, when = first) => ({ id, name: id, trigger, effect, when });
const buff = (stat, amount, duration = { kind: "phase" }, target = "self") =>
  ({ type: "addBuff", stat, amount, duration, target, id: "same-id", source: "same-source" });
const ap = { type: "changeValue", key: "ap", op: "add", value: 1 };
function battle(bSkills = [], { maxTurns = 1, rng = () => 0.9, aSkill } = {}) {
  return runBattle({
    p1: { battlerId: "b1", duckId: "d1" }, p2: { battlerId: "b2", duckId: "d2" },
    data: { BATTLERS: [{ id: "b1", bSkills }, { id: "b2" }], DUCKS: [
      { id: "d1", stats: { AT: 5, DF: 5, SP: 2, maxHP: 1000 }, dice: [1], aSkill },
      { id: "d2", stats: { AT: 5, DF: 5, SP: 1, maxHP: 1000 }, dice: [1] },
    ] }, field: "test-no-field", maxTurns, rng,
  }).events;
}
const damage = events => events.filter(e => e.type === "normalDamage" && e.actor === "P1").map(e => e.value);

for (const [stat, amount, target] of [["AT", 2, "self"], ["DF", -2, "enemy"]]) {
  test(`phase ${target} ${stat}${amount}は現在phaseだけ有効`, () => {
    const events = battle([rule("buff", "beforeDiceResolve", buff(stat, amount, undefined, target))]);
    assert.deepEqual(damage(events), [4, 1]);
    const expired = events.find(e => e.type === "buffExpired");
    assert.equal(expired.phase, 1);
    assert.equal(expired.target, target === "self" ? "P1" : "P2");
    assert.equal(events.some(e => e.type === "buffTick"), false);
  });
}
test("phaseEnd中も補正を保持し、そこで新規付与した分も直後に消去", () => {
  const events = battle([rule("start", "phaseStart", buff("AT", 2)),
    rule("end", "phaseEnd", buff("AT", 1))]);
  assert.deepEqual(damage(events), [4, 1]);
  const end = events.findIndex(e => e.type === "buffApplied" && e.amount === 1);
  const expires = events.map((e, i) => [e, i]).filter(([e]) => e.type === "buffExpired");
  assert.equal(expires.length, 2);
  assert.ok(expires.every(([e, i]) => e.phase === 1 && i > end));
});
test("荒波キャンセルでもself/enemyのphase補正は両方消去", () => {
  const events = battle([rule("cancel", "phaseStart", [buff("AT", 2), buff("DF", -2, undefined, "enemy"),
    { type: "changeStatus", target: "self", status: "roughWave", op: "set", value: 1 }])], { rng: () => 0 });
  assert.ok(events.some(e => e.type === "actionCanceled" && e.phase === 1));
  assert.equal(events.filter(e => e.type === "buffExpired" && e.phase === 1).length, 2);
  assert.equal(events.some(e => e.type === "buffTick"), false);
});
for (const count of [1, 2]) {
  test(`turns:${count}はturn末ごと減算し0で消える`, () => {
    const events = battle([rule("buff", "beforeDiceResolve", buff("AT", 2, { kind: "turns", count }))], { maxTurns: 3 });
    assert.deepEqual(events.filter(e => e.type === "buffTick").map(e => [e.turn, e.before, e.after]),
      count === 1 ? [[1, 1, 0]] : [[1, 2, 1], [2, 1, 0]]);
    assert.deepEqual(damage(events), count === 1 ? [4, 3, 2, 1, 2, 1] : [4, 3, 4, 3, 2, 1]);
  });
}
test("turnEnd付与は次ターンの減算まで有効", () => {
  const events = battle([rule("buff", "turnEnd", buff("AT", 2, { kind: "turns", count: 1 }), turn1)], { maxTurns: 3 });
  assert.deepEqual(damage(events), [2, 1, 4, 3, 2, 1]);
  assert.deepEqual(events.filter(e => e.type === "buffTick").map(e => e.turn), [2]);
});
for (const other of [1, -1]) {
  test(`同一id/sourceのAT+2とAT${other}も独立して単純加算`, () => {
    const events = battle([rule("buff", "beforeDiceResolve", [buff("AT", 2), buff("AT", other)])]);
    assert.deepEqual(damage(events), [4 + other, 1]);
    assert.equal(events.filter(e => e.type === "buffExpired").length, 2);
  });
}
test("phaseとturn補正も同じ計算に加算、旧turns入力も有効", () => {
  const events = battle([rule("buff", "beforeDiceResolve", [buff("AT", 2),
    { type: "addBuff", stat: "AT", amount: 1, turns: 2 }])], { maxTurns: 3 });
  assert.deepEqual(damage(events), [5, 2, 3, 2, 2, 1]);
});
test("旧A tempDfPlus入力は現在攻撃phaseのDF補正へ移行", () => {
  const events = battle([], { aSkill: { id: "old", trigger: "onDice=1", effect:
    { type: "changeValue", target: "enemy", key: "tempDfPlus", op: "add", value: -2 } } });
  assert.deepEqual(damage(events), [4, 3]);
  assert.deepEqual(events.filter(e => e.type === "buffExpired").map(e => e.phase), [1, 3]);
});
test("旧tempDfPlus set/min/maxは互換分のみ更新し通常DF buffを保持", () => {
  const actor = { side: "P1", buffs: [] };
  const ctx = { actor, enemy: {}, push() {} };
  applyEffect(buff("DF", 2), ctx);
  for (const [op, value] of [["add", -2], ["setMin", -3], ["setMax", -1], ["set", -2]])
    applyEffect({ type: "changeValue", key: "tempDfPlus", op, value }, ctx);
  assert.equal(actor.buffs.reduce((s, b) => s + b.amount, 0), 0);
  assert.ok(actor.buffs.every(b => b.duration.kind === "phase"));
  assert.equal(actor.temp?.dfPlus, undefined);
});
test("HP直接変更の直後にpassiveHpがON/OFFを再判定", () => {
  const events = battle([
    { id: "passive", trigger: "passiveHp", hpCond: { op: "<=", value: 0.5 }, bonus: { AT: 2 } },
    rule("hp", "beforeDiceResolve", { type: "changeValue", key: "hp", op: "set", value: 400 }),
    rule("restore", "phaseEnd", { type: "changeValue", key: "hp", op: "set", value: 1000 }),
  ]);
  assert.deepEqual(damage(events), [4, 1]);
  assert.deepEqual(events.filter(e => e.type === "passiveSkillStateChanged").map(e => e.active), [true, false]);
});
for (const trigger of ["battleStart", "turnStart", "beforeTurnEnd", "turnEnd"]) {
  test(`${trigger}のhealからafterHealが例外なく発火`, () => {
    const events = battle([rule("heal", trigger, { type: "heal", amount: 1 }, undefined),
      { id: "healed", trigger: "afterHeal", effect: ap }].map(r => ({ ...r, when: undefined })));
    const heal = events.findIndex(e => e.type === "heal");
    assert.ok(heal >= 0);
    assert.ok(events.slice(heal + 1).some(e => e.type === "skillTriggered" && e.skill.skillId === "healed"));
  });
}
test("不正durationは付与せず、canonical優先・旧既定turns=1", () => {
  const actor = { side: "P1", buffs: [] };
  const ctx = { actor, push() {} };
  for (const duration of [{ kind: "currentTurn" }, { kind: "turns", count: 0 }, { kind: "turns", count: NaN }])
    applyEffect(buff("AT", 2, duration), ctx);
  assert.equal(actor.buffs.length, 0);
  applyEffect({ ...buff("AT", 2), turns: 3 }, ctx);
  applyEffect({ type: "addBuff", stat: "AT", amount: 1 }, ctx);
  assert.deepEqual(actor.buffs.map(b => b.duration), [{ kind: "phase" }, { kind: "turns", remainingTurns: 1 }]);
});
