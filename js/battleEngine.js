// battleEngine.js
// ※進行（ターン/フェイズ/攻撃）だけに寄せる

import { Triggers, runTrigger, compileAllRulesForFighter } from "./ruleEngine.js";
import { applyEffect } from "./effects.js";
import { calcMaxHPFromStats } from "./statsUtil.js";
import { refreshPassiveBonuses } from "./bPassiveModifiers.js";

/* =========================
   公開API
========================= */
export function runBattle({ p1, p2, data, maxTurns = 50, rng = Math.random, field = null }) {
  /* ---------- 0) データ参照 ---------- */
  const battlersById = indexById(data.BATTLERS);
  const ducksById = indexById(data.DUCKS);

  const p1Battler = battlersById[p1.battlerId];
  const p2Battler = battlersById[p2.battlerId];
  const p1Duck = ducksById[p1.duckId];
  const p2Duck = ducksById[p2.duckId];

  if (!p1Battler || !p2Battler || !p1Duck || !p2Duck) {
    throw new Error("Invalid selection: battlerId/duckId not found in data.");
  }

  /* ---------- 1) 内部状態 ---------- */
  const state = {
    turn: 0,
    phase: 0,
    P1: makeFighter("P1", p1Battler, p1Duck),
    P2: makeFighter("P2", p2Battler, p2Duck),

    field: chooseField(field, rng),

    // ログを「このスキル発動に紐づく効果群」として束ねるためのID採番
    logGroupSeq: 0,
  };


/* ---------- 2) ログ ---------- */
const events = [];
let eid = 0;

const push = (type, actor = "system", extra = {}) => {
  const needsState =
    type === "turnStart" ||
    type === "phaseStart" ||
    type === "battleEnd";

  events.push({
    id: ++eid,
    type,
    turn: state.turn,
    phase: state.phase,
    actor,
    ...(needsState ? { state: snapshotState(state) } : {}),
    ...extra,
  });
};

  /* ---------- 3) 先攻 ---------- */
  const first = decideFirst(state.P1, state.P2, rng);

  push("battleStart", "system", {
    meta: {
      first,
      field: state.field,
      P1: summarizeFighter(state.P1),
      P2: summarizeFighter(state.P2),
    },
    code: "BATTLE_START",
  });

  // 初期の常時バフ判定
  {
    const ctx0 = makeCtx(state, rng, push, state.P1, state.P2);
    refreshPassiveBonuses(ctx0, state.P1);
    refreshPassiveBonuses(ctx0, state.P2);
  }

  /* ---------- 4) ルール（スキル）をコンパイルして固定 ---------- */
  const rulesBySide = {
    P1: compileAllRulesForFighter(state.P1),
    P2: compileAllRulesForFighter(state.P2),
  };
  const getRules = (side) => rulesBySide[side] ?? [];

  /* ---------- 5) battleStart トリガー（Dスキルなど） ---------- */
  runTrigger(
    Triggers.battleStart,
    state.P1,
    state.P2,
    makeCtx(state, rng, push, state.P1, state.P2, getRules),
    getRules
  );
  runTrigger(
    Triggers.battleStart,
    state.P2,
    state.P1,
    makeCtx(state, rng, push, state.P2, state.P1, getRules),
    getRules
  );

  /* ---------- 6) 戦闘ループ ---------- */
  let result = "continue";

  for (let t = 1; t <= maxTurns; t++) {
    state.turn = t;
    state.phase = 0;

  // ターン内行動回数リセット（SP連続行動の命中率低下用）
  state.P1.actionsThisTurn = 0;
  state.P2.actionsThisTurn = 0;

  // ターン開始：AP増加（通常+1 / 電気風呂なら+2）
  const apPlus =
    state.field?.id === "electricBath" ? 2 : 1;

  state.P1.ap += apPlus;
  state.P2.ap += apPlus;

    {
  const ctxTS = makeCtx(state, rng, push, state.P1, state.P2, getRules);
  refreshPassiveBonuses(ctxTS, state.P1);
  refreshPassiveBonuses(ctxTS, state.P2);
}

  push("turnStart", "system", {
    code: apPlus === 2 ? "TURN_START_AP_PLUS_2" : "TURN_START_AP_PLUS_1",
    apPlus,
    field: state.field?.id ?? null,
  });

  tickCooldownsTurn(state.P1);
  tickCooldownsTurn(state.P2);

    // turnStart トリガー（ターン開始時）
    runTrigger(
      Triggers.turnStart,
      state.P1,
      state.P2,
      makeCtx(state, rng, push, state.P1, state.P2, getRules),
      getRules
    );
    runTrigger(
      Triggers.turnStart,
      state.P2,
      state.P1,
      makeCtx(state, rng, push, state.P2, state.P1, getRules),
      getRules
    );

    // SP分の行動順
    const phaseOrder = buildPhaseOrder(state.P1.sp, state.P2.sp, first);

    for (const actorSide of phaseOrder) {
      state.phase += 1;

      const atk = actorSide === "P1" ? state.P1 : state.P2;
      const def = actorSide === "P1" ? state.P2 : state.P1;

      // このターンの「何回目の行動」か（1,2,3…）
      atk.actionsThisTurn = (atk.actionsThisTurn ?? 0) + 1;

      // フェイズのクールタイム減
      tickCooldownsPhase(atk);

      // フェイズ単位の一時値をリセット
      atk.temp.attackTimesOverride = null; // 上書き無し
      atk.temp.attackTimesAdd = 0; // 加算無し
      atk.temp.recoilMinus = 0; // 反動軽減なし

      push("phaseStart", atk.side, { code: "PHASE_START" });

      /* ===== フェイズ開始（行動前） ===== */
      const preCtx = makeCtx(state, rng, push, atk, def, getRules);

      // ===== フィールド：熱湯風呂（フェイズ開始時、行動者に1〜5ダメージ）=====
      if (state.field?.id === "hotBath") {
        const dmg = rollInt(preCtx.rng, 1, 5);

        preCtx.push("fieldTriggered", "system", {
          code: "FIELD_HOT_BATH",
          field: { ...state.field },
          target: atk.side,
          value: dmg,
        });

        // HP変動は helpers 経由（常時バフ再判定が走る）
        preCtx.helpers.dealDamage(atk, dmg, "system", "fixedDamage", {
          code: "FIXED_DAMAGE",
          source: "field:hotBath",
          field: { ...state.field },
        });
       }

      // ===== フィールド：泡風呂（フェイズ開始時、行動者に1〜5回復）=====

      if (state.field?.id === "foamBath") {
        const healAmt = rollInt(preCtx.rng, 1, 5);

        preCtx.push("fieldTriggered", "system", {
          code: "FIELD_FOAM_BATH",
          field: { ...state.field },
          target: atk.side,
          value: healAmt,
        });

        // 回復も helpers 経由（常時バフ再判定が走る）
        preCtx.helpers.heal(atk, healAmt, "system", {
          source: "field:foamBath",
          field: { ...state.field },
        });
      }

      // phaseStart トリガー（フェイズ開始直後）
      runTrigger(Triggers.phaseStart, atk, def, preCtx, getRules);

      // beforeStatus トリガー（状態処理前）
      runTrigger(Triggers.beforeStatus, atk, def, preCtx, getRules);

      // 状態処理（亀裂/荒波）
      const canceled = tickPreActionStatuses(atk, preCtx);

      // afterStatus トリガー（状態処理後）
      runTrigger(Triggers.afterStatus, atk, def, preCtx, getRules);

      // 荒波でキャンセル
      if (canceled) {
        expirePhaseBuffs(atk, push);
        expirePhaseBuffs(def, push);
        tickActionEndDecay(atk, push, preCtx);
        continue;
      }

      // beforeRoll トリガー（ダイス回す前）
      runTrigger(Triggers.beforeRoll, atk, def, preCtx, getRules);

      /* ===== Cスキル（AP足りたら自動発動） ===== */
      maybeUseCSkill(atk, def, makeCtx(state, rng, push, atk, def, getRules));

      /* ===== ダイス ===== */
      const diceValue = rollFromPool(atk.dicePool, rng);
      push("roll", atk.side, { diceValue });

      // afterRollは出目確定イベント。出目解決開始とは意味を分ける。
      const rollCtx = makeCtx(state, rng, push, atk, def, getRules);
      rollCtx.diceValue = diceValue;
      runTrigger(Triggers.afterRoll, atk, def, rollCtx, getRules);

      // 出目解決全体の直前。独立ctxに確定出目を渡す（Aもここで発動）。
      const beforeResolveCtx = makeCtx(state, rng, push, atk, def, getRules);
      beforeResolveCtx.diceValue = diceValue;
      runTrigger(Triggers.beforeDiceResolve, atk, def, beforeResolveCtx, getRules);

      /* ===== 出目効果 + 通常攻撃 ===== */
      resolveDiceAndAttack(atk, def, diceValue, push, rng, state, getRules);

      // miss/回避を含め、通常攻撃・追加効果・反動がすべて終了した後。
      const afterResolveCtx = makeCtx(state, rng, push, atk, def, getRules);
      afterResolveCtx.diceValue = diceValue;
      runTrigger(Triggers.afterDiceResolve, atk, def, afterResolveCtx, getRules);

      /* ===== 行動終了：自然減衰 ===== */
      // phaseEnd トリガー（フェイズ終了時）
      runTrigger(Triggers.phaseEnd, atk, def, makeCtx(state, rng, push, atk, def, getRules), getRules);

      // 付与対象によらず現在phaseの終了で消去。phaseEndで付いた分も含む。
      expirePhaseBuffs(atk, push);
      expirePhaseBuffs(def, push);
      tickActionEndDecay(atk, push, preCtx);
    }

    // ===== Cスキル（ターン終了時：敗北復活系）=====
    maybeUseCSkillBeforeTurnEnd(
      state.P1,
      state.P2,
      makeCtx(state, rng, push, state.P1, state.P2, getRules)
    );
    maybeUseCSkillBeforeTurnEnd(
      state.P2,
      state.P1,
      makeCtx(state, rng, push, state.P2, state.P1, getRules)
    );


    // beforeTurnEnd トリガー（ターン終了直前）
    runTrigger(
      Triggers.beforeTurnEnd,
      state.P1,
      state.P2,
      makeCtx(state, rng, push, state.P1, state.P2, getRules),
      getRules
    );
    runTrigger(
      Triggers.beforeTurnEnd,
      state.P2,
      state.P1,
      makeCtx(state, rng, push, state.P2, state.P1, getRules),
      getRules
    );

    /* ---------- ターン終了 ---------- */

    // 持続バフの残りターンを減らす
    tickTurnEndBuffs(state.P1, push);
    tickTurnEndBuffs(state.P2, push);

    // triggerのturnEndは勝敗判定前。下の既存turnEndログは判定結果を記録する。
    runTrigger(
      Triggers.turnEnd, state.P1, state.P2,
      makeCtx(state, rng, push, state.P1, state.P2, getRules), getRules
    );
    runTrigger(
      Triggers.turnEnd, state.P2, state.P1,
      makeCtx(state, rng, push, state.P2, state.P1, getRules), getRules
    );

    result = judge(state.P1, state.P2);
    push("turnEnd", "system", { result });

    if (result !== "continue") {
      push("battleEnd", "system", { result });
      break;
    }
  }

  if (result === "continue") {
    push("battleEnd", "system", { code: "BATTLE_END_MAX_TURNS", result: "draw" });
  }

  return {
    result: events[events.length - 1]?.result ?? result,
    events,
  };
}

/* =========================
   定数
========================= */

export const MAX_STACK = 3;

export const STAT_CAP = 999;

/* =========================
   基本ユーティリティ
========================= */

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function indexById(arr) {
  const m = {};
  for (const x of arr) m[x.id] = x;
  return m;
}

function normalizeField(input) {
  if (input == null) return null;

  // 文字列なら id/name 両方に使う（デバッグ用の簡易指定）
  if (typeof input === "string") {
    const id = input.trim();
    if (!id) return null;
    return { id, name: id };
  }

  // { id, name } 形式を想定
  if (typeof input === "object") {
    const id = String(input.id ?? "").trim();
    if (!id) return null;
    const name = String(input.name ?? input.id ?? "").trim() || id;
    return { id, name };
  }

  return null;
}
const FIELD_CATALOG = [
  { id: "hotBath", name: "熱湯風呂" },
  { id: "foamBath", name: "泡風呂" },
  { id: "iceBath", name: "氷風呂" },
  { id: "electricBath", name: "電気風呂" },
];

function chooseField(fieldInput, rng) {
  // 1) 外部指定があれば最優先
  const forced = normalizeField(fieldInput);
  if (forced) return forced;

  // 2) 確率でフィールド、なしは通常
  const roll = typeof rng === "function" ? rng() : Math.random();
  if (roll >= 0.2) return null;

  // 3) 発生したらカタログからランダムに1つ
  const list = FIELD_CATALOG;
  if (!Array.isArray(list) || list.length === 0) return null;

  const i = Math.floor((typeof rng === "function" ? rng() : Math.random()) * list.length);
  const picked = list[i];

  return normalizeField(picked);
}

function sumBuff(f, stat) {
  const list = Array.isArray(f?.buffs) ? f.buffs : [];
  let total = 0;
  for (const b of list) {
    if (!b || b.stat !== stat) continue;
    const a = Number(b.amount ?? 0);
    if (Number.isFinite(a)) total += a;
  }
  return total;
}

function makeFighter(side, battler, duck) {

  const computedHP = calcMaxHPFromStats(duck.stats);
  const initialHP = Number(duck.stats?.maxHP ?? 0);

  // stats.maxHP が 1以上ならそれを優先、未設定/0なら計算値を使う
  const maxHP = initialHP > 0 ? Math.trunc(initialHP) : computedHP;

  return {
    side,
    battlerId: battler.id,
    duckId: duck.id,
    name: `${battler.name} × ${duck.name}`,
    battler,
    duck,

    maxHP: maxHP,
    hp: maxHP,
    ap: 0,

    at: duck.stats.AT,
    df: duck.stats.DF,
    sp: duck.stats.SP,

    dicePool: [...duck.dice],
    buffs: [],
    cooldowns: {
      turn: {},
      phase: {},
    },

    // ターン内の行動回数（SPの連続行動用）
    actionsThisTurn: 0,

    // ターン限りなど
    temp: {
      attackTimesOverride: null,
      attackTimesAdd: 0,
      recoilMinus: 0,
    },

    nextAttackATPlus: 0,

    // 状態変化
    status: {
      crack: 0,
      Headwind: 0,
      roughWave: 0,
      tailwind: 0,
      focus: 0,
      counter: 0,
      clean: 0,
      steam: 0,
    },

    // UI/常時計算用のランタイム（保存領域）
    runtime: {
      passive: {
        AT: 0,
        DF: 0,
        modifiers: [],
      },
    },
  };
}

function summarizeFighter(f) {
  return {
    battlerId: f.battlerId,
    battlerName: f.battler?.name ?? f.battlerId,
    duckId: f.duckId,
    duckName: f.duck?.name ?? f.duckId,
    duckIcons: f.duck?.icons ?? null,
    name: f.name,
    maxHP: f.maxHP,
    stats: { AT: f.at, DF: f.df, SP: f.sp },
    dicePool: [...f.dicePool],
  };
}

function snapshotState(state) {
  return {
    hp: { P1: state.P1.hp, P2: state.P2.hp },
    ap: { P1: state.P1.ap, P2: state.P2.ap },

    status: {
      P1: { ...state.P1.status },
      P2: { ...state.P2.status },
    },
  };
}


function decideFirst(p1, p2, rng) {
  if (p1.sp > p2.sp) return "P1";
  if (p2.sp > p1.sp) return "P2";
  return rng() < 0.5 ? "P1" : "P2";
}

function buildPhaseOrder(sp1, sp2, first) {
  const a = first;
  const b = first === "P1" ? "P2" : "P1";
  let ra = first === "P1" ? sp1 : sp2;
  let rb = first === "P1" ? sp2 : sp1;

  const order = [];
  while (ra > 0 && rb > 0) {
    order.push(a);
    ra--;
    order.push(b);
    rb--;
  }
  while (ra-- > 0) order.push(a);
  while (rb-- > 0) order.push(b);
  return order;
}

function rollFromPool(pool, rng) {
  if (!pool || pool.length === 0) return 0;
  const i = Math.floor(rng() * pool.length);
  return pool[i];
}

function rollInt(rng, min, max) {
  const r = typeof rng === "function" ? rng() : Math.random();
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(r * (hi - lo + 1));
}

function makeCtx(state, rng, pushRaw, actor = null, enemy = null, getRules) {
  const ctx = {
    rng,
    turn: state.turn,
    phase: state.phase,
    actor,
    enemy,
    diceValue: null,
    attack: null,

    // ==== originをスタックで管理する ====
    _originStack: [], // 例: [{ originSkill, groupId }, ...]
    newGroupId: () => {
      state.logGroupSeq = (state.logGroupSeq ?? 0) + 1;
      return state.logGroupSeq;
    },

    // この関数だけがログを出す入口（必ずここを通す）
    push: (type, actorSide = "system", extra = {}) => {
      const top =
        ctx._originStack.length > 0
          ? ctx._originStack[ctx._originStack.length - 1]
          : null;

      const merged = { ...extra };
      // スキル由来なら originSkill / groupId を自動で付ける
      if (top?.originSkill && merged.originSkill == null) merged.originSkill = top.originSkill;
      if (top?.groupId && merged.groupId == null) merged.groupId = top.groupId;

      pushRaw(type, actorSide, merged);
    },

    // 「この処理はスキル由来です」と宣言して、その間だけ自動タグ付け
    withOrigin: (originMeta, fn) => {
      ctx._originStack.push(originMeta ?? null);
      try {
        return fn();
      } finally {
        ctx._originStack.pop();
      }
    },

    helpers: {
      clamp,
      MAX_STACK,

      // HPが動いたら常時バフを再判定
      dealDamage: (targetF, amount, actorSide, type, extra = {}) => {
        dealDamage(targetF, amount, ctx.push, actorSide, type, extra);
        refreshPassiveBonuses(ctx, ctx.actor);
        refreshPassiveBonuses(ctx, ctx.enemy);
      },

      // HPが動いたら常時バフを再判定
      heal: (selfF, amount, actorSide, extra = {}) => {
      extra = (extra && typeof extra === "object") ? extra : {};

      heal(selfF, amount, ctx.push, actorSide, extra);
      refreshPassiveBonuses(ctx, ctx.actor);
      refreshPassiveBonuses(ctx, ctx.enemy);

      // 回復後トリガー（Bスキル用）
      const healAmt = Math.trunc(Number(amount ?? 0));
      if (healAmt > 0 && extra.source !== "afterHealBonus") {
        ctx.attack = { kind: "heal", amount: healAmt, hit: true, avoided: false, isCounter: false, dice: null, damage: null };
        runTrigger(Triggers.afterHeal, ctx.actor, ctx.enemy, ctx, getRules);
      }
    },
      refreshPassives: () => {
        refreshPassiveBonuses(ctx, ctx.actor);
        refreshPassiveBonuses(ctx, ctx.enemy);
      },
    },
  };

  return ctx;
}

function tickCooldownsTurn(f) {
  const cd = f.cooldowns?.turn;
  if (!cd) return;
  for (const k of Object.keys(cd)) {
    cd[k] = Math.max(0, Math.trunc(Number(cd[k] ?? 0)) - 1);
  }
}

function tickCooldownsPhase(f) {
  const cd = f.cooldowns?.phase;
  if (!cd) return;
  for (const k of Object.keys(cd)) {
    cd[k] = Math.max(0, Math.trunc(Number(cd[k] ?? 0)) - 1);
  }
}

/* =========================
   状態：行動前 / 行動後
========================= */

function tickPreActionStatuses(atk, ctx) {
  // 亀裂：行動前にスタック数ダメージ
  const crack = atk.status?.crack ?? 0;
  if (crack > 0) {
    ctx.push("statusEffect", "system", {
      code: "STATUS_CRACK_DAMAGE",
      target: atk.side,
      status: "crack",
      kind: "damage",
      value: crack,
    });

    // HPを動かす処理は helpers 経由に統一（常時バフ再判定が漏れない）
    ctx.helpers.dealDamage(atk, crack, "system", "statusDamage", {
      status: "crack",
      source: "crack",
    });
  }

  // 荒波：発動時に全消費して確率で行動キャンセル
  const rw = atk.status?.roughWave ?? 0;
  if (rw > 0) {
    const before = rw;
    atk.status.roughWave = 0;
    ctx.helpers.refreshPassives();

    ctx.push("statusChange", "system", {
      code: "STATUS_CONSUMED_ON_TRIGGER",
      target: atk.side,
      status: "roughWave",
      before,
      after: 0,
      consumeKind: "trigger",
    });

    const prob = clamp(0.2 * rw, 0, 0.95);
    const ok = ctx.rng() < prob;

    ctx.push("roughWaveResult", "system", {
      code: "STATUS_ROUGH_WAVE_ROLL",
      target: atk.side,
      status: "roughWave",
      stacks: rw,
      success: ok,
      probability: prob,
    });

    if (ok) {
      ctx.push("actionCanceled", "system", {
        code: "ACTION_CANCELED_ROUGH_WAVE",
        target: atk.side,
        reason: "roughWave",
      });
      return true;
    }
  }

  return false;
}

function tickActionEndDecay(atk, push, ctx) {
  decayOne(atk, "crack", push, "actionEnd");
  ctx.helpers.refreshPassives();
}

function decayOne(f, key, push, decayKind) {
  const before = f.status?.[key] ?? 0;
  if (before <= 0) return;

  const after = clamp(before - 1, 0, MAX_STACK);
  f.status[key] = after;

  push("statusChange", "system", {
    code: "STATUS_DECAY",
    target: f.side,
    status: key,
    before,
    after,
    decayKind: decayKind ?? null,
  });
}

function applyFocusIfAny(atk, ctx, push) {
  const stacks = atk.status?.focus ?? 0;
  if (stacks <= 0) return;

  const factor = stacks >= 3 ? 2.5 : stacks === 2 ? 2.0 : 1.5;

  // damageMul に倍率を掛ける
  if (!ctx.attack) return;
  const beforeMul = Number(ctx.attack?.damageMul ?? 1);
  ctx.attack.damageMul = beforeMul * factor;

  // 集中は全消費
  const before = stacks;
  atk.status.focus = 0;
  ctx.helpers.refreshPassives();

  push("attackChanged", atk.side, {
    code: "ATTACK_DAMAGE_MUL_FOCUS",
    target: ctx.enemy?.side,
    op: "mulDamage",
    before: beforeMul,
    after: ctx.attack.damageMul,
    value: factor,
  });

  push("statusChange", atk.side, {
    code: "STATUS_FOCUS_CONSUMED",
    target: atk.side,
    status: "focus",
    before,
    after: 0,
    mul: factor,
  });
}

/* =========================
   通常攻撃＋ダイス効果
========================= */

function resolveDiceAndAttack(atk, def, diceValue, push, rng, state, getRules) {
  // 通常攻撃（ベース：出目2は2回、それ以外は1回）
  const baseTimes = diceValue === 2 ? 2 : 1;

  // フェイズ内スキルで攻撃回数を上書き/加算できる
  const override = atk.temp?.attackTimesOverride;
  const add = atk.temp?.attackTimesAdd ?? 0;

  let times = (typeof override === "number" ? override : baseTimes) + add;
  times = Math.max(0, Math.floor(times));

  let hadNonMissAttack = false; // 出目6の反動判定用

    // ダメージ計算用の出目：ターン内1回目の行動だけ×2
    // ※diceValue自体は判定用に残す（出目2の2回攻撃、出目6のDF無視など）
    let diceForDamage = diceValue;

    if (atk.actionsThisTurn === 1) {
      diceForDamage = diceValue * 2;

      push("phaseBonus", atk.side, {
        code: "PHASE1_DICE_DOUBLE",
        target: atk.side,
        originalDice: diceValue,
        modifiedDice: diceForDamage,
      });
    }

  for (let i = 0; i < times; i++) {
    // 攻撃計算
    // 常時バフ込みの基礎AT/DF
    const baseAT = getEffectiveAT(atk);
    const baseDF = getEffectiveDF(def);

    // 攻撃情報
    const attackInfo = {
      kind: "normalAttack",
      seq: times === 1 ? "1/1" : `${i + 1}/${times}`,
      dice: diceValue,

      // ここは後で計算して更新する（仮）
      hit: true,
      avoided: false,

      // miss / 倍率
      miss: false,
      damageMul: 1,

      // 反撃か確認
      isCounter: false,

      // 参考値（ログ用）
      baseDamage: 0,
      // null 開始（beforeAttackでaddDamage/setDamageされたら保持）
      damage: null,

    };

    // beforeAttackトリガー（攻撃確定後：ヒット判定前）
    const beforeAttackCtx = makeCtx(state, rng, push, atk, def, getRules);
    beforeAttackCtx.diceValue = diceValue;
    beforeAttackCtx.attack = attackInfo;
    runTrigger(Triggers.beforeAttack, atk, def, beforeAttackCtx, getRules);

    const statusAT = baseAT;

    const bonusAT = atk.nextAttackATPlus ?? 0;

    const atkPower = diceValue + statusAT + bonusAT;

    // 出目6：DF無視攻撃（defPowerを引かない）
    const ignoresDF = diceValue === 6;

    const defPower = ignoresDF ? 0 : baseDF;

    // 通常攻撃計算式
    const atPart = statusAT + bonusAT;
    const raw = atPart - defPower;
    const diff = Math.max(0, raw);

    const baseDmg = diceForDamage + diff;

    // attackInfo を計算結果で更新（beforeAttackで触った値は維持）
    attackInfo.baseDamage = baseDmg;
    attackInfo.avoided = false;
    attackInfo.hit = true;

    if (attackInfo.damage === null) {
      attackInfo.damage = baseDmg;
    }

    // afterHitCtx をここで作る（miss/回避/afterHit/beforeTakeDamage で共有）
    const afterHitCtx = makeCtx(state, rng, push, atk, def, getRules);
    afterHitCtx.diceValue = diceValue;
    afterHitCtx.attack = attackInfo;

    // =========================
    // 湯気（steam）：通常攻撃の命中率低下（ストック×20%でMISS）
    // - 通常攻撃のみ（counter/fixedDamageは対象外）
    // - 判定したら成功/失敗に関わらず全消費
    // =========================
    {
      const stacks = atk.status?.steam ?? 0;
      const isNormal = afterHitCtx.attack?.kind === "normalAttack";
      const isCounter = Boolean(afterHitCtx.attack?.isCounter);

      if (isNormal && !isCounter && stacks > 0) {
        const before = stacks;
        atk.status.steam = 0; // 全消費
        afterHitCtx.helpers.refreshPassives();

        // 消費ログ（statusChange）
        push("statusChange", "system", {
          code: "STATUS_CONSUMED_ON_TRIGGER",
          target: atk.side,
          status: "steam",
          before,
          after: 0,
          consumeKind: "trigger",
        });

        const prob = clamp(0.2 * before, 0, 0.95);
        const ok = rng() < prob; // ok=true なら MISS

        push("steamResult", "system", {
          code: "STATUS_STEAM_ROLL",
          target: atk.side,
          status: "steam",
          stacks: before,
          success: ok,
          probability: prob,
        });

        if (ok) {
          afterHitCtx.attack.miss = true;
        }
      }
    }

    // miss 判定（missなら回避も消費しない）
    if (afterHitCtx.attack?.miss) {
      push("attackMissed", atk.side, {
        code: "ATTACK_MISSED_BY_EFFECT",
        target: def.side,
        attack: { ...afterHitCtx.attack },
      });

      continue;
    }

    hadNonMissAttack = true;

    // =========================
    // 連続行動の命中率低下（通常攻撃のみ）
    // =========================
    {
      const isNormal = afterHitCtx.attack?.kind === "normalAttack";
      const isCounter = Boolean(afterHitCtx.attack?.isCounter);

      if (isNormal && !isCounter) {
        const n = Math.trunc(Number(atk.actionsThisTurn ?? 1));
        const missProb = n === 2 ? 0.5 : n === 3 ? 0.5 : 0;

        if (missProb > 0) {
          const r = (typeof afterHitCtx.rng === "function" ? afterHitCtx.rng() : Math.random());
          const missed = r < missProb;

          push("accuracyRoll", "system", {
            code: "ACCURACY_ROLL_MULTI_ACTION",
            attacker: atk.side,
            target: def.side,
            actionIndex: n,
            missProb,
            roll: r,
            missed,
          });

          if (missed) {
            afterHitCtx.attack.hit = false;
            afterHitCtx.attack.avoided = false; // 追風と区別（外した）
            afterHitCtx.attack.baseDamage = 0;
            afterHitCtx.attack.damage = 0;

            // afterHit は呼ぶ
            runTrigger(Triggers.afterHit, atk, def, afterHitCtx, getRules);
            applyFocusIfAny(atk, afterHitCtx, push);

            push("attackMissed", atk.side, {
              code: "ATTACK_MISSED_BY_MULTI_ACTION_ACCURACY",
              target: def.side,
              actionIndex: n,
              missProb,
              attack: { ...afterHitCtx.attack },
            });

            continue;
          }
        }
      }
    }

    // === 回避判定：miss の後に判定するので、miss時は回避を消費しない ===
    {
      // 追風：攻撃ごとに1消費して回避
      const tw = def.status?.tailwind ?? 0;
      if (tw > 0) {
        const beforeTw = tw;
        def.status.tailwind = Math.max(0, tw - 1);
        afterHitCtx.helpers.refreshPassives();

        afterHitCtx.attack.avoided = true;
        afterHitCtx.attack.hit = false;
        afterHitCtx.attack.baseDamage = 0;
        afterHitCtx.attack.damage = 0;

        // 回避済みの情報を見せたいので afterHit は呼ぶ
        runTrigger(Triggers.afterHit, atk, def, afterHitCtx, getRules);
        applyFocusIfAny(atk, afterHitCtx, push);


        push("attackAvoided", def.side, {
          code: "ATTACK_AVOIDED_BY_TAILWIND",
          target: def.side,
          value: baseDmg,
          tailwindBefore: beforeTw,
          tailwindAfter: def.status.tailwind,
        });
        continue;
      }
    }

    // afterHitトリガー（avoided=false のまま）
    runTrigger(Triggers.afterHit, atk, def, afterHitCtx, getRules);
    applyFocusIfAny(atk, afterHitCtx, push);

    // beforeTakeDamageトリガー（受動側：ダメージ適用前）
    runTrigger(Triggers.beforeTakeDamage, def, atk, afterHitCtx, getRules);

    // damage は加法
    const dmgRaw = Number(afterHitCtx.attack?.damage ?? baseDmg);
    const dmgBase = Number.isFinite(dmgRaw) ? dmgRaw : baseDmg;

    // damageMul は乗法
    const mulRaw = Number(afterHitCtx.attack?.damageMul ?? 1);
    let mul = Number.isFinite(mulRaw) ? mulRaw : 1;

    // ===== フィールド：氷風呂（通常攻撃ダメージ×2）=====
    if (
      state.field?.id === "iceBath" &&
      afterHitCtx.attack?.kind === "normalAttack"
    ) {
      const beforeMul = mul;
      mul = mul * 2;

      push("attackChanged", atk.side, {
        code: "FIELD_ICE_BATH_DAMAGE_MUL",
        target: def.side,
        op: "mulDamage",
        before: beforeMul,
        after: mul,
        value: 2,
        field: { ...state.field },
      });
    }

    const finalDmg = Math.max(0, Math.trunc(dmgBase * mul));

    // 攻撃情報を最終形に更新（afterDamage等の参照用）
    afterHitCtx.attack.damage = finalDmg;

    // nextAttackATPlusを消費する
    if (bonusAT !== 0 && afterHitCtx.attack?.kind === "normalAttack" && !afterHitCtx.attack?.isCounter) {

      // 消費した瞬間のログ（result.jsで表示する用）
      afterHitCtx.push("note", atk.side, {
        code: "NEXT_ATTACK_ATPLUS_CONSUMED",
        value: bonusAT,
      });

      atk.nextAttackATPlus = 0;
    }

    // ダメージ適用
    afterHitCtx.helpers.dealDamage(def, finalDmg, atk.side, "normalDamage", {
  source: times === 1 ? "normal" : `multi(${i + 1}/${times})`,
  attack: { ...afterHitCtx.attack },
});

    // afterTakeDamageトリガー（受動側：ダメージ適用後）
    runTrigger(Triggers.afterTakeDamage, def, atk, afterHitCtx, getRules);

    // === counter（反撃）発動：受けたダメージの半分を返す（DF無視・切り捨て） ===
    {
      const counterStacks = def.status?.counter ?? 0;

      // 反撃由来の攻撃では反撃しない（反撃ループ防止）
      const isFromCounter = Boolean(afterHitCtx.attack?.isCounter);

      if (!isFromCounter && counterStacks > 0) {
        const taken = Number(finalDmg ?? 0);
        const ret = Math.floor(taken * 0.5);

        // 反撃スタック消費（発動したら1減る）
        def.status.counter = Math.max(0, counterStacks - 1);
        afterHitCtx.helpers.refreshPassives();

        push("counterTriggered", def.side, {
          code: "COUNTER_TRIGGERED",
          target: atk.side,
          taken,
          returned: ret,
          counterBefore: counterStacks,
          counterAfter: def.status.counter,
        });

        // 反撃ダメージ（DF無視の固定）
        const counterAttack = {
          kind: "counter",
          seq: "counter",
          dice: null,
          hit: true,
          avoided: false,
          miss: false,
          damageMul: 1,
          isCounter: true,
          baseDamage: ret,
          damage: ret,
        };

        const counterCtx = makeCtx(state, rng, push, def, atk, getRules);
        counterCtx.diceValue = diceValue;
        counterCtx.attack = counterAttack;

        // 反撃ダメージ適用（HPが動くので helpers 経由）
        counterCtx.helpers.dealDamage(atk, ret, def.side, "counterDamage", {
          source: "counter",
          attack: { ...counterAttack },
          counterBefore: counterStacks,
          counterAfter: def.status.counter,
        });

        runTrigger(Triggers.afterTakeDamage, atk, def, counterCtx, getRules);
        runTrigger(Triggers.afterDamage, def, atk, counterCtx, getRules);
      }
    }

    // afterDamageトリガー（与ダメ確定後）
    runTrigger(Triggers.afterDamage, atk, def, afterHitCtx, getRules);
  }

  // 出目の追加効果
  // 1：自分にAP+1
  if (diceValue === 1) {
    applyEffect(
      { type: "changeValue", target: "self", key: "ap", op: "add", value: 1, source: "dice1" },
      makeCtx(state, rng, push, atk, def, getRules),
    );
  }

  // 3：自分のHP回復
  if (diceValue === 3) {
    const ctx3 = makeCtx(state, rng, push, atk, def, getRules);
    ctx3.helpers.heal(atk, 3, atk.side, { source: "dice3" });
  }

  // 4：自分に反撃付与
  if (diceValue === 4) {
    const before = atk.status?.counter ?? 0;
    const cap = MAX_STACK; // 既存の最大3に合わせる
    const after = Math.max(0, Math.min(cap, before + 1));
    atk.status.counter = after;
    makeCtx(state, rng, push, atk, def, getRules).helpers.refreshPassives();

    push("statusChange", atk.side, {
      code: "STATUS_COUNTER_PLUS_DICE4",
      target: atk.side,
      status: "counter",
      before,
      after,
      source: "dice4",
    });
  }

  // 5：相手のAP-1
  if (diceValue === 5) {
    applyEffect(
      { type: "changeValue", target: "enemy", key: "ap", op: "add", value: -1, source: "dice5" },
      makeCtx(state, rng, push, atk, def, getRules),
    );
  }

  // 6：固定反動ダメージ
  if (diceValue === 6 && hadNonMissAttack) {
    const minus = Math.trunc(atk.temp?.recoilMinus ?? 0);
    const dmg = Math.max(0, 3 - minus);

    const ctx6 = makeCtx(state, rng, push, atk, def, getRules);
    ctx6.helpers.dealDamage(atk, dmg, atk.side, "recoil", {
      source: "dice6",
      recoilBase: 3,
      recoilMinus: Math.max(0, minus),
    });
  }
}

/* =========================
   ダメージ/回復
========================= */

function dealDamage(targetF, amount, push, actorSide, type, extra = {}) {
  const before = targetF.hp;
  targetF.hp = targetF.hp - amount;

  push(type, actorSide, {
    target: targetF.side,
    value: amount,
    hpBefore: before,
    hpAfter: targetF.hp,
    ...extra,
  });
}

function heal(self, amount, push, actorSide, extra = {}) {
  const before = self.hp;
  const after = Math.min(self.maxHP, self.hp + amount);
  const actual = after - before;
  self.hp = after;

  push("heal", actorSide, {
    target: self.side,
    value: actual,
    hpBefore: before,
    hpAfter: self.hp,
    ...extra,
  });
}

/* =========================
   ターン終了・勝敗
========================= */

function expirePhaseBuffs(f, push) {
  f.buffs = (f.buffs ?? []).filter(b => {
    if (b.duration?.kind !== "phase") return true;
    push("buffExpired", "system", { code: "BUFF_EXPIRED", target: f.side,
      stat: b.stat, amount: b.amount, id: b.id ?? null, duration: { kind: "phase" } });
    return false;
  });
}

function tickTurnEndBuffs(f, push) {
  const list = Array.isArray(f?.buffs) ? f.buffs : [];
  if (list.length === 0) return;

  const next = [];

  for (const b of list) {
    if (!b) continue;
    if (b.duration?.kind === "phase") { next.push(b); continue; }

    const before = Math.trunc(Number(b.duration?.remainingTurns ?? b.turns ?? 0));
    const after = before - 1;

    push("buffTick", "system", {
      target: f.side,
      stat: b.stat,
      amount: b.amount,
      before,
      after: Math.max(0, after),
      id: b.id ?? null,
    });

    if (after > 0) {
      next.push({ ...b, duration: { kind: "turns", remainingTurns: after } });
    } else {
      push("buffExpired", "system", {
        code: "BUFF_EXPIRED",
        target: f.side,
        stat: b.stat,
        amount: b.amount,
        id: b.id ?? null,
      });
    }
  }

  f.buffs = next;
}

function judge(p1, p2) {
  const p1Dead = p1.hp <= 0;
  const p2Dead = p2.hp <= 0;
  if (p1Dead && p2Dead) return "draw";
  if (p1Dead) return "P2_win";
  if (p2Dead) return "P1_win";
  return "continue";
}

/* =========================
   Cスキル（実行本体）
   effect の実行自体は effects.js に寄せる
========================= */
function maybeUseCSkill(atk, def, ctx) {
  const cs = atk.duck?.cSkill;
  if (!cs || !cs.effect) return;

  if (String(cs.trigger ?? "") === "beforeTurnEnd") return;

  const cost = cs.costAP ?? 0;
  if ((atk.ap ?? 0) < cost) return;

  atk.ap -= cost;

// APが動いたので常時バフ再判定
const refresh = ctx.helpers?.refreshPassives;
if (typeof refresh === "function") refresh();
  ctx.actor = atk;
  ctx.enemy = def;

  const skillInfo = {
    owner: atk.side,
    category: "C",
    skillId: cs.id,
    skillName: cs.name,
  };

  const groupId = ctx.newGroupId();

  ctx.withOrigin({ originSkill: skillInfo, groupId }, () => {
    // Cスキル発動ログ（親）
    ctx.push("cSkillActivated", atk.side, {
      code: "C_SKILL_ACTIVATED",
      skill: { category: "C", skillId: cs.id, skillName: cs.name },
      groupId,
    });

    // 以降の effect ログは originSkill/groupId が自動付与される
    applyEffect(cs.effect, ctx);
  });
}

function maybeUseCSkillBeforeTurnEnd(atk, def, ctx) {
  const cs = atk.duck?.cSkill;
  if (!cs || !cs.effect) return;

  // このタイプのCスキルだけターン終了時に見る
  if (String(cs.trigger ?? "") !== "beforeTurnEnd") return;
  if ((atk.hp ?? 0) > 0) return;

  // もう今回なにも起きないCスキルなら、AP消費もログも出さない
  if (!canActivateCSkill(atk, cs)) return;

  const cost = cs.costAP ?? 0;
  if ((atk.ap ?? 0) < cost) return;

  atk.ap -= cost;
  ctx.helpers.refreshPassives();

  ctx.actor = atk;
  ctx.enemy = def;

  const skillInfo = {
    owner: atk.side,
    category: "C",
    skillId: cs.id,
    skillName: cs.name,
  };

  const groupId = ctx.newGroupId();

  ctx.withOrigin({ originSkill: skillInfo, groupId }, () => {
    // Cスキル発動ログ（親）
    ctx.push("cSkillActivated", atk.side, {
      code: "C_SKILL_ACTIVATED",
      skill: { category: "C", skillId: cs.id, skillName: cs.name },
      trigger: "beforeTurnEnd",
      groupId,
    });

    applyEffect(cs.effect, ctx);
  });
}

function canActivateCSkill(atk, cs) {
  const list = Array.isArray(cs?.effect) ? cs.effect : (cs?.effect ? [cs.effect] : []);
  if (list.length === 0) return false;

  // effect が全部「onceで、すでにflag済み」なら何も起きないので発動させない
  for (const e of list) {
    if (!e || typeof e !== "object") continue;

    const once = Boolean(e.once);
    const flagKey = String(e.flagKey ?? "").trim();

    if (once && flagKey) {
      const used = Boolean(atk.flags?.[flagKey]);
      if (!used) return true; // まだ未使用のonce効果がある＝発動する価値あり
      continue;
    }

    // once指定でないeffectが1つでもあれば、発動する価値あり
    return true;
  }

  return false;
}

/* =========================
   実効AT/DF：duration buffとB常時modifierは別系統で加算
========================= */

function getEffectiveAT(f) {
  const base = (f.at ?? 0) + sumBuff(f, "AT");
  const p = f.runtime?.passive?.AT ?? 0;
  const v = base + p;
  return Math.max(0, v);
}

function getEffectiveDF(f) {
  const base = (f.df ?? 0) + sumBuff(f, "DF");
  const p = f.runtime?.passive?.DF ?? 0;
  const v = base + p;
  return Math.max(0, v);
}
