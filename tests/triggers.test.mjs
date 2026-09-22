import test from "node:test";
import assert from "node:assert/strict";
import { runBattle } from "../js/battleEngine.js";
import { Triggers, compileAllRulesForFighter } from "../js/ruleEngine.js";

const addAP = { type: "changeValue", target: "self", key: "ap", op: "add", value: 1 };
const status = (key, target = "self") => ({ type: "changeStatus", target, status: key, op: "set", value: 1 });
const skill = (id, trigger, effect = addAP, when) => ({ id, name: id, trigger, effect, when });
function battle({ dice = 1, bSkills = [], aSkill, dEffect, enemyDEffect, rng = () => 0.9 } = {}) {
  return runBattle({
    p1: { battlerId: "b1", duckId: "d1" }, p2: { battlerId: "b2", duckId: "d2" },
    data: {
      BATTLERS: [
        { id: "b1", name: "one", bSkills, dSkill: dEffect ? skill("d1", "battleStart", dEffect) : undefined },
        { id: "b2", name: "two", dSkill: enemyDEffect ? skill("d2", "battleStart", enemyDEffect) : undefined },
      ],
      DUCKS: [
        { id: "d1", name: "one", stats: { AT: 1, DF: 1, SP: 2, maxHP: 1000 }, dice: [dice], aSkill },
        { id: "d2", name: "two", stats: { AT: 1, DF: 1, SP: 1, maxHP: 1000 }, dice: [0] },
      ],
    }, field: "test-no-field", maxTurns: 1, rng,
  });
}
const isSkill = id => event => event.type === "skillTriggered" && event.skill.skillId === id;
function ordered(events, predicates) {
  let previous = -1;
  for (const predicate of predicates) {
    const index = events.findIndex((event, i) => i > previous && predicate(event));
    assert.ok(index > previous, `Missing event after index ${previous}`); previous = index;
  }
}
const diceWhen = dice => ({ left: "dice", op: "==", right: dice });

test("afterRoll→A/beforeDiceResolve→攻撃→出目1追加→afterDiceResolve→phaseEnd", () => {
  const result = battle({
    aSkill: skill("a", "onDice=1", addAP),
    bSkills: [skill("roll", "afterRoll", addAP, diceWhen(1)),
      skill("before", "beforeDiceResolve", addAP, diceWhen(1)),
      skill("after", "afterDiceResolve", addAP, diceWhen(1)), skill("end", "phaseEnd")],
  });
  const events = result.events.filter(e => e.phase === 1);
  ordered(events, [e => e.type === "roll", isSkill("roll"), isSkill("a"), isSkill("before"),
    e => e.type === "normalDamage", e => e.source === "dice1", isSkill("after"), isSkill("end")]);
  assert.equal(events.find(isSkill("a")).trigger, "beforeDiceResolve");
  assert.equal(events.find(isSkill("roll")).trigger, "afterRoll");
  assert.equal(result.events.filter(isSkill("before")).length, 2);
  assert.equal(result.events.filter(isSkill("after")).length, 2);
});
for (const dice of [2, 3, 4, 5, 6]) {
  test(`出目${dice}の処理全体をresolve triggerが囲む`, () => {
    const { events } = battle({ dice, aSkill: skill("a", `onDice=${dice}`, addAP),
      bSkills: [skill("before", "beforeDiceResolve", addAP, diceWhen(dice)), skill("after", "afterDiceResolve", addAP, diceWhen(dice))] });
    const phase = events.filter(e => e.phase === 1);
    ordered(phase, [isSkill("a"), isSkill("before"), e => e.type === "normalDamage", isSkill("after")]);
    if (dice === 2) assert.equal(phase.filter(e => e.type === "normalDamage").length, 2);
    else ordered(phase, [e => e.type === "normalDamage", e => e.source === `dice${dice}`, isSkill("after")]);
  });
}
for (const mode of ["miss", "avoid", "zero-attacks"]) {
  test(`${mode}でも解決後triggerは発火`, () => {
    const bSkills = [skill("after", "afterDiceResolve", addAP, diceWhen(6))];
    if (mode === "miss") bSkills.push(skill("miss", "beforeAttack", { type: "changeAttack", op: "miss" }));
    const { events } = battle({ dice: 6, bSkills,
      enemyDEffect: mode === "avoid" ? status("tailwind") : undefined,
      aSkill: mode === "zero-attacks" ? skill("a", "onDice=6", { ...addAP, key: "attackTimesOverride", op: "set", value: 0 }) : undefined });
    const phase = events.filter(e => e.phase === 1);
    assert.ok(phase.some(isSkill("after")));
    assert.equal(phase.some(e => e.type === "normalDamage"), false);
    if (mode === "miss") ordered(phase, [e => e.type === "attackMissed", isSkill("after")]);
    if (mode === "avoid") ordered(phase, [e => e.type === "attackAvoided", e => e.type === "recoil", isSkill("after")]);
  });
}
test("荒波キャンセル時もafterStatus→phaseEndを通り、roll/resolveは発火しない", () => {
  const { events } = battle({ rng: () => 0, dEffect: status("roughWave"),
    bSkills: [skill("status", "afterStatus"), skill("roll", "afterRoll"),
      skill("before", "beforeDiceResolve"), skill("after", "afterDiceResolve"), skill("end", "phaseEnd")] });
  const phase = events.filter(e => e.phase === 1);
  assert.ok(phase.some(e => e.type === "actionCanceled" && e.reason === "roughWave"));
  assert.ok(phase.some(isSkill("status")));
  assert.equal(phase.some(e => e.type === "roll"), false);
  for (const id of ["roll", "before", "after"]) assert.equal(phase.some(isSkill(id)), false);
  assert.equal(phase.filter(isSkill("end")).length, 1);
  ordered(phase, [isSkill("status"), isSkill("end")]);
});
test("beforeTurnEnd→両者のbuff tick/expire→turnEnd→判定ログ、HP変化で勝敗決定", () => {
  const buff = { type: "addBuff", stat: "AT", amount: 1, turns: 1 };
  const result = battle({ dEffect: buff, enemyDEffect: buff,
    bSkills: [skill("beforeEnd", "beforeTurnEnd"), skill("end", "turnEnd",
      { type: "fixedDamage", target: "enemy", amount: 2000 }, { left: "turn", op: "==", right: 1 })] });
  ordered(result.events, [isSkill("beforeEnd"), e => e.type === "buffTick" && e.target === "P1",
    e => e.type === "buffExpired" && e.target === "P1", e => e.type === "buffTick" && e.target === "P2",
    e => e.type === "buffExpired" && e.target === "P2", isSkill("end"), e => e.type === "fixedDamage",
    e => e.type === "turnEnd" && e.result === "P1_win", e => e.type === "battleEnd"]);
  assert.equal(result.result, "P1_win");
  assert.equal(result.events.filter(e => e.type === "turnEnd").length, 1);
});
test("turnEndで回復とafterHealの既存連携が動く", () => {
  const result = battle({ bSkills: [skill("heal", "turnEnd", { type: "heal", amount: 1 }), skill("healed", "afterHeal")] });
  ordered(result.events, [isSkill("heal"), e => e.type === "heal", isSkill("healed"), e => e.type === "turnEnd"]);
});
test("旧Aの全出目条件形式とHeadwindの成功/失敗/不一致時の消費", () => {
  for (const [trigger, expected] of [["onDiceIn:1,3", true], ["onDiceNotIn:1,2", true],
    ["onDice>=3", true], ["onDice<=3", true], ["onDice>2", true], ["onDice<4", true],
    ["onDice=3", true], ["onDice!=3", false], ["unknown", false]]) {
    const f = { duck: { aSkill: skill("a", trigger) }, status: { Headwind: 0 } };
    const rule = compileAllRulesForFighter(f)[0];
    assert.equal(rule.trigger, Triggers.beforeDiceResolve);
    assert.equal(rule.when({ actor: f, diceValue: 3 }), expected);
  }
  for (const [rng, canceled] of [[() => 0, true], [() => 0.9, false]]) {
    const { events } = battle({ dice: 1, rng, dEffect: status("Headwind"), aSkill: skill("a", "onDice=1") });
    const phase = events.filter(e => e.phase === 1);
    assert.equal(phase.find(e => e.type === "headwindResult").canceled, canceled);
    assert.equal(phase.some(isSkill("a")), !canceled);
    assert.ok(phase.some(e => e.type === "statusChange" && e.status === "Headwind" && e.after === 0));
    assert.ok(phase.some(e => e.type === "normalDamage"));
  }
  const { events } = battle({ dice: 1, dEffect: status("Headwind"), aSkill: skill("a", "onDice=2") });
  assert.equal(events.some(e => e.type === "headwindResult"), false);
});
