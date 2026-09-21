import test from "node:test";
import assert from "node:assert/strict";
import { applyEffect } from "../js/effects.js";
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
function context() {
  const fighter = side => ({ side, hp: 100, maxHP: 1000, ap: 0, status: Object.fromEntries(STATUS_GROUPS.all.map(k => [k, 2])),
    battler: { bSkills: [passive("self.statusTotal:debuff"), passive("self.statusTotal:buff")] } });
  const logs = [], actor = fighter("P1"), enemy = fighter("P2");
  const ctx = { actor, enemy, turn: 1, rng: () => .9, push: (type, side, extra) => logs.push({ type, side, ...extra }), helpers: {} };
  ctx.helpers.refreshPassives = () => { refreshPassiveBonuses(ctx, actor); refreshPassiveBonuses(ctx, enemy); };
  ctx.helpers.dealDamage = (f, amount) => { f.hp -= amount; ctx.helpers.refreshPassives(); };
  ctx.helpers.refreshPassives();
  return { ctx, actor, enemy, logs };
}
const cEvents = result => result.events.filter(e => e.type === "cSkillActivated" && e.actor === "P1");
const special = effect => ({ id: "C", mode: "special", costAP: rules.baseAP, effect });

test("割合fixedDamageは既存amountPctのまま: currentHP・floor・最低1なし", () => {
  for (const [hp, pct, expected] of [[101, .3, 71], [101, 1, 0], [1, .3, 1], [0, .5, 0], [-100, .5, -100]]) {
    const h = context(); h.enemy.hp = hp;
    applyEffect({ type: "fixedDamage", target: "enemy", amountPct: pct }, h.ctx);
    assert.equal(h.enemy.hp, expected);
  }
});
for (const target of ["self", "enemy"]) {
  for (const spec of [{ status: "crack" }, { status: "focus" }, { group: "debuff" }, { group: "buff" }]) {
    test(`clearStatus ${target} ${JSON.stringify(spec)}は全stack・他group保持・B同期`, () => {
      const h = context(), fighter = target === "self" ? h.actor : h.enemy;
      const keys = spec.group ? STATUS_GROUPS[spec.group] : [spec.status];
      applyEffect({ type: "clearStatus", target, ...spec }, h.ctx);
      for (const key of STATUS_GROUPS.all) assert.equal(fighter.status[key], keys.includes(key) ? 0 : 2);
      assert.equal(fighter.runtime.passive.AT, (STATUS_GROUPS.all.length - keys.length) * 2);
      assert.equal(h.logs.filter(e => e.code === "STATUS_CLEARED").length, keys.length);
    });
  }
}
test("従来changeStatus @debuffは今もランダム1種類、全解除へ改変しない", () => {
  const h = context(); applyEffect({ type: "changeStatus", target: "self", status: "@debuff", op: "set", value: 0 }, h.ctx);
  assert.equal(STATUS_GROUPS.debuff.filter(k => h.actor.status[k] === 0).length, 1);
});
test("timedは命中1回ごと、2回攻撃なら2回・既存B/反撃の後に発動", () => {
  const r = battle({ dice: 2, setup: [timed(2)], enemySetup: [status("counter", 2)],
    bSkills: [b("afterDamage", set("ap", 2))], enemySkills: [b("afterTakeDamage", set("ap", 2))] });
  const phaseNumber = r.events.find(e => e.type === "roll" && e.actor === "P1").phase;
  const events = r.events.filter(e => e.phase === phaseNumber);
  assert.equal(events.filter(e => e.type === "timedRuleTriggered").length, 2);
  for (const trigger of events.filter(e => e.type === "timedRuleTriggered")) {
    const previous = events[events.indexOf(trigger) - 1];
    assert.equal(previous.type, "valueChanged");
    assert.equal(previous.originSkill.skillId, "afterDamage");
  }
  assert.equal(events.filter(e => e.type === "counterDamage").length, 2);
  assert.deepEqual(events.filter(e => e.type === "statusChange" && e.status === "crack").map(e => e.after), [1, 2]);
});
for (const mode of ["miss", "avoided", "counter-only"]) test(`timedは${mode}で発動しない`, () => {
  const r = battle({ dice: 2, enemyDice: 1, setup: [timed(2), ...(mode === "counter-only" ? [status("counter", 2)] : [])],
    enemySetup: mode === "avoided" ? [status("tailwind", 2)] : [],
    bSkills: mode !== "avoided" ? [b("beforeAttack", { type: "changeAttack", op: "miss" })] : [] });
  assert.equal(r.events.some(e => e.type === "timedRuleTriggered"), false);
  if (mode === "counter-only") assert.ok(r.events.some(e => e.type === "counterDamage"));
});
test("self buffは処理済みの一撃へ遡及せず、次の一撃でfocusを利用", () => {
  const r = battle({ dice: 2, setup: [timed(1, "self", "focus")] });
  assert.deepEqual(r.events.filter(e => e.type === "normalDamage" && e.actor === "P1").map(e => e.value), [4, 6]);
});
test("同一ID timed ruleも独立しdurationが個別に減る", () => {
  const r = battle({ dice: 1, setup: [timed(1), timed(2)], maxTurns: 3 });
  assert.deepEqual(r.events.filter(e => e.type === "timedRuleTriggered").map(e => e.turn), [1, 1, 2]);
  assert.deepEqual(r.events.filter(e => e.type === "timedRuleTick").map(e => [e.turn, e.before, e.after]), [[1, 1, 0], [1, 2, 1], [2, 1, 0]]);
  assert.equal(r.events.filter(e => e.type === "timedRuleExpired").length, 2);
});
test("timedのstatus変更後に相手statusTotalを読むBが同期", () => {
  const r = battle({ dice: 2, setup: [timed(1)], bSkills: [passive("enemy.statusTotal:debuff")] });
  const phaseNumber = r.events.find(e => e.type === "roll" && e.actor === "P1").phase;
  const phase = r.events.filter(e => e.phase === phaseNumber);
  assert.deepEqual(phase.filter(e => e.type === "normalDamage").map(e => e.value), [4, 5]);
  assert.deepEqual(phase.filter(e => e.type === "passiveModifierChanged").map(e => e.after.AT), [1, 2]);
});
test("afterDamage Bのhealがctx.attackを置き換えてもtimed命中処理を維持", () => {
  const r = battle({ dice: 2, setup: [timed(1)], bSkills: [b("afterDamage", { type: "heal", target: "self", amount: 1 })] });
  assert.equal(r.events.filter(e => e.type === "timedRuleTriggered").length, 2);
});
test("通常CはbeforeRoll後・ダイス前、荒波キャンセルなら発動なし", () => {
  for (const canceled of [false, true]) {
    const r = battle({ cs: { id: "normal", mode: "normal", costAP: rules.baseAP, effect: timed(1) }, dice: 1,
      setup: [set("ap", rules.baseAP), ...(canceled ? [status("roughWave")] : [])], rng: () => canceled ? 0 : .9,
      bSkills: [b("beforeRoll", set("hp", 900))] });
    if (canceled) assert.equal(cEvents(r).length, 0);
    else {
      const seq = r.events.filter(e => e.phase === cEvents(r)[0].phase).map(e => e.type);
      assert.ok(seq.indexOf("skillTriggered") < seq.indexOf("cSkillActivated"));
      assert.ok(seq.indexOf("cSkillActivated") < seq.indexOf("roll"));
      assert.equal(r.events.filter(e => e.type === "timedRuleTriggered").length, 1);
    }
  }
});
for (const [hp, ap, activated] of [[1, 20, false], [0, 0, false], [0, rules.baseAP, true], [-500, rules.baseAP, true]]) {
  test(`special HP=${hp} AP=${ap} 発動=${activated}`, () => {
    const r = battle({ cs: special({ type: "fixedDamage", target: "enemy", amount: 1 }), setup: [set("hp", hp), set("ap", ap)] });
    assert.equal(cEvents(r).length, activated ? 1 : 0);
    if (activated) {
      assert.equal(cEvents(r)[0].activationCount, 1);
      assert.equal(cEvents(r)[0].apBefore - cEvents(r)[0].apAfter, rules.baseAP);
      assert.equal(r.result, "P2_win");
    }
  });
}
test("復活なし固定ダメージ特殊Cで道連れdraw", () => {
  const r = battle({ cs: special({ type: "fixedDamage", target: "enemy", amount: 2000 }), setup: [set("hp", -100), set("ap", 20)] });
  assert.equal(r.result, "draw"); assert.equal(cEvents(r).length, 1);
});
for (const hp of [-30, -100]) test(`特殊C固定healは加算（HP${hp}+50）かつafterHeal`, () => {
  const r = battle({ cs: special({ type: "heal", target: "self", amount: 50 }), setup: [set("hp", hp), set("ap", 20)],
    bSkills: [b("afterHeal", set("ap", 0))] });
  const heal = r.events.find(e => e.type === "heal"); assert.equal(heal.hpAfter, hp + 50);
  assert.ok(r.events.some(e => e.type === "skillTriggered" && e.trigger === "afterHeal"));
  assert.equal(r.result, hp === -30 ? "draw" : "P2_win");
});
test("割合reviveは負HPから最大HP×pctをfloor、afterHealなし", () => {
  const r = battle({ cs: special(pctRevive(.3)), maxHP: 1001, setup: [set("hp", -250), set("ap", 20)], bSkills: [b("afterHeal", set("ap", 0))] });
  assert.equal(r.events.find(e => e.type === "revived").hpAfter, 300);
  assert.equal(r.events.some(e => e.type === "heal" || e.trigger === "afterHeal"), false);
});
test("初回30+30+50は最大50、低いlineやheal後reviveはHPを下げない", () => {
  for (const [effect, expected] of [
    [[pctRevive(.3), pctRevive(.3), pctRevive(.5)], 500],
    [[pctRevive(.5), pctRevive(.3)], 500],
    [[{ type: "heal", target: "self", amount: 1000 }, pctRevive(.3)], 900],
  ]) {
    const r = battle({ cs: special(effect), setup: [set("hp", -100), set("ap", 20)] });
    assert.equal(r.events.filter(e => e.type === "revived").at(-1).hpAfter, expected);
    assert.equal(r.events.some(e => e.type === "reviveRoll"), false);
  }
});
// 再抽選率0.5はテストfixtureでありproduction値ではない。
for (const [rolls, expected] of [[[.1, .9, .9], 300], [[.9, .9, .1], 500], [[.9, .9, .9], null]]) {
  test(`2回目の独立抽選 ${rolls} → ${expected}`, () => {
    // 乱数: decideFirst用1回 + 各turn両者のダイス2回。特殊C抽選は2turn末。
    const queue = [.9, .9, .9, .9, .9, ...rolls];
    const r = battle({ cs: { ...special([pctRevive(.3), pctRevive(.3), pctRevive(.5),
      { type: "fixedDamage", target: "enemy", amount: 10 }, status("crack", 2, "enemy")]), repeatReviveChance: .5 },
      setup: [set("hp", -250), set("ap", 30)], maxTurns: 2,
      bSkills: [b("phaseEnd", set("hp", -250))], rng: () => queue.shift() ?? .9 });
    assert.deepEqual(cEvents(r).map(e => e.activationCount), [1, 2]);
    assert.ok(cEvents(r).every(e => e.apBefore - e.apAfter === rules.baseAP));
    const round = r.events.filter(e => e.turn === 2 && e.phase === 2);
    assert.equal(round.filter(e => e.type === "reviveRoll").length, 3);
    assert.equal(round.filter(e => e.type === "revived").at(-1)?.hpAfter ?? null, expected);
    assert.ok(round.some(e => e.type === "fixedDamage" && e.value === 10));
    assert.ok(round.some(e => e.type === "statusChange" && e.status === "crack" && e.after === 2));
    assert.equal(r.result, expected === null ? "P2_win" : "draw");
  });
}
test("特殊Cは後の死亡時もAP消費して再発動、activation回数はrevive本数と別", () => {
  const r = battle({ cs: { ...special([pctRevive(.3), pctRevive(.5)]), repeatReviveChance: 1 },
    setup: [set("hp", -100), set("ap", 30)], maxTurns: 3, bSkills: [b("phaseEnd", set("hp", -100))] });
  assert.deepEqual(cEvents(r).map(e => e.activationCount), [1, 2, 3]);
  assert.equal(r.events.filter(e => e.type === "revived").length, 6);
});
test("全revive失敗でも他effectの道連れとAP消費を保持", () => {
  const r = battle({ cs: { ...special([pctRevive(.5), { type: "fixedDamage", target: "enemy", amount: 600 }]), repeatReviveChance: 0 },
    setup: [set("hp", -100), set("ap", 30)], maxTurns: 2, bSkills: [b("phaseEnd", set("hp", -100))] });
  assert.equal(r.result, "draw"); assert.equal(cEvents(r).length, 2);
  assert.equal(cEvents(r)[1].apBefore - cEvents(r)[1].apAfter, rules.baseAP);
});
test("未設定repeat chanceを仮の0/0.5として実行しない", () => {
  assert.throws(() => battle({ cs: special(pctRevive(.3)), setup: [set("hp", -100), set("ap", 30)], maxTurns: 2,
    bSkills: [b("phaseEnd", set("hp", -100))] }), /repeatReviveChance/);
});
test("specialのturn buff/timedも即turn末減算、既存beforeTurnEnd/turnEnd順を保持", () => {
  const r = battle({ cs: special([pctRevive(.5), timed(1), timed(2), { type: "addBuff", stat: "AT", amount: 2, duration: { kind: "turns", count: 1 } }]),
    setup: [set("hp", -100), set("ap", 20)], dice: 1, maxTurns: 2,
    bSkills: [b("beforeTurnEnd", set("ap", 0)), b("turnEnd", set("ap", 0))] });
  assert.deepEqual(r.events.filter(e => e.type === "timedRuleTriggered").map(e => e.turn), [2]);
  const at = type => r.events.findIndex(e => e.type === type);
  assert.ok(at("cSkillActivated") < r.events.findIndex(e => e.type === "skillTriggered" && e.trigger === "beforeTurnEnd"));
  assert.equal(r.events.find(e => e.type === "buffExpired").turn, 1);
  assert.equal(r.events.find(e => e.type === "timedRuleExpired").turn, 1);
  assert.ok(at("timedRuleTick") < r.events.findIndex(e => e.type === "skillTriggered" && e.trigger === "turnEnd"));
});
test("legacy特殊C fixed HP/onceは従来どおり、使用済みならAPも消費しない", () => {
  const r = battle({ cs: { id: "old", trigger: "beforeTurnEnd", costAP: rules.baseAP,
    effect: { type: "revive", hp: 150, once: true, flagKey: "old-once" } },
    setup: [set("hp", -100), set("ap", 30)], maxTurns: 2, bSkills: [b("phaseEnd", set("hp", -100))] });
  assert.equal(cEvents(r).length, 1); assert.equal(cEvents(r)[0].activationCount, undefined);
  assert.equal(r.events.find(e => e.type === "revived").hpAfter, 150); assert.equal(r.result, "P2_win");
});
test("legacy通常Cはダイス直前に発動し、固定revive once既定も維持", () => {
  const r = battle({ cs: { id: "old-normal", costAP: rules.baseAP, effect: { type: "fixedDamage", target: "enemy", amount: 30 } },
    setup: [set("ap", 20)] });
  assert.equal(cEvents(r).length, 1);
  assert.ok(r.events.findIndex(e => e.type === "fixedDamage") < r.events.findIndex(e => e.type === "roll" && e.actor === "P1"));
  const h = context(); h.actor.hp = -100;
  applyEffect({ type: "revive", hp: 150 }, h.ctx); h.actor.hp = -200;
  applyEffect({ type: "revive", hp: 150 }, h.ctx); assert.equal(h.actor.hp, -200);
});
