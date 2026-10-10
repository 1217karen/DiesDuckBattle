import test from "node:test";
import assert from "node:assert/strict";
import { buildBlocks } from "../js/resultBlocks.js";
import { runBattle } from "../js/battleEngine.js";
import { refreshPassiveBonuses } from "../js/bPassiveModifiers.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";
import { createCSkillRules } from "../js/cSkillRules.js";

const rules = createCSkillRules();
const set = (key, value, target = "self") => ({ type: "changeValue", target, key, op: "set", value });
const status = (key, value = 1, target = "self") => ({ type: "changeStatus", status: key, value, target, op: "set" });
const pctRevive = pct => ({ type: "revive", target: "self", maxHpPct: pct });
const timed = (count = 1, target = "enemy", key = "crack") => ({ type: "addTimedHitRule", id: "same",
  duration: { kind: "turns", count }, effect: { type: "changeStatus", target, status: key, op: "add", value: 1 } });
const turn1 = { left: "turn", op: "==", right: 1 };
const first = { all: [turn1, { left: "phase", op: "==", right: 1 }] };
const b = (trigger, effect, when = null, id = trigger) => ({ id, trigger, when, effect });
const passive = source => ({ id: "passive", trigger: "passive", modifier: { kind: "scaled", source, targetStat: "AT", scale: 1, min: 0, max: 100 } });
function battle({ cs, enemyCS, dice = 0, enemyDice = 0, setup = [], enemySetup = [], bSkills = [], enemySkills = [],
  maxTurns = 1, maxHP = 1000, sp = 1, rng = () => .9 } = {}) {
  return runBattle({ p1: { battlerId: "b1", duckId: "d1" }, p2: { battlerId: "b2", duckId: "d2" },
    data: { BATTLERS: [{ id: "b1", bSkills, dSkill: { id: "D1", effect: setup } },
      { id: "b2", bSkills: enemySkills, dSkill: { id: "D2", effect: enemySetup } }],
    DUCKS: [{ id: "d1", cSkill: cs, stats: { AT: 0, DF: 0, SP: sp, maxHP }, dice: [dice] },
      { id: "d2", cSkill: enemyCS, stats: { AT: 0, DF: 0, SP: 1, maxHP }, dice: [enemyDice] }] },
    field: "test-no-field", maxTurns, rng });
}

const whenTurn = turns => ({ any: turns.map(turn => ({ left: "turn", op: "==", right: turn })) });
function waitingBattle(mode, turns, { ap = 10, sp = 1, cost = 10, maxTurns = Math.max(...turns), effect = { type: "heal", target: "self", amount: 1000 } } = {}) {
  return battle({
    cs: { id: "WAIT_C", skillName: "待機C", mode, costAP: cost, effect },
    maxTurns, sp,
    bSkills: [
      b("turnStart", set("ap", 0)),
      b("turnStart", set("ap", ap), whenTurn(turns), "fund"),
      ...(mode === "special" ? [b("phaseEnd", set("hp", 0), whenTurn(turns), "knockout")] : []),
    ],
  });
}
const bonuses = r => r.events.filter(e => e.type === "cSkillIdleBonus" && e.actor === "P1");
const activations = r => r.events.filter(e => e.type === "cSkillActivated" && e.actor === "P1");
for (const mode of ["normal", "special"]) {
  for (const [wait, expected] of [[0,0],[5,0],[6,1],[7,1],[8,2],[9,2],[10,3],[12,3]]) {
    test(mode + " idle boundary " + wait, () => {
      const r = waitingBattle(mode, [wait + 1]);
      const activation = activations(r);
      assert.equal(activation.length, 1);
      assert.equal(activation[0].turn, wait + 1);
      assert.equal(bonuses(r).length, expected > 0 ? 1 : 0);
      if (expected > 0) {
        const bonus = bonuses(r)[0];
        assert.equal(bonus.idleTurns, wait);
        assert.equal(bonus.bonusAP, expected);
        assert.equal(bonus.apBefore, 0); // Existing cost was already paid.
        assert.equal(bonus.apAfter, expected);
        assert.equal(bonus.groupId, activation[0].groupId);
        assert.equal(bonus.originSkill.skillId, "WAIT_C");
        assert.ok(r.events.indexOf(activation[0]) < r.events.indexOf(bonus));
        assert.ok(r.events.findIndex(e => e.type === "heal" && e.groupId === bonus.groupId) < r.events.indexOf(bonus));
      }
    });
  }
  test(mode + " cannot fund current cost with idle bonus", () => {
    const r = waitingBattle(mode, [11], { ap: 9 });
    assert.equal(activations(r).length, 0);
    assert.equal(bonuses(r).length, 0);
  });
  test(mode + " counts only complete turns without activation and resets even without bonus", () => {
    const r = waitingBattle(mode, [1,7,14]);
    assert.deepEqual(activations(r).map(e => e.turn), [1,7,14]);
    assert.deepEqual(bonuses(r).map(e => [e.turn,e.idleTurns,e.bonusAP]), [[14,6,1]]);
  });
}
test("multiple normal C activations share one idle bonus and skip that turn in the next wait", () => {
  const r = waitingBattle("normal", [7,13,20], {ap: 30, sp: 3});
  assert.equal(activations(r).filter(e=>e.turn === 7).length, 3);
  assert.deepEqual(bonuses(r).map(e=>[e.turn,e.idleTurns,e.bonusAP]), [[7,6,1],[20,6,1]]);
});

for (const mode of ["normal", "special"]) test(mode + " awards charge bonus after all effects and renders it last after name and quote", () => {
  const effect = [
    { type: "heal", target: "self", amount: 1000 },
    set("ap", 0),
    { type: "changeValue", target: "self", key: "ap", op: "add", value: 4 },
  ];
  const r = waitingBattle(mode, [7], { effect });
  const activation = activations(r)[0], bonus = bonuses(r)[0];
  const group = r.events.filter(e => e.groupId === activation.groupId);
  assert.equal(group[0], activation);
  assert.equal(group.at(-1), bonus);
  assert.deepEqual(group.filter(e => e.type === "valueChanged" && e.key === "ap").map(e => e.after), [0,4]);
  assert.equal(bonus.apBefore, 4);
  assert.equal(bonus.apAfter, 5);
  assert.equal(bonus.idleTurns, 6);
  const context = { maxHP: { P1:1000, P2:1000 }, names: { P1:{duck:"アヒル一",battler:"一"}, P2:{duck:"アヒル二",battler:"二"} },
    presentations:{ P1:{quotes:{skill:{C:{text:"チャージ台詞"}}}} } };
  const blocks = buildBlocks(r.events, r.result, context);
  const block = blocks.find(b => b.lines.some(l => l.text.includes("長期APチャージボーナス")));
  const lines = block.lines.map(l => l.text.replace(/<[^>]*>/g, ""));
  const name = lines.findIndex(t=>t.includes("待機C"));
  const quote = lines.findIndex(t=>t.includes("チャージ台詞"));
  const heal = lines.findIndex(t=>t.includes("回復"));
  const apEffect = lines.findIndex(t=>t.includes("APが") && t.includes("+4"));
  const bonusIndex = lines.indexOf("長期APチャージボーナス　AP＋1！");
  assert.ok(name >= 0 && quote > name && heal > quote && apEffect > heal && bonusIndex > apEffect);
  assert.ok(!lines[bonusIndex].includes("6ターン"));
  assert.equal(block.lines[bonusIndex].kind, "soft skill");
  assert.equal(bonusIndex, apEffect + 1);
});
