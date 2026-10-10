import { applyEffect } from "../js/effects.js";
import test from "node:test";
import assert from "node:assert/strict";
import { runBattle } from "../js/battleEngine.js";

const change = (key, value, op = "set", target = "self") =>
  ({ type: "changeValue", target, key, op, value });
const status = (key, value = 1, target = "self") =>
  ({ type: "changeStatus", target, status: key, op: "set", value });
const rule = (id, trigger, effect, when = null) => ({ id, trigger, effect, when });
const phaseIs = phase => ({ left: "phase", op: "==", right: phase });

function battle({ dice = 1, sp = 1, aSkill, bSkills = [], setup = [], enemySetup = [], rng = () => .9 } = {}) {
  return runBattle({
    p1: { battlerId: "b1", duckId: "d1" },
    p2: { battlerId: "b2", duckId: "d2" },
    data: {
      BATTLERS: [
        { id: "b1", bSkills, dSkill: { id: "D1", effect: setup } },
        { id: "b2", dSkill: { id: "D2", effect: enemySetup } },
      ],
      DUCKS: [
        { id: "d1", aSkill, stats: { AT: 5, DF: 3, SP: sp, maxHP: 1000 }, dice: [dice] },
        { id: "d2", stats: { AT: 3, DF: 3, SP: 1, maxHP: 1000 }, dice: [0] },
      ],
    },
    field: "test-no-field",
    maxTurns: 1,
    rng,
  });
}


for (const [key, code, probabilities] of [["roughWave", "STATUS_ROUGH_WAVE_ROLL", [.15, .30, .45]], ["Headwind", "STATUS_HEADWIND_ROLL", [.20, .40, .60]], ["steam", "STATUS_STEAM_ROLL", [.25, .50, .75]], ["tailwind", "STATUS_TAILWIND_ROLL", [.30, .60, .90]]]) {
  for (const stacks of [1, 2, 3]) for (const offset of [-1e-8, 1e-8]) {
    test(key + " " + stacks + " boundary " + offset, () => {
      const probability = probabilities[stacks - 1];
      const result = battle({
        setup: key === "tailwind" ? [] : [status(key, stacks)],
        enemySetup: key === "tailwind" ? [status(key, stacks)] : [],
        aSkill: { id: "A_TEST", trigger: "onDice=1", effect: [] },
        rng: () => probability + offset,
      });
      const roll = result.events.find(e => e.code === code);
      assert.ok(roll);
      assert.equal(roll.stacks, stacks);
      assert.ok(Math.abs(roll.probability - probability) < 1e-15);
      assert.equal(roll.success, offset < 0);
      const consumption = key === "tailwind" ? roll : result.events.find(e => e.code === "STATUS_CONSUMED_ON_TRIGGER" && e.status === key);
      assert.equal(consumption.before, stacks);
      assert.equal(consumption.after, 0);
      if (key === "tailwind") {
        assert.equal(result.events.some(e => e.code === "ATTACK_AVOIDED_BY_TAILWIND"), offset < 0);
        assert.equal(result.events.some(e => e.type === "normalDamage" && e.actor === "P1"), offset > 0);
      }
    });
  }
}
for (const stacks of [1, 2, 3]) {
  test("crack damage and decay " + stacks, () => {
    const events = battle({setup: [status("crack", stacks)]}).events;
    const damage = events.find(e => e.code === "STATUS_CRACK_DAMAGE");
    assert.equal(damage.value, stacks * 2);
    assert.equal(events.find(e => e.type === "statusDamage" && e.status === "crack").value, stacks * 2);
    const decay = events.find(e => e.code === "STATUS_DECAY" && e.status === "crack");
    assert.equal(decay.before, stacks);
    assert.equal(decay.after, stacks - 1);
    assert.equal(decay.decayKind, "actionEnd");
    assert.ok(events.indexOf(damage) < events.findIndex(e => e.type === "normalDamage" && e.actor === "P1"));
    assert.ok(events.indexOf(decay) > events.findIndex(e => e.type === "normalDamage" && e.actor === "P1"));
  });
  test("focus multiplier and full consumption " + stacks, () => {
    const events = battle({setup: [status("focus", stacks)]}).events;
    const factor = [0, 1.25, 1.5, 2][stacks];
    const consumed = events.find(e => e.code === "STATUS_FOCUS_CONSUMED");
    assert.equal(consumed.mul, factor);
    assert.equal(consumed.before, stacks);
    assert.equal(consumed.after, 0);
    assert.equal(events.find(e => e.type === "normalDamage" && e.actor === "P1").value, Math.trunc(4 * factor));
  });
  test("counter remains half damage and one stack consumed " + stacks, () => {
    const events = battle({enemySetup: [status("counter", stacks)]}).events;
    const counter = events.find(e => e.code === "COUNTER_TRIGGERED");
    assert.equal(counter.returned, Math.floor(counter.taken * .5));
    assert.equal(counter.counterBefore, stacks);
    assert.equal(counter.counterAfter, stacks - 1);
    assert.equal(events.filter(e => e.code === "COUNTER_TRIGGERED").length, 1);
  });
}
for (const mode of ["steam", "effect", "accuracy"]) test("tailwind survives earlier MISS: " + mode, () => {
  const setup = mode === "steam" ? [status("steam", 3)] : [];
  const bSkills = mode === "effect" ? [rule("miss", "beforeAttack", {type: "changeAttack", op: "miss"})] : [];
  const enemySetup = mode === "accuracy" ? [] : [status("tailwind", 3)];
  if (mode === "accuracy") bSkills.push(rule("give", "phaseStart", status("tailwind", 3, "enemy"), phaseIs(3)));
  const result = battle({setup, enemySetup, bSkills, sp: mode === "accuracy" ? 2 : 1, rng: () => 0});
  const events = result.events.filter(e => mode !== "accuracy" || e.phase === 3);
  assert.ok(events.some(e => e.type === "attackMissed"));
  assert.ok(!events.some(e => e.code === "STATUS_TAILWIND_ROLL"));
  assert.equal(result.events.at(-1).state.status.P2.tailwind, 3);
});

for (const key of ["crack", "Headwind", "roughWave", "steam"]) {
  for (const [clean, amount, remainingClean, remainingDebuff] of [[1,1,0,0],[1,2,0,0],[1,3,0,1],[2,3,0,0],[3,1,2,0],[3,2,2,0],[3,3,1,0]]) {
    test("clean blocks " + key + " " + clean + "/" + amount, () => {
      const actor = {side:"P1", status:{clean, [key]:0}}, events=[];
      applyEffect({type:"changeStatus", target:"self", status:key, op:"add", value:amount}, {actor, push:(type, side, data)=>events.push(data)});
      assert.equal(actor.status.clean, remainingClean);
      assert.equal(actor.status[key], remainingDebuff);
      const consumed = events.find(e=>e.code === "STATUS_CLEAN_CONSUMED");
      assert.equal(consumed.blockedAmount, amount-remainingDebuff);
      assert.equal(consumed.delta, remainingClean-clean);
    });
  }
  for (const [op, value, after] of [["set",3,3],["add",-1,1],["add",0,2]]) test("clean excludes " + key + " " + op + " " + value, () => {
    const actor={side:"P1",status:{clean:3,[key]:2}}, events=[];
    applyEffect({type:"changeStatus", target:"self", status:key, op, value}, {actor,push:(type,side,data)=>events.push(data)});
    assert.equal(actor.status.clean,3);
    assert.equal(actor.status[key],after);
    assert.ok(!events.some(e=>e.code === "STATUS_CLEAN_CONSUMED"));
  });
}
