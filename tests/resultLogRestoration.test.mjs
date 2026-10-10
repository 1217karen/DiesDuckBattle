import test from "node:test";
import assert from "node:assert/strict";
import { buildBlocks } from "../js/resultBlocks.js";
import { runBattle } from "../js/battleEngine.js";
import { applyEffect } from "../js/effects.js";

const context = { maxHP: { P1: 100, P2: 100 }, names: {
  P1: { battler: "バトラー一", duck: "アヒル一" }, P2: { battler: "バトラー二", duck: "アヒル二" },
} };
const snapshot = (hp = 100, ap = 1) => ({ hp: { P1: hp, P2: 100 }, ap: { P1: ap, P2: 1 }, status: { P1: {}, P2: {} } });
const start = { type: "battleStart" };
const phase = (n = 1) => ({ type: "phaseStart", turn: 1, phase: n, actor: "P1", state: snapshot() });
const blocksFor = events => buildBlocks(events, "draw", context);
const linesFor = events => blocksFor([start, phase(), ...events]).flatMap(b => b.lines).slice(1).filter(l => l.kind !== "spacer");
const textFor = events => linesFor(events).map(l => l.text.replace(/<[^>]*>/g, "")).join("\n");
const event = (type, extra = {}) => ({ type, actor: "P1", target: "P1", turn: 1, phase: 1, ...extra });

for (const [type, status, icon, prefix, yes, no] of [
  ["roughWaveResult", "roughWave", "🌊荒波", "アヒル一に荒波が襲いかかる…… ", "命中", "回避"],
  ["steamResult", "steam", "🌫️湯気", "アヒル一は湯気に包まれている…… ", "脱出失敗", "脱出"],
  ["headwindResult", "Headwind", "🌪️逆風", "アヒル一に逆風が吹き荒れる…… ", "耐えきれなかった", "耐えた"],
]) for (const success of [true, false]) {
  test(`${type}: ${success} dedicated heading, result and one stock hint`, () => {
    const lines = linesFor([
      event("statusChange", { code: "STATUS_CONSUMED_ON_TRIGGER", status, before: 3, after: 0 }),
      event(type, { status, stacks: 3, success }),
    ]);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].text, `アヒル一の${icon}！`);
    assert.ok(lines[1].text.startsWith(prefix + (success ? yes : no) + "！"));
    assert.match(lines[1].text, /3→0/);
  });
}

for (const [code, expected] of [["ACTION_CANCELED_ROUGH_WAVE", "アヒル一は荒波のせいで行動できない！"],
  ["ACTION_CANCELED_HEADWIND", "アヒル一は逆風に煽られてスキルを発動できない！"]]) {
  test(code, () => assert.equal(textFor([event("actionCanceled", { code })]), expected));
}

test("clean uses actual effect event with prevented status/amount and consumed stock", () => {
  const events = [], actor = { side: "P1", status: { clean: 3, crack: 0 } };
  applyEffect({ type: "changeStatus", target: "self", status: "crack", value: 2 }, {
    actor, push: (type, actor, payload) => events.push({ type, actor, ...payload }),
  });
  assert.equal(events[0].code, "STATUS_CLEAN_CONSUMED");
  assert.equal(textFor(events), "アヒル一の🧼清潔！\nアヒル一は清潔で異常付与を防いだ！ （⚡亀裂 -2） （清潔 3→2）");
});

test("focus multiplier is rendered once with stock consumption", () => {
  const text = textFor([event("attackChanged", { code: "ATTACK_DAMAGE_MUL_FOCUS", op: "mulDamage", value: 2 }),
    event("statusChange", { code: "STATUS_FOCUS_CONSUMED", status: "focus", mul: 2, before: 3, after: 0 })]);
  assert.equal(text, "アヒル一の🎯集中！\nアヒル一は集中して攻撃力を×2にした！ （集中 3→0）");
  assert.doesNotMatch(text, /ダメージ倍率|解除/);
});

test("tailwind and counter headings, damage and stock hints", () => {
  const text = textFor([event("attackAvoided", { code: "ATTACK_AVOIDED_BY_TAILWIND", tailwindBefore: 2, tailwindAfter: 0 }),
    event("counterTriggered"), event("counterDamage", { target: "P2", value: 4, counterBefore: 3, counterAfter: 2 })]);
  assert.equal(text, "アヒル一の💨追風！\nアヒル一は💨追風で攻撃を回避した！ （追風 2→0）\nアヒル一の🛡️反撃！\nアヒル二に🛡️反撃で 4 ダメージを返した！ （反撃 3→2）");
});

test("capped status is visible while random failure remains a separate category event", () => {
  const text = textFor([event("statusChange", { status: "counter", before: 3, after: 3, source: "dice4" }),
    event("randomStatusGrantFailed", { group: "buff" }), event("randomStatusGrantFailed", { group: "debuff" })]);
  assert.equal(text, "🎲 アヒル一の🛡️反撃は変化しなかった…… （3→3）\nアヒル一に強化の付与を失敗した……\nアヒル一に異常の付与を失敗した……");
});

for (const [op, value, expected] of [["miss", 0, "攻撃は失敗した！"], ["mulDamage", 1.25, "ダメージ倍率 ×1.25！"],
  ["addDamage", -4, "ダメージが変化（-4）"], ["setDamage", 0, "ダメージが固定化（0）"], ["setHit", true, "攻撃内容が変化！"]]) {
  test(`attackChanged ${op}`, () => assert.equal(textFor([event("attackChanged", { op, value })]), expected));
}

for (const [key, label] of [["tempDfPlus", "DFがターン中"], ["nextAttackATPlus", "次の攻撃にAT"], ["attackTimesAdd", "攻撃回数が"]]) {
  for (const delta of [-2, 2]) test(`valueChanged ${key}/${delta}`, () => {
    assert.equal(textFor([event("valueChanged", { key, delta })]), `アヒル一の${label} ${delta > 0 ? "+" : ""}${delta}！`);
  });
}
for (const [before, after] of [[null, 2], [2, null], [null, 0], [0, null]]) {
  test(`attackTimesOverride ${before} to ${after} with engine null delta`, () => {
    assert.equal(textFor([event("valueChanged", { key: "attackTimesOverride", before, after, delta: null })]),
      `アヒル一の攻撃回数が ${before === null ? "通常" : before} → ${after === null ? "通常" : after} に変更！`);
  });
}
for (const delta of [-2, 2]) test(`recoilMinus ${delta} inverts damage sign`, () => {
  assert.equal(textFor([event("valueChanged", { key: "recoilMinus", delta })]), `アヒル一の反動ダメージが ${delta < 0 ? "+2" : "-2"}！`);
});

test("skill and field groups end in one spacer, roll has one preceding spacer", () => {
  const blocks = blocksFor([start, phase(),
    event("skillTriggered", { groupId: 1, skill: { category: "B", skillName: "独自名<一>" } }),
    event("heal", { groupId: 1, value: 2 }), event("accuracyRoll"),
    event("skillTriggered", { groupId: 2, skill: { category: "A" } }),
    event("fixedDamage", { groupId: 2, value: 3 }),
    event("fieldTriggered", { field: { name: "熱湯風呂" } }),
    event("fixedDamage", { source: "field:hotBath", value: 1 }),
    event("roll", { diceValue: 1 }), event("normalDamage", { value: 2 }),
  ]);
  const lines = blocks[1].lines;
  assert.deepEqual(lines.map(l => l.kind === "spacer"), [false, false, true, false, false, true, false, false, true, false, false]);
  for (const i of [0, 1, 3, 4, 6, 7]) assert.match(lines[i].kind, /skill/);
  assert.doesNotMatch(lines[9].kind, /skill/);
  assert.match(lines[0].text, /独自名&lt;一&gt;/);
  assert.match(lines[9].text, /🎲/);
});

test("initial passive B is deferred to first phase before phase quote; off only shows release", () => {
  const passive = event("passiveSkillStateChanged", { groupId: 1, bonus: { AT: 2 }, active: true, hpPct: 1 });
  const ctx = { ...context, presentations: { P1: { quotes: { phaseStart: { first: { text: "フェイズ台詞" } } } } } };
  const blocks = buildBlocks([start, passive, { type: "turnStart", turn: 1, state: snapshot() }, phase(),
    { ...passive, groupId: 2, active: false, hpPct: .3 }], "draw", ctx);
  assert.doesNotMatch(blocks[0].lines.map(l => l.text).join(""), /バトラースキル/);
  assert.equal(blocks[2].lines[0].text, "バトラー一のバトラースキル！");
  assert.match(blocks[2].lines[1].text, /アヒル一のAT\+2！.*現HP100%/);
  assert.match(blocks[2].lines[3].text, /フェイズ台詞/);
  assert.match(blocks[2].lines[4].text, /AT\+2が解除された！.*現HP30%/);
});

test("phase buff expiry is buffered without swallowing the following phase; C and both groups end in tail", () => {
  const events = [start, phase(), event("buffExpired", { duration: { kind: "phase" }, stat: "DF", amount: 2 }),
    event("normalDamage", { value: 5, hpAfter: 95 }), phase(2),
    event("normalDamage", { value: 100, hpAfter: 0 }),
    event("cSkillActivated", { groupId: 10, trigger: "beforeTurnEnd", apAfter: 0, skill: { category: "C", skillName: "復活名" } }),
    event("revived", { groupId: 10, hpAfter: 50 }),
    event("cSkillActivated", { groupId: 11, trigger: "beforeTurnEnd", actor: "P2", skill: { category: "C" } }),
    event("heal", { groupId: 11, target: "P2", value: 4, hpAfter: 100 }),
    event("buffTick", { stat: "AT", amount: 3, before: 2, after: 1 }),
    event("turnEnd"), event("battleEnd", { state: snapshot(50, 0), result: "draw" }),
  ];
  const original = structuredClone(events), blocks = blocksFor(events);
  assert.deepEqual(events, original);
  assert.deepEqual(blocks.map(b => b.side), ["system", "P1", "P1", "system", "system"]);
  assert.equal(blocks[2].stateAfter.hp.P1, 0);
  assert.equal(blocks[3].headerText, "");
  assert.equal(blocks[3].stateAfter.hp.P1, 50);
  assert.equal(blocks[3].stateAfter.ap.P1, 0);
  assert.doesNotMatch(blocks[1].lines.map(l => l.text).join(""), /効果が終了|チャージ/);
  const tail = blocks[3].lines;
  assert.match(tail[0].text, /行動中効果が終了/);
  assert.match(tail[1].text, /復活名/);
  assert.equal(tail.filter(l => l.kind === "spacer").length, 2);
  assert.match(tail.at(-1).text, /残り1T/);
});

test("turn tail flushes on next turn, battleEnd or end of records without turnEnd", () => {
  for (const boundary of [[], [event("battleEnd", { state: snapshot(40, 0) })],
    [{ type: "turnStart", turn: 2, phase: 0, apPlus: 1, state: snapshot(40, 1) }]]) {
    const blocks = blocksFor([start, phase(), event("cSkillActivated", { trigger: "beforeTurnEnd", groupId: 3, apAfter: 0 }),
      event("heal", { groupId: 3, value: 4, hpAfter: 40 }), ...boundary]);
    const tail = blocks.find(b => b.headerText === "");
    assert.ok(tail);
    assert.equal(tail.stateAfter.hp.P1, 40);
    assert.equal(tail.stateAfter.ap.P1, 0);
    assert.equal(blocks[1].stateAfter.hp.P1, 100);
  }
});

test("remaining base presentations: field descriptions, electric/ice turns, duration, zero heal, AT consumption and debug codes", () => {
  for (const [id, expected] of [["iceBath", "通常攻撃のダメージが 2倍！"], ["electricBath", "ターン開始時のAP増加量が +2！"]]) {
    const blocks = blocksFor([{ type: "battleStart", meta: { field: { id } } }, { type: "turnStart", turn: 1, field: id, apPlus: 2, state: snapshot() }]);
    assert.equal(blocks[0].lines[1].kind, "meta");
    assert.ok(blocks[1].lines.some(l => l.text === expected));
    assert.equal(blocks[1].lines.at(-1).kind, "spacer");
  }
  const text = textFor([event("buffApplied", { stat: "AT", amount: 2, duration: { kind: "turns", remainingTurns: 3 } }),
    event("buffApplied", { stat: "DF", amount: -1, duration: { kind: "phase" } }),
    event("heal", { value: 0, source: "dice3" }), event("note", { code: "NEXT_ATTACK_ATPLUS_CONSUMED", value: -2 }),
    event("note", { code: "CHANGE_VALUE_KEY_UNSUPPORTED", text: "<script>unsafe</script>" })]);
  assert.match(text, /AT\+2 \/ 3T/);
  assert.match(text, /DF-1 \/ この行動中/);
  assert.match(text, /🎲 アヒル一のHPが 0 回復！/);
  assert.match(text, /アヒル一は AT-2 を消費した！/);
  assert.match(text, /CHANGE_VALUE_KEY_UNSUPPORTED/);
  assert.doesNotMatch(text, /unsafe/);
});

function battle({ status, value = 3, dice = 1, rng = () => .9, enemyStatus, cSkill } = {}) {
  const setup = status ? [{ type: "changeStatus", target: "self", status, value }] : [];
  const enemySetup = enemyStatus ? [{ type: "changeStatus", target: "self", status: enemyStatus, value: 3 }] : [];
  return runBattle({ p1: { battlerId: "b1", duckId: "d1" }, p2: { battlerId: "b2", duckId: "d2" },
    data: { BATTLERS: [{ id: "b1", dSkill: { effect: setup } }, { id: "b2", dSkill: { effect: enemySetup } }],
      DUCKS: [{ id: "d1", stats: { AT: 5, DF: 3, SP: 2, maxHP: 100 }, dice: [dice], cSkill,
        aSkill: { id: "A", trigger: `onDice=${dice}`, effect: { type: "heal", target: "self", amount: 1 } } },
        { id: "d2", stats: { AT: 3, DF: 3, SP: 1, maxHP: 100 }, dice: [0] }] },
    maxTurns: 1, rng, field: "test-no-field" });
}

for (const [status, expected] of [["crack", "⚡亀裂の効果で"], ["roughWave", "荒波が襲いかかる"],
  ["steam", "湯気に包まれている"], ["Headwind", "逆風が吹き荒れる"], ["focus", "攻撃力を×2"]]) {
  test(`actual engine ${status} uses dedicated rendering without duplicate status damage`, () => {
    const result = battle({ status });
    const blocks = blocksFor(result.events);
    const text = blocks.flatMap(b => b.lines).map(l => l.text).join("\n");
    assert.ok(text.includes(expected));
    if (status === "crack") {
      assert.equal(text.split("⚡亀裂の効果で").length - 1, result.events.filter(e => e.type === "statusDamage").length);
    }
    if (status === "focus") assert.doesNotMatch(text, /ダメージ倍率/);
    assert.deepEqual(blocks.at(-1).stateAfter.hp, result.events.at(-1).state.hp);
  });
}

test("actual engine special C, quote and revival all stay together at turn end", () => {
  // Generate the current special-C event sequence using lethal setup damage.
  const data = { BATTLERS: [{ id: "b1", dSkill: { effect: { type: "fixedDamage", target: "self", amount: 200 } } }, { id: "b2" }],
    DUCKS: [{ id: "d1", stats: { AT: 1, DF: 1, SP: 1, maxHP: 100 }, dice: [0],
      cSkill: { id: "C", name: "復活", mode: "special", costAP: 1, effect: { type: "revive", target: "self", maxHpPct: .5 } } },
      { id: "d2", stats: { AT: 1, DF: 1, SP: 1, maxHP: 100 }, dice: [0] }] };
  const actual = runBattle({ p1: { battlerId: "b1", duckId: "d1" }, p2: { battlerId: "b2", duckId: "d2" }, data, maxTurns: 1, rng: () => .9, field: "test-no-field" });
  assert.ok(actual.events.some(e => e.type === "cSkillActivated" && e.trigger === "beforeTurnEnd"));
  const ctx = { ...context, presentations: { P1: { quotes: { skill: { C: { text: "復活台詞" } } } } } };
  const blocks = buildBlocks(actual.events, actual.result, ctx), tail = blocks.find(b => b.headerText === "");
  assert.ok(tail.lines.some(l => l.text.includes("チャージスキル")));
  assert.ok(tail.lines.some(l => l.text.includes("復活台詞")));
  assert.ok(tail.lines.some(l => l.text.includes("で復活")));
  assert.equal(tail.stateAfter.hp.P1, 50);
  assert.equal(tail.stateAfter.ap.P1, 0);
});
