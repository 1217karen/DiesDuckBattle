import { evaluateCondition } from "./conditionEvaluator.js";
import { STATUS_GROUPS } from "./statusGroups.js";
import { addTimedHitRule } from "./timedHitRules.js";

/// effects.js
// 方針：effect.type を最小化し、実行はここに集約する
//
// 対応する effect.type：
// - addDice
//     ダイスプールに値を追加する（戦闘中永続）
//
// - changeValue
//     数値系の直接操作
//     対象キー：
//       hp（※基本は heal / fixedDamage を使う）
//       ap
//       tempDfPlus（旧入力互換。内部ではphase DF buff）
//       nextAttackATPlus
//       attackTimesOverride（null可）
//       attackTimesAdd
//       additionalRecoil / skipDice1,3,4,5（phase一時値）
//       recoilMinus
//
// - changeStatus
//     状態スタックの付与・変更
//     対象：crack / tailwind / focus / Headwind / roughWave / counter / clean / steam
//     ※ clean がある場合、一部デバフ付与をスタック分だけ防ぐ
//
// - randomPick
//     picks 配列から1つランダムに選んで実行する
//
// - changeAttack
//     攻撃1回分の内容を書き換える
//     （miss / ダメージ加算・乗算 / hit・avoided の直接指定など）
//
// - fixedDamage
//     DF・status を無視した固定ダメージ
//     ・amount: 固定値ダメージ
//     ・byStatusCount: 状態数×n の固定ダメージ
//     ・amountPct: 現在HPを基準にした割合ダメージ（切り捨て）
//       ※ HP<=0 の場合は 0 ダメージ
//
// - addBuff
//     phase / turns:N の AT / DF バフ（旧turns形式、once/flagKeyも対応）
//
// - heal
//     HP回復（maxHP まで）
//
// - revive
//     旧hp/once復活、およびmaxHpPctによる最大HP割合復活
// - clearStatus
//     指定statusまたはgroupの全stackを決定的に解除
// - removeRandomStatusStack
//     指定groupの付与中statusからランダムに1種類選び、1stackだけ解除
// - addTimedHitRule
//     turns期間、通常攻撃命中処理後にchangeStatusを実行する内部ruleを付与
//
// - changeCooldown
//    クールダウン処理

export function applyEffect(effect, ctx) {
  // 配列
  if (Array.isArray(effect)) {
    for (const e of effect) applyEffect(e, ctx);
    return;
  }
  if (!effect || typeof effect !== "object") return;

  // ログ出力は ctx.push を最優先（push引数に依存しない）
  const emit = typeof ctx?.push === "function" ? ctx.push : () => {};

  // when 条件（満たさないなら何もしない）
  if (effect.when !== undefined) {
    const ok = evaluateCondition(effect.when, ctx);
    if (!ok) return;
  }

  // repeat
  const timesNum = Number(effect.repeat ?? 1);
  if (!Number.isFinite(timesNum)) return;
  const times = Math.max(1, Math.trunc(timesNum));

  if (times > 1) {
    const eff = { ...effect };
    delete eff.repeat;
    for (let i = 0; i < times; i++) applyEffect(eff, ctx);
    return;
  }

  // chance 判定
  if (effect.chance !== undefined) {
    const p = Number(effect.chance);
    if (!Number.isFinite(p)) return;
    const prob = Math.max(0, Math.min(1, p));
    const roll = typeof ctx?.rng === "function" ? ctx.rng() : Math.random();
    const ok = roll < prob;

    emit("chanceRoll", ctx.actor?.side ?? "system", {
      code: "CHANCE_ROLL",
      probability: prob,
      success: ok,
      effectType: String(effect.type ?? ""),
    });

    if (!ok) {
      if (effect.onFail !== undefined) applyEffect(effect.onFail, ctx);
      return;
    }
  }

  const type = String(effect.type ?? "");

  switch (type) {
    case "addDice":
      return effAddDice(effect, ctx, emit);
    case "changeValue":
      return effChangeValue(effect, ctx, emit);
    case "changeStatus":
      return effChangeStatus(effect, ctx, emit);
    case "randomPick":
      return effRandomPick(effect, ctx, emit);
    case "changeAttack":
      return effChangeAttack(effect, ctx, emit);
    case "fixedDamage":
      return effFixedDamage(effect, ctx, emit);
    case "addBuff":
      return effAddBuff(effect, ctx, emit);
    case "heal":
      return effHeal(effect, ctx, emit);
    case "revive":
      return effRevive(effect, ctx, emit);
    case "clearStatus":
      return effClearStatus(effect, ctx, emit);
    case "removeRandomStatusStack":
      return effRemoveRandomStatusStack(effect, ctx, emit);
    case "addTimedHitRule":
      return addTimedHitRule(effect, ctx, emit);
    case "changeCooldown":
      return effChangeCooldown(effect, ctx, emit);

    default:
      emit("note", ctx.actor?.side ?? "system", {
        code: "EFFECT_TYPE_UNSUPPORTED",
        effectType: String(effect.type ?? ""),
      });
      return;
  }
}

/* =========================
   addDice
========================= */
function effAddDice(eff, ctx, emit) {
  const tgt = pickTarget(eff.target, ctx);
  if (!tgt) return;

  const raw = Array.isArray(eff.values) ? eff.values : [];

  // 数値だけ許可
  const values = raw
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n));

  if (values.length === 0) {
    emit("note", ctx.actor?.side ?? "system", {
      code: "ADD_DICE_VALUES_INVALID_OR_EMPTY",
    });
    return;
  }

  tgt.dicePool = Array.isArray(tgt.dicePool) ? tgt.dicePool : [];
  tgt.dicePool.push(...values);

  emit("diceAdded", ctx.actor?.side ?? "system", {
    code: "DICE_ADDED",
    target: tgt.side,
    values: [...values],
    rawValues: raw, // デバッグ用
  });
}

/* =========================
   changeValue
   key: "hp" | "ap" | "tempDfPlus" | "nextAttackATPlus"
        | "attackTimesOverride" | "attackTimesAdd" | "recoilMinus"
   op : "add" | "set" | "setMax" | "setMin"
========================= */
function effChangeValue(eff, ctx, emit) {
  const tgt = pickTarget(eff.target ?? "self", ctx);
  if (!tgt) return;

  const key = String(eff.key ?? "");
  const op = String(eff.op ?? "add");
  const value =
    key === "attackTimesOverride" && eff.value === null
      ? null
      : readValueNumber(eff.value ?? 0, ctx);

  if (key !== "attackTimesOverride" && value == null) return;

  const before = getValueByKey(tgt, key);

  // 未対応キーだけ弾
  if (before == null && key !== "attackTimesOverride") {
    emit("note", ctx.actor?.side ?? "system", {
      code: "CHANGE_VALUE_KEY_UNSUPPORTED",
      key,
    });
    return;
  }

  // attackTimesOverride が null（上書き無し）の状態では、op=set のみ許可（曖昧さ防止）
  if (key === "attackTimesOverride" && before === null && op !== "set") {
    emit("note", ctx.actor?.side ?? "system", {
      code: "CHANGE_VALUE_OP_UNSUPPORTED_FOR_NULL",
      key,
      op,
    });
    return;
  }

  let after = before;

  if (op === "add") after = before + value;
  else if (op === "set") after = value;
  else if (op === "setMax") after = Math.max(before, value);
  else if (op === "setMin") after = Math.min(before, value);
  else {
    emit("note", ctx.actor?.side ?? "system", {
      code: "CHANGE_VALUE_OP_UNSUPPORTED",
      key,
      op,
    });
    return;
  }

  // HPは上限だけ clamp（マイナスは許可）
  if (key === "hp") after = Math.min(tgt.maxHP ?? after, after);

  // APは0未満にならないようにする
  if (key === "ap") after = Math.max(0, after);
  // attackTimesOverride / attackTimesAdd / recoilMinus は整数（ただし override は null を許可）
  if (key === "attackTimesOverride") {
    if (after !== null) after = Math.trunc(after);
  } else if (key === "attackTimesAdd") {
    after = Math.trunc(after);
  } else if (key === "recoilMinus") {
    after = Math.trunc(after);
  }

  setValueByKey(tgt, key, after);

  // HP/APの直接変更でも既存の常時バフを再判定する。
  if (key === "hp" || key === "ap") {
  const refresh = ctx.helpers?.refreshPassives;
  if (typeof refresh === "function") refresh();
}
  const tag =
    key === "hp"
      ? "HP"
      : key === "ap"
        ? "AP"
        : key === "tempDfPlus"
          ? "DF(phase)"
          : key === "nextAttackATPlus"
            ? "AT(next)"
            : key === "attackTimesOverride"
              ? "AttackTimes(override)"
              : key === "attackTimesAdd"
                ? "AttackTimes(+)"
                : key;

  const delta =
    typeof before === "number" && typeof after === "number" ? after - before : null;

  emit("valueChanged", ctx.actor?.side ?? "system", {
    target: tgt.side,
    key,
    tag,
    before,
    after,
    delta,
    source: eff.source ?? null,
    note: eff.note ?? null,
  });
}

/* =========================
   changeStatus
   status: "crack" | "tailwind" | "focus" | "Headwind"
           | "roughWave" | "counter" | "clean" | "steam"
   op    : "add" | "set"
========================= */
function effChangeStatus(eff, ctx, emit) {
  const tgt = pickTarget(eff.target ?? "enemy", ctx);
  if (!tgt) return;

  const status = resolveStatusSpec(eff.status, ctx, emit);
  if (!status) return;

  const op = String(eff.op ?? "add");
  let value = readValueNumber(eff.value ?? 1, ctx);
  if (value == null) return;


  // =========================
  // 清潔（clean）：デバフ付与をスタック分だけ防ぐ
  // 対象：crack / Headwind / roughWave / steam
  // 条件：
  //   - op === "add"
  //   - value > 0
  //   - 付与先（tgt）が clean を持っている
  // 挙動：
  //   - clean を blocked 分だけ消費し、付与量 value を差し引く
  //   - 差し引き後 value <= 0 なら、このデバフ付与は完全に無効化して return
  // =========================
  {
    const isAdd = op === "add";
    const isPositive = Number.isFinite(value) && value > 0;

    const isDebuff = STATUS_GROUPS.debuff.includes(status);

    const cleanNow = Number(tgt.status?.clean ?? 0);
    const hasClean = Number.isFinite(cleanNow) && cleanNow > 0;

    // 「清潔そのもの」を防ぐのは意味が変わるので除外
    if (isAdd && isPositive && isDebuff && hasClean && status !== "clean") {
      const blocked = Math.min(cleanNow, Math.trunc(value));
      if (blocked > 0) {
        // 清潔を消費
        const beforeClean = Math.trunc(cleanNow);
        const afterClean = Math.max(0, beforeClean - blocked);
        tgt.status.clean = afterClean;
        ctx.helpers?.refreshPassives?.();

        emit("statusChange", ctx.actor?.side ?? "system", {
          code: "STATUS_CLEAN_CONSUMED",
          target: tgt.side,
          status: "clean",
          before: beforeClean,
          after: afterClean,
          delta: afterClean - beforeClean,
          blockedStatus: status,
          blockedAmount: blocked,
        });

        // 付与量を差し引く（残りが0以下なら、このデバフ付与は完全に防げた）
        value = Math.max(0, Math.trunc(value) - blocked);
        if (value <= 0) return;
      }
    }
  }

  if (!tgt.status || !(status in tgt.status)) {
    emit("note", ctx.actor?.side ?? "system", {
      code: "CHANGE_STATUS_UNSUPPORTED",
      status,
    });
    return;
  }

  const before = Number(tgt.status[status] ?? 0);
  const cap = Number(eff.maxStacks ?? ctx.helpers?.MAX_STACK ?? 3);

  let after = before;
  if (op === "add") after = before + value;
  else if (op === "set") after = value;
  else {
    emit("note", ctx.actor?.side ?? "system", {
      code: "CHANGE_STATUS_OP_UNSUPPORTED",
      status,
      op,
    });
    return;
  }

  after = clampInt(after, 0, cap);
  tgt.status[status] = after;
  ctx.helpers?.refreshPassives?.();

  emit("statusChange", ctx.actor?.side ?? "system", {
    target: tgt.side,
    status,
    before,
    after,
    delta: after - before,
  });
}

/* =========================
   randomPick
   - picks 配列から1つランダムに選んで実行
   params:
     picks: [ effect, effect, ... ]
========================= */
function effRandomPick(eff, ctx, emit) {
  const list = Array.isArray(eff.picks) ? eff.picks : [];
  if (list.length === 0) {
    emit("note", ctx.actor?.side ?? "system", {
      code: "RANDOM_PICK_EMPTY",
    });
    return;
  }

  const rng = typeof ctx?.rng === "function" ? ctx.rng : Math.random;

  const index = Math.floor(rng() * list.length);
  const picked = list[index];

  emit("randomPick", ctx.actor?.side ?? "system", {
    code: "RANDOM_PICK_SELECTED",
    index,
    total: list.length,
  });

  applyEffect(picked, ctx);
}

/* =========================
   changeAttack
   op:
     - "miss"            : この攻撃を無効化
     - "mulDamage"       : damage *= value
     - "addDamage"       : damage += value
     - "setDamage"       : damage = value
     - "setHit"          : hit を true/false に（基本は触らない想定）
     - "setAvoided"      : avoided を true/false に（基本は触らない想定）
========================= */
function effChangeAttack(eff, ctx, emit) {
  const a = ctx.attack;
  if (!a) {
    emit("note", ctx.actor?.side ?? "system", {
      code: "CHANGE_ATTACK_CTX_ATTACK_MISSING",
    });
    return;
  }

  const op = String(eff.op ?? "");
  const v = Number(eff.value ?? 0);

  // miss: 攻撃自体をスキップさせる
  if (op === "miss") {
    a.miss = true;
    emit("attackChanged", ctx.actor?.side ?? "system", {
      code: "ATTACK_MARKED_MISS",
      target: ctx.enemy?.side,
      op: "miss",
    });
    return;
  }

  // damage 系
  if (op === "mulDamage") {
    const before = Number(a.damageMul ?? 1);

    const factorInfo = readMulFactor(eff.value, ctx);
    if (!factorInfo) {
      emit("note", ctx.actor?.side ?? "system", {
        code: "CHANGE_ATTACK_MULDAMAGE_VALUE_INVALID",
      });
      return;
    }

    const factor = factorInfo.factor;
    const after = before * factor;
    a.damageMul = after;

    emit("attackChanged", ctx.actor?.side ?? "system", {
      target: ctx.enemy?.side,
      op: "mulDamage",
      before,
      after,
      value: factor, // 実際に掛かった倍率（ランダムなら確定値）
      detail: factorInfo.detail,
    });
    return;
  }

  if (op === "addDamage") {
    const before = Number(a.damage ?? 0);
    const after = before + v;
    a.damage = after;

    emit("attackChanged", ctx.actor?.side ?? "system", {
      target: ctx.enemy?.side,
      op: "addDamage",
      before,
      after,
      value: v,
    });
    return;
  }

  if (op === "setDamage") {
    const before = Number(a.damage ?? 0);
    const after = v;
    a.damage = after;

    emit("attackChanged", ctx.actor?.side ?? "system", {
      target: ctx.enemy?.side,
      op: "setDamage",
      before,
      after,
      value: v,
    });
    return;
  }

  // hit/avoided を触る
  if (op === "setHit") {
    const before = Boolean(a.hit);
    const after = Boolean(eff.value);
    a.hit = after;

    emit("attackChanged", ctx.actor?.side ?? "system", {
      target: ctx.enemy?.side,
      op: "setHit",
      before,
      after,
    });
    return;
  }

  if (op === "setAvoided") {
    const before = Boolean(a.avoided);
    const after = Boolean(eff.value);
    a.avoided = after;

    emit("attackChanged", ctx.actor?.side ?? "system", {
      target: ctx.enemy?.side,
      op: "setAvoided",
      before,
      after,
    });
    return;
  }

  emit("note", ctx.actor?.side ?? "system", {
    code: "CHANGE_ATTACK_OP_UNSUPPORTED",
    op,
  });
}

/* =========================
   fixedDamage
   - DF や status を無視して固定ダメージを与える
   - ダメージ量の指定方法（優先順）：
     1) amount
        固定値ダメージ（最優先）
     2) byStatusCount
        状態数×n の固定ダメージ
        ・byStatusCount.n : 1スタックあたりのダメージ
        ・byStatusCount.statuses : カウント対象status配列（省略時は tgt.status の全キー）
        ・各statusは「v>0 のスタック数（整数化）」を合算して count とする
     3) amountPct
        対象の「現在HP」を基準にした割合ダメージ
        ・計算：floor(max(0, currentHp) * max(0, amountPct))
        ・HP が 0 以下の場合は 0 ダメージ
   - 最低ダメージ保証は行わない（amount <= 0 なら何もしない）
   - ログ type: fixedDamage（dealDamage 側に渡す）
   params:
     target       : "self" | "enemy"（省略時 enemy）
     amount       : number（固定値、指定時は最優先）
     byStatusCount: { n: number, statuses?: string[] }
     amountPct    : number（0.0〜、現HP割合。負数は0扱い）
     source       : string（ログ用 任意）
========================= */
function effFixedDamage(eff, ctx, emit) {
  const tgt = pickTarget(eff.target ?? "enemy", ctx);
  if (!tgt) return;

  // battleEngine.js の makeCtx.helpers.dealDamage を使う
  const deal = ctx.helpers?.dealDamage;
  if (typeof deal !== "function") {
    emit("note", ctx.actor?.side ?? "system", {
      code: "FIXED_DAMAGE_DEAL_FN_MISSING",
    });
    return;
  }

  let amount = null;
  let calc = null;

// 固定 amount があるなら最優先（{read:"..."} も許可）
  if (eff.amount !== undefined && eff.amount !== null) {
    const n = readValueNumber(eff.amount, ctx);
    if (n == null) return;
    amount = Math.max(0, Math.trunc(n));
    calc = { kind: "amount", raw: n };
  }
    else if (eff.byStatusCount && typeof eff.byStatusCount === "object") {
    // 状態数 × n の固定ダメージ
    const n = Number(eff.byStatusCount.n ?? 0);
    if (!Number.isFinite(n)) return;

    const st = tgt.status ?? {};
    const keys = Array.isArray(eff.byStatusCount.statuses)
      ? eff.byStatusCount.statuses.map(String)
      : Object.keys(st);

    let count = 0;
    for (const k of keys) {
      const v = Number(st[k] ?? 0);
      if (Number.isFinite(v) && v > 0) count += Math.trunc(v);
    }

    amount = Math.max(0, Math.trunc(count * Math.trunc(n)));
    calc = {
      kind: "byStatusCount",
      count,
      n: Math.trunc(n),
      keys,
    };
  } else {
    // amountPct（割合）
    const pct = Number(eff.amountPct);
    if (!Number.isFinite(pct)) return;

    const baseHp = Math.max(0, Math.trunc(Number(tgt.hp ?? 0))); // HP<=0なら0
    const p = Math.max(0, pct); // マイナス割合は0扱い（＝ダメージ0）

    amount = Math.max(0, Math.floor(baseHp * p));
    calc = { kind: "amountPct", base: "currentHp", baseHp, pct: p, round: "floor" };
  }

  // ターンに応じて固定ダメージを増やす（例：5ターン毎に+10）
  if (eff.turnStep && typeof eff.turnStep === "object") {
    const every = Math.trunc(Number(eff.turnStep.every ?? 0));
    const add = Math.trunc(Number(eff.turnStep.add ?? 0));
    const turnNow = Math.trunc(Number(ctx?.turn ?? 0));

    if (every > 0 && Number.isFinite(add) && turnNow > 0) {
      const steps = Math.floor(turnNow / every); // 5,10,15...で1,2,3...
      if (steps > 0) {
        amount = Math.max(0, Math.trunc(amount + steps * add));
        calc = { ...(calc ?? {}), turnStep: { every, add, turn: turnNow, steps } };
      }
    }
  }

  if (amount <= 0) return;

  // 固定ダメージ適用（DF/status無視）
  deal(tgt, amount, ctx.actor?.side ?? "system", "fixedDamage", {
    code: "FIXED_DAMAGE",
    source: eff.source ?? "effect",
    calc,
  });
}

/* =========================
   addBuff
   - nターン持続する AT / DF の増減バフを付与する
   params:
     target : "self" | "enemy"（省略 self）
     stat   : "AT" | "DF"
     amount : number（整数化、0は何もしない）
     turns  : number（整数化、1以上）
     id     : any（任意。buff識別用に格納）
     source : any（任意。ログ/表示用）
     once   : boolean（trueの場合、この戦闘で1回だけ付与）
     flagKey: string（once=true 時に必須。tgt.flags[flagKey] で管理）
========================= */
function effAddBuff(eff, ctx, emit) {
  const tgt = pickTarget(eff.target ?? "self", ctx);
  if (!tgt) return;

  const stat = String(eff.stat ?? "");
  if (stat !== "AT" && stat !== "DF") {
    emit("note", ctx.actor?.side ?? "system", {
      code: "ADD_BUFF_STAT_UNSUPPORTED",
      stat,
    });
    return;
  }

  const amount = Math.trunc(Number(eff.amount ?? 0));
  // durationがcanonical。省略時だけ旧turns（既定1）を解釈する。
  const spec = eff.duration ?? { kind: "turns", count: eff.turns ?? 1 };
  if (spec.kind !== "phase" && spec.kind !== "turns") return;
  const turns = spec.kind === "turns" ? Math.trunc(Number(spec.count)) : undefined;
  if (!Number.isFinite(amount)) return;
  if (spec.kind === "turns" && (!Number.isFinite(turns) || turns <= 0)) return;
  if (amount === 0) return;

  // once 対応（この戦闘で1回だけ）
  const once = Boolean(eff.once ?? false);
  const flagKey = String(eff.flagKey ?? "").trim();

  if (once) {
    if (!flagKey) {
      emit("note", ctx.actor?.side ?? "system", {
        code: "ADD_BUFF_FLAGKEY_MISSING",
      });
      return;
    }

    tgt.flags = tgt.flags ?? {};
    if (tgt.flags[flagKey]) return;
    tgt.flags[flagKey] = true;
  }

  tgt.buffs = Array.isArray(tgt.buffs) ? tgt.buffs : [];

  const buff = {
    stat,
    amount,
    duration: spec.kind === "phase" ? { kind: "phase" } : { kind: "turns", remainingTurns: turns },
    id: eff.id ?? null,
    source: eff.source ?? null,
  };

  tgt.buffs.push(buff);

  emit("buffApplied", ctx.actor?.side ?? "system", {
    target: tgt.side,
    stat,
    amount,
    turns,
    duration: { ...buff.duration },
    id: buff.id,
    source: buff.source,
    once: once || undefined,
    flagKey: once ? flagKey : undefined,
  });
}

/* =========================
   heal
========================= */
function effHeal(eff, ctx, emit) {
  const tgt = pickTarget(eff.target ?? "self", ctx);
  if (!tgt) return;

  let amount = null;

// 固定 amount
if (eff.amount !== undefined) {
  const n = readValueNumber(eff.amount, ctx);
  if (n == null) return;
  amount = Math.max(0, Math.trunc(n));
}

// byStatusCount 対応（←追加）
else if (eff.byStatusCount && typeof eff.byStatusCount === "object") {

  const n = Number(eff.byStatusCount.n ?? 0);
  if (!Number.isFinite(n)) return;

  const st = tgt.status ?? {};
  const keys = Array.isArray(eff.byStatusCount.statuses)
    ? eff.byStatusCount.statuses.map(String)
    : Object.keys(st);

  let count = 0;

  for (const k of keys) {
    const v = Number(st[k] ?? 0);
    if (Number.isFinite(v) && v > 0) {
      count += Math.trunc(v);
    }
  }

  amount = Math.max(0, Math.trunc(count * Math.trunc(n)));
}

if (amount == null || amount <= 0) return;

  // 回復量の上限：eff.max があれば最大値として適用
  const capRaw = eff.max ?? eff.cap ?? null;
  if (capRaw !== null && capRaw !== undefined) {
    const capN = readValueNumber(capRaw, ctx);
    if (capN != null) {
      const cap = Math.max(0, Math.trunc(capN));
      // cap が 0 の場合は回復しない
      if (cap <= 0) return;
      // 上限適用
      if (amount > cap) amount = cap;
    }
  }
  const healFn = ctx.helpers?.heal;
  if (typeof healFn !== "function") {
    emit("note", ctx.actor?.side ?? "system", { code: "HEAL_FN_MISSING" });
    return;
  }

  healFn(tgt, amount, ctx.actor?.side ?? "system", {
    source: eff.source ?? "effect",
  });
}

/* =========================
   clearStatus：単一statusまたはgroupの全stack解除
========================= */
function effClearStatus(eff, ctx, emit) {
  const tgt = pickTarget(eff.target ?? "self", ctx);
  if (!tgt) return;
  // @groupのランダム選択とは別。指定groupの全種類を決定的に処理する。
  const keys = eff.group === "debuff" || eff.group === "buff" ? STATUS_GROUPS[eff.group]
    : STATUS_GROUPS.all.includes(eff.status) ? [eff.status] : [];
  for (const status of keys) {
    const before = tgt.status?.[status] ?? 0;
    if (before === 0) continue;
    tgt.status[status] = 0;
    emit("statusChange", ctx.actor?.side ?? "system", { code: "STATUS_CLEARED", target: tgt.side, status, before, after: 0, delta: -before });
  }
  ctx.helpers?.refreshPassives?.();
}

/* =========================
   removeRandomStatusStack
   target: "self" | "enemy"（省略 self）
   group : "buff" | "debuff"
   stack数では重み付けせず、付与中の種類から等確率で選ぶ。
========================= */
function effRemoveRandomStatusStack(eff, ctx, emit) {
  const tgt = pickTarget(eff.target ?? "self", ctx);
  if (!tgt) return;
  if (eff.group !== "buff" && eff.group !== "debuff") return;

  const candidates = STATUS_GROUPS[eff.group].filter(status => {
    const stacks = Number(tgt.status?.[status] ?? 0);
    return Number.isFinite(stacks) && stacks >= 1;
  });
  if (candidates.length === 0) return;

  const rng = typeof ctx?.rng === "function" ? ctx.rng : Math.random;
  const status = candidates[Math.floor(rng() * candidates.length)];
  const before = Number(tgt.status[status]);
  const after = Math.max(0, before - 1);
  tgt.status[status] = after;
  ctx.helpers?.refreshPassives?.();

  emit("statusChange", ctx.actor?.side ?? "system", {
    code: "RANDOM_STATUS_STACK_REMOVED", target: tgt.side, group: eff.group,
    status, before, after, delta: after - before,
  });
}

/*
 * revive: 旧hp/once/flagKey形式、または新版maxHpPct形式。
 * 新版の反復確率はctx.specialCActivationのtrusted設定から取得する。
 */
function effRevive(eff, ctx, emit) {
  const tgt = pickTarget(eff.target ?? "self", ctx);
  if (!tgt) return;

  // 新canonical variant。固定HP/onceの旧分岐は以下にそのまま残す。
  if (Object.hasOwn(eff, "maxHpPct")) {
    const pct = eff.maxHpPct;
    if (!Number.isFinite(pct) || pct < 0 || pct > 1 || !Number.isFinite(tgt.maxHP)) return;
    const activation = ctx.specialCActivation;
    if (activation?.count > 1) {
      const probability = activation.repeatReviveChance;
      if (!Number.isFinite(probability) || probability < 0 || probability > 1)
        throw new TypeError("Repeated percentage revive requires trusted repeatReviveChance in [0, 1]");
      const success = ctx.rng() < probability;
      emit("reviveRoll", ctx.actor?.side ?? "system", { target: tgt.side, maxHpPct: pct,
        activationCount: activation.count, probability, success });
      if (!success) return;
    }
    const before = tgt.hp;
    const targetHP = Math.floor(tgt.maxHP * pct);
    tgt.hp = Math.max(before, targetHP);
    emit("revived", ctx.actor?.side ?? "system", { target: tgt.side, hpBefore: before, hpAfter: tgt.hp,
      maxHpPct: pct, targetHP, activationCount: activation?.count ?? null });
    ctx.helpers?.refreshPassives?.();
    return;
  }

  const hp = Number(eff.hp ?? 10);
  const once = Boolean(eff.once ?? true);
  const flagKey = String(eff.flagKey ?? "revivedOnce");

  tgt.flags = tgt.flags ?? {};

  if (once && tgt.flags[flagKey]) return;

  const before = tgt.hp;
  tgt.hp = Math.min(tgt.maxHP ?? hp, hp);

  if (once) tgt.flags[flagKey] = true;

  emit("revived", ctx.actor?.side ?? "system", {
    target: tgt.side,
    hpBefore: before,
    hpAfter: tgt.hp,
    once,
    flagKey,
  });

  // HP条件パッシブのON/OFFを再判定
  const refresh = ctx.helpers?.refreshPassives;
  if (typeof refresh === "function") refresh();
}

/* =========================
   changeCooldown
   - クールダウンを操作する
   params:
     target: "self" | "enemy"（省略 self）
     scope : "turn" | "phase"（省略 turn）
     key   : string（例: "B:skill_xxx"）
     op    : "set" | "add" | "setMax" | "setMin"（省略 set）
     value : number
========================= */
function effChangeCooldown(eff, ctx, emit) {
  const tgt = pickTarget(eff.target ?? "self", ctx);
  if (!tgt) return;

  const scope = String(eff.scope ?? "turn");
  if (scope !== "turn" && scope !== "phase") {
    emit("note", ctx.actor?.side ?? "system", {
      code: "CHANGE_COOLDOWN_SCOPE_UNSUPPORTED",
      scope,
    });
    return;
  }

  const key = String(eff.key ?? "").trim();
  if (!key) {
    emit("note", ctx.actor?.side ?? "system", {
      code: "CHANGE_COOLDOWN_KEY_MISSING",
    });
    return;
  }

  const op = String(eff.op ?? "set");
  const v = Number(eff.value ?? 0);
  if (!Number.isFinite(v)) return;

  tgt.cooldowns = tgt.cooldowns ?? { turn: {}, phase: {} };
  tgt.cooldowns[scope] = tgt.cooldowns[scope] ?? {};

  const before = Math.max(0, Math.trunc(Number(tgt.cooldowns[scope][key] ?? 0)));

  let after = before;
  if (op === "set") after = Math.trunc(v);
  else if (op === "add") after = before + Math.trunc(v);
  else if (op === "setMax") after = Math.max(before, Math.trunc(v));
  else if (op === "setMin") after = Math.min(before, Math.trunc(v));
  else {
    emit("note", ctx.actor?.side ?? "system", {
      code: "CHANGE_COOLDOWN_OP_UNSUPPORTED",
      op,
    });
    return;
  }

  after = Math.max(0, after);
  tgt.cooldowns[scope][key] = after;

  emit("cooldownChanged", ctx.actor?.side ?? "system", {
    code: "COOLDOWN_CHANGED",
    target: tgt.side,
    scope,
    key,
    before,
    after,
    delta: after - before,
    source: eff.source ?? null,
  });
}

/* =========================
   util
========================= */
function pickTarget(target, ctx) {
  if (target === "self") return ctx.actor;
  if (target === "enemy") return ctx.enemy;
  return ctx.actor; // 省略や未知は selfでいい
}

function readValueNumber(value, ctx) {
  // 数値はそのまま
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  if (value && typeof value === "object") {
    const path = String(value.read ?? "").trim();
    if (!path) return null;

    const n = readValuePath(path, ctx);
    const num = Number(n);
    return Number.isFinite(num) ? num : null;
  }

  return null;
}

// 読めるパス（最小）
// - "turn" / "phase"
// - "self.hp" / "self.ap" / "enemy.hp" / "enemy.ap"
// - "self.status:xxx" / "enemy.status:xxx"
function readValuePath(path, ctx) {
  if (path.startsWith("self.status:")) {
    const k = path.slice("self.status:".length).trim();
    return Number(ctx?.actor?.status?.[k] ?? 0);
  }
  if (path.startsWith("enemy.status:")) {
    const k = path.slice("enemy.status:".length).trim();
    return Number(ctx?.enemy?.status?.[k] ?? 0);
  }

  switch (path) {
    case "turn":
      return ctx?.turn;
    case "phase":
      return ctx?.phase;

    case "self.hp":
      return ctx?.actor?.hp;
    case "self.ap":
      return ctx?.actor?.ap;

    case "enemy.hp":
      return ctx?.enemy?.hp;
    case "enemy.ap":
      return ctx?.enemy?.ap;

    default:
      return undefined;
  }
}

function resolveStatusSpec(rawStatus, ctx, emit) {
  const s = String(rawStatus ?? "").trim();
  if (!s) return null;

  // グループ指定: "@all" / "@debuff" / "@buff"
  if (s.startsWith("@")) {
    const key = s.slice(1).trim().toLowerCase();
    const list = STATUS_GROUPS[key];

    if (!Array.isArray(list) || list.length === 0) {
      emit("note", ctx.actor?.side ?? "system", { code: "CHANGE_STATUS_GROUP_UNSUPPORTED", status: s });
      return null;
    }

    const rng = typeof ctx?.rng === "function" ? ctx.rng : Math.random;
    const i = Math.floor(rng() * list.length);
    return list[i];
  }

  // 通常の単体指定
  return s;
}

// ランダム倍率
function readMulFactor(value, ctx) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return { factor: value, detail: { kind: "number" } };
  }

  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return { factor: n, detail: { kind: "string" } };
  }

  if (value && typeof value === "object") {
    const ru = value.randUniform;
    if (Array.isArray(ru) && ru.length >= 2) {
      const a = Number(ru[0]);
      const b = Number(ru[1]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

      const lo = Math.min(a, b);
      const hi = Math.max(a, b);

      const r = typeof ctx?.rng === "function" ? ctx.rng() : Math.random();
      const t = Number.isFinite(r) ? r : Math.random();

      const raw = lo + t * (hi - lo);
      const factor = Math.round(raw * 10) / 10;

      return {
        factor,
        detail: { kind: "randUniform", range: [lo, hi], roll: t },
      };
    }
  }

  return null;
}

function clampInt(v, lo, hi) {
  const n = Number.isFinite(v) ? v : 0;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function getValueByKey(f, key) {
  switch (key) {
    case "hp":
      return Number(f.hp);
    case "ap":
      return Number(f.ap);
    case "tempDfPlus":
      return (f.buffs ?? []).filter(b => b.legacyKey === "tempDfPlus")
        .reduce((total, b) => total + b.amount, 0);
    case "nextAttackATPlus":
      return Number(f.nextAttackATPlus ?? 0);
    case "additionalRecoil":
    case "skipDice1": case "skipDice3": case "skipDice4": case "skipDice5":
      return Number(f.temp?.[key] ?? 0);
    case "recoilMinus":
      return Number(f.temp?.recoilMinus ?? 0);

    // 攻撃回数（フェイズ内）
    case "attackTimesOverride": {
      const v = f.temp?.attackTimesOverride;
      return v === null || v === undefined ? null : Number(v);
    }

    case "attackTimesAdd":
      return Number(f.temp?.attackTimesAdd ?? 0);

    default:
      return null;
  }
}

function setValueByKey(f, key, value) {
  switch (key) {
    case "hp":
      f.hp = value;
      return;
    case "ap":
      f.ap = value;
      return;

    case "tempDfPlus":
      // 旧changeValueのset/min/maxも、互換分の合計との差分として保持する。
      // 通常のDF buffには干渉せず、個々の補正を統合・上書きしない。
      f.buffs = f.buffs ?? [];
      const delta = value - getValueByKey(f, key);
      if (delta !== 0) f.buffs.push({ stat: "DF", amount: delta,
        duration: { kind: "phase" }, legacyKey: "tempDfPlus", id: null, source: null });
      return;

    case "nextAttackATPlus":
      f.nextAttackATPlus = value;
      return;

    // 攻撃回数（フェイズ内）
    case "attackTimesOverride":
      f.temp = f.temp ?? {};
      f.temp.attackTimesOverride = value;
      return;

    case "attackTimesAdd":
      f.temp = f.temp ?? {};
      f.temp.attackTimesAdd = value;
      return;

    case "additionalRecoil":
    case "skipDice1": case "skipDice3": case "skipDice4": case "skipDice5":
      f.temp = f.temp ?? {};
      f.temp[key] = Math.max(0, Math.trunc(value));
      return;

    case "recoilMinus":
      f.temp = f.temp ?? {};
      f.temp.recoilMinus = value;
      return;

    default:
      return;
  }
}
