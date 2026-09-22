import test from "node:test";
import assert from "node:assert/strict";
import { applyEffect } from "../js/effects.js";
import { STATUS_GROUPS } from "../js/statusGroups.js";
import { refreshPassiveBonuses } from "../js/bPassiveModifiers.js";

function harness(roll = 0) {
  const fighter = side => ({ side,
    status: Object.fromEntries(STATUS_GROUPS.all.map(key => [key, 0])),
    battler: { bSkills: ["self", "enemy"].map(target => ({ id: target, trigger: "passive",
      modifier: { kind: "scaled", source: `${target}.statusTotal:buff`, targetStat: "AT", scale: 1 } })) },
  });
  const logs = [], actor = fighter("P1"), enemy = fighter("P2");
  let rolls = 0, refreshes = 0;
  const ctx = { actor, enemy, turn: 1, rng: () => { rolls++; return roll; },
    push: (type, side, data) => logs.push({ type, side, ...data }), helpers: {
      refreshPassives: () => {
        refreshes++;
        refreshPassiveBonuses(ctx, actor);
        refreshPassiveBonuses(ctx, enemy);
      },
    } };
  return { ctx, actor, enemy, logs, rolls: () => rolls, refreshes: () => refreshes };
}

for (const target of ["self", "enemy"]) for (const group of ["buff", "debuff"]) {
  for (const [roll, index] of [[0, 0], [.49, 0], [.5, 1], [.999, 1]]) {
    test(`${target}/${group}: 付与中の2種類のみ等確率で選択 rng=${roll}`, () => {
      const h = harness(roll), fighter = target === "self" ? h.actor : h.enemy;
      const other = target === "self" ? h.enemy : h.actor;
      const keys = STATUS_GROUPS[group], active = [keys[1], keys[2]];
      const opposite = STATUS_GROUPS[group === "buff" ? "debuff" : "buff"];
      Object.assign(fighter.status, Object.fromEntries(opposite.map(key => [key, 3])),
        { [active[0]]: 2, [active[1]]: 1, unknown: 3 });
      const expected = { ...fighter.status, [active[index]]: index === 0 ? 1 : 0 };
      const otherBefore = { ...other.status };
      applyEffect({ type: "removeRandomStatusStack", target, group }, h.ctx);
      assert.deepEqual(fighter.status, expected);
      assert.deepEqual(other.status, otherBefore);
      assert.equal(h.rolls(), 1);
      assert.equal(h.refreshes(), 1);
      assert.deepEqual(h.logs.filter(e => e.type === "statusChange"), [{
        type: "statusChange", side: "P1", code: "RANDOM_STATUS_STACK_REMOVED",
        target: fighter.side, group, status: active[index],
        before: index === 0 ? 2 : 1, after: index === 0 ? 1 : 0, delta: -1,
      }]);
    });
  }

  for (const key of STATUS_GROUPS[group]) for (const stacks of [1, 2, 5]) {
    test(`${target}/${group}: 唯一の候補 ${key} ${stacks}stackから1だけ解除`, () => {
      const h = harness(.999), fighter = target === "self" ? h.actor : h.enemy;
      fighter.status[key] = stacks;
      const expected = { ...fighter.status, [key]: stacks - 1 };
      applyEffect({ type: "removeRandomStatusStack", target, group }, h.ctx);
      assert.deepEqual(fighter.status, expected);
    });
  }

  test(`${target}/${group}: 候補なしでは変更・乱数消費なし`, () => {
    const h = harness(), fighter = target === "self" ? h.actor : h.enemy;
    const opposite = group === "buff" ? "debuff" : "buff";
    for (const key of STATUS_GROUPS[opposite]) fighter.status[key] = 2;
    const before = { ...fighter.status };
    assert.doesNotThrow(() => applyEffect({ type: "removeRandomStatusStack", target, group }, h.ctx));
    assert.deepEqual(fighter.status, before);
    assert.equal(h.rolls(), 0);
    assert.equal(h.refreshes(), 0);
  });
}

test("status未初期化でも候補なし", () => {
  const h = harness(); delete h.actor.status;
  applyEffect({ type: "removeRandomStatusStack", target: "self", group: "buff" }, h.ctx);
  assert.equal(h.actor.status, undefined);
  assert.equal(h.rolls(), 0);
});

test("両者の常時modifierが解除直後に同期する", () => {
  const h = harness(); h.enemy.status.focus = 2;
  h.ctx.helpers.refreshPassives();
  assert.equal(h.actor.runtime.passive.AT, 2);
  assert.equal(h.enemy.runtime.passive.AT, 2);
  applyEffect({ type: "removeRandomStatusStack", target: "enemy", group: "buff" }, h.ctx);
  assert.equal(h.actor.runtime.passive.AT, 1);
  assert.equal(h.enemy.runtime.passive.AT, 1);
});

test("repeatは毎回候補を再抽出し、0未満にしない", () => {
  const h = harness(); h.actor.status.focus = 1; h.actor.status.counter = 1;
  applyEffect({ type: "removeRandomStatusStack", target: "self", group: "buff", repeat: 3 }, h.ctx);
  assert.equal(h.actor.status.focus, 0);
  assert.equal(h.actor.status.counter, 0);
  assert.equal(h.rolls(), 2);
});

for (const [roll, selected] of [[0, "tailwind"], [.999, "focus"]]) {
  test(`既存randomPickは付与状況によらず指定候補を選ぶ rng=${roll}`, () => {
    const h = harness(roll); h.actor.status.focus = 2;
    applyEffect({ type: "randomPick", picks: ["tailwind", "focus"].map(status => ({
      type: "changeStatus", target: "self", status, value: -1,
    })) }, h.ctx);
    assert.equal(h.actor.status.tailwind, 0);
    assert.equal(h.actor.status.focus, selected === "focus" ? 1 : 2);
    assert.equal(h.logs.find(e => e.type === "randomPick").index, selected === "focus" ? 1 : 0);
  });
}
