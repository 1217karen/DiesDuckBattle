import test from "node:test";
import assert from "node:assert/strict";
import { applyEffect } from "../js/effects.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";
import { runBattle } from "../js/battleEngine.js";
import { buildBlocks } from "../js/resultBlocks.js";

const context = { maxHP: { P1: 1000, P2: 1000 }, names: {
  P1: { battler: "バトラー<一>", duck: "アヒル一" },
  P2: { battler: "バトラー二", duck: "アヒル二" },
} };
const linesFor = events => buildBlocks([{ type: "battleStart" }, ...events], "draw", context)
  .flatMap(block => block.lines).slice(1);

function harness(roll = 0) {
  const fighter = side => ({ side, ap: 1, status: Object.fromEntries(STATUS_GROUPS.all.map(key => [key, 0])) });
  const actor = fighter("P1"), enemy = fighter("P2"), events = [];
  let rolls = 0;
  const ctx = { actor, enemy, rng: () => { rolls++; return roll; },
    push: (type, actor, payload) => events.push({ type, actor, ...payload }) };
  return { ctx, actor, enemy, events, rolls: () => rolls };
}

for (const group of ["buff", "debuff"]) for (const target of ["self", "enemy"]) {
  test(`${group}/${target}: capped states excluded and remaining two chosen uniformly`, () => {
    const keys = STATUS_GROUPS[group];
    for (let sample = 0; sample < 100; sample++) {
      const h = harness(sample / 100), fighter = target === "self" ? h.actor : h.enemy;
      for (const key of keys) fighter.status[key] = 3;
      fighter.status[keys[1]] = 2;
      fighter.status[keys[2]] = 0;
      const before = { ...fighter.status }, selected = keys[sample < 50 ? 1 : 2];
      applyEffect({ type: "changeStatus", target, status: `@${group}`, value: 1 }, h.ctx);
      assert.deepEqual(fighter.status, { ...before, [selected]: before[selected] + 1 });
      assert.equal(h.events.length, 1);
      assert.equal(h.events[0].status, selected);
      assert.equal(h.events[0].target, fighter.side);
      assert.equal(h.rolls(), 1);
    }
  });

  test(`${group}/${target}: all capped emits dedicated failure and exact category text`, () => {
    const h = harness(), fighter = target === "self" ? h.actor : h.enemy;
    for (const key of STATUS_GROUPS[group]) fighter.status[key] = 3;
    const before = structuredClone(fighter.status);
    applyEffect({ type: "changeStatus", target, status: `@${group}` }, h.ctx);
    assert.deepEqual(fighter.status, before);
    assert.equal(h.rolls(), 0);
    assert.deepEqual(h.events, [{ type: "randomStatusGrantFailed", actor: "P1",
      code: "RANDOM_STATUS_GRANT_NO_CANDIDATES", target: fighter.side, group }]);
    const lines = linesFor(h.events);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, `${context.names[fighter.side].duck}に${group === "buff" ? "強化" : "異常"}の付与を失敗した……`);
  });

  test(`${group}/${target}: repeat rechecks candidates after the last available stack is filled`, () => {
    const h = harness(.999), fighter = target === "self" ? h.actor : h.enemy;
    for (const key of STATUS_GROUPS[group]) fighter.status[key] = 3;
    fighter.status[STATUS_GROUPS[group][0]] = 2;
    applyEffect({ type: "changeStatus", target, status: `@${group}`, value: { read: "self.ap" }, repeat: 2 }, h.ctx);
    assert.deepEqual(h.events.map(e => e.type), ["statusChange", "randomStatusGrantFailed"]);
    assert.equal(h.rolls(), 1);
  });
}

test("explicit capped grant and random removal retain existing behavior", () => {
  const h = harness();
  for (const key of STATUS_GROUPS.buff) h.actor.status[key] = 3;
  applyEffect({ type: "changeStatus", target: "self", status: "focus" }, h.ctx);
  assert.equal(h.events[0].before, 3);
  assert.equal(h.events[0].after, 3);
  applyEffect({ type: "changeStatus", target: "self", status: "@buff", value: -1 }, h.ctx);
  assert.equal(h.events[1].after, 2);
  assert.equal(h.rolls(), 1);
});

function battle(dice, bSkills = []) {
  return runBattle({ p1: { battlerId: "b1", duckId: "d1" }, p2: { battlerId: "b2", duckId: "d2" },
    data: { BATTLERS: [{ id: "b1", bSkills, dSkill: { effect: { type: "fixedDamage", target: "self", amount: 10 } } }, { id: "b2" }],
      DUCKS: [{ id: "d1", stats: { AT: 5, DF: 3, SP: 1, maxHP: 1000 }, dice: [dice] },
        { id: "d2", stats: { AT: 3, DF: 3, SP: 1, maxHP: 1000 }, dice: [0] }] },
    maxTurns: 1, rng: () => .9, field: "test-no-field" }).events;
}

test("engine passive B heading matches triggered B owner and label, with HTML escaping", () => {
  const events = battle(1, [{ id: "passive", trigger: "passive", modifier: {
    kind: "conditional", when: { left: "self.hpPct", op: ">=", right: .5 }, bonus: { AT: 2 },
  } }]);
  const passive = events.find(e => e.type === "passiveSkillStateChanged");
  assert.ok(passive);
  const [line] = linesFor([passive]);
  const [triggered] = linesFor([{ type: "skillTriggered", actor: "P1", skill: { category: "B" } }]);
  assert.equal(line.text.split("<br>")[0], triggered.text);
  assert.match(line.text, /^バトラー&lt;一&gt;のバトラースキル！/);
  assert.doesNotMatch(line.text, /アヒル一|常時スキル/);
});

for (const dice of [1, 2, 3, 4, 5, 6]) {
  test(`actual engine dice ${dice}: roll, normal attacks and additional effect carry one dice icon`, () => {
    const events = battle(dice);
    const roll = events.find(e => e.type === "roll" && e.actor === "P1");
    const attacks = events.filter(e => e.type === "normalDamage" && e.actor === "P1");
    assert.ok(roll);
    assert.equal(attacks.length, dice === 2 ? 2 : 1);
    const effects = events.filter(e => e.source === `dice${dice}`);
    assert.equal(effects.length, dice === 2 ? 0 : 1);
    for (const event of [roll, ...attacks, ...effects]) {
      const lines = linesFor([event]);
      assert.equal(lines.length, 1, JSON.stringify(event));
      assert.equal((lines[0].text.match(/🎲/g) ?? []).length, 1);
    }
  });
}

test("same effect types from skills have no dice icon even when labels mention dice", () => {
  const events = [
    { type: "fixedDamage", value: 3 },
    { type: "heal", value: 3 },
    { type: "recoil", value: 3, source: "aAdditionalRecoil" },
    { type: "valueChanged", key: "ap", before: 2, after: 3 },
    { type: "valueChanged", key: "ap", before: 2, after: 1 },
    { type: "statusChange", status: "counter", before: 0, after: 1 },
  ].map(event => ({ actor: "P1", target: "P2", source: "skill", groupId: 1,
    skill: { skillName: "dice3 ダイス回復", category: "B" }, ...event }));
  const lines = linesFor(events);
  assert.equal(lines.length, events.length);
  for (const line of lines) assert.doesNotMatch(line.text, /🎲/);
});
