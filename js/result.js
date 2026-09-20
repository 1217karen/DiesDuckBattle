// result.js
import { getBattleById } from "./storage.js";
import { BATTLERS } from "./data.js";

/* ==========
  DOM
========== */
const logArea = document.getElementById("logArea");

const btnNext = document.getElementById("btnNext");
const btnAll = document.getElementById("btnAll");
const btnBack = document.getElementById("btnBack");

// Header elements
const elP1Name = document.getElementById("p1Name");
const elP2Name = document.getElementById("p2Name");

const elP1BattlerIcon = document.getElementById("p1BattlerIcon");
const elP1DuckIcon = document.getElementById("p1DuckIcon");
const elP2BattlerIcon = document.getElementById("p2BattlerIcon");
const elP2DuckIcon = document.getElementById("p2DuckIcon");

const elTurn = document.getElementById("centerTurn");
let elHP_P1;
let elHP_P2;
let elAP_P1;
let elAP_P2;
const elPhase = document.getElementById("centerPhase");

/* ==========
  URL battleId
========== */
const params = new URLSearchParams(location.search);
const battleId = params.get("battleId");

if (!battleId) {
  showError("battleId が指定されていません");
  throw new Error("No battleId");
}

const record = getBattleById(battleId);
elHP_P1 = document.getElementById("centerHP_P1");
elHP_P2 = document.getElementById("centerHP_P2");
elAP_P1 = document.getElementById("centerAP_P1");
elAP_P2 = document.getElementById("centerAP_P2");
if (!record) {
  showError(
    "指定された戦闘が見つかりません（履歴が消されている可能性があります）"
  );
  throw new Error("Battle not found");
}

/* ==========
  battleStart meta を取得
========== */
const battleStart = record.events.find((e) => e.type === "battleStart");
if (!battleStart?.meta?.P1 || !battleStart?.meta?.P2) {
  showError("battleStart 情報が見つかりません");
  throw new Error("Missing battleStart meta");
}

const metaP1 = battleStart.meta.P1;
const metaP2 = battleStart.meta.P2;

const maxHP = {
  P1: metaP1.maxHP ?? 0,
  P2: metaP2.maxHP ?? 0,
};

// バトラー名・アヒル名を分離して保持
const names = {
  P1: {
    battler: metaP1.battlerName ?? metaP1.battlerId ?? "P1バトラー",
    duck: metaP1.duckName ?? metaP1.duckId ?? "P1アヒル",
  },
  P2: {
    battler: metaP2.battlerName ?? metaP2.battlerId ?? "P2バトラー",
    duck: metaP2.duckName ?? metaP2.duckId ?? "P2アヒル",
  },
};

/* ==========
  アイコンパス
========== */
// battler は data.icons を優先、なければ旧パス
const b1 = getBattlerById(metaP1.battlerId);
const b2 = getBattlerById(metaP2.battlerId);

const battlerBySide = { P1: b1, P2: b2 };

setIfExists(
  elP1BattlerIcon,
  "src",
  b1?.icons?.neutral ?? `img/Battlers/icon/${metaP1.battlerId}_01.png`
);
setIfExists(
  elP2BattlerIcon,
  "src",
  b2?.icons?.neutral ?? `img/Battlers/icon/${metaP2.battlerId}_01.png`
);

// duck icon
const duckIconP1 =
  metaP1.duckIcons?.icon ?? `img/Duck/${metaP1.duckId}.png`;
const duckIconP2 =
  metaP2.duckIcons?.icon ?? `img/Duck/${metaP2.duckId}.png`;

setIfExists(elP1DuckIcon, "src", duckIconP1);
setIfExists(elP2DuckIcon, "src", duckIconP2);

// ヘッダー名前
elP1Name.textContent = `${names.P1.battler} ＋ ${names.P1.duck}`;
elP2Name.textContent = `${names.P2.battler} ＋ ${names.P2.duck}`;

// ==========
// code → 表示（ここに文章を集約）
// ==========
// ===== フィールド効果の表示文言（result用）=====
const FIELD_TEXTS = {
  hotBath: {
    title: "熱湯風呂",
    desc: "フェイズ開始時、固定1～5ダメージ！",
  },
  foamBath: {
    title: "泡風呂",
    desc: "フェイズ開始時、HPが1～5回復！",
  },
  iceBath: {
    title: "氷風呂",
    desc: "通常攻撃のダメージが常に×2！",
  },
  electricBath: {
    title: "電気風呂",
    desc: "ターン開始時のAP増加量が2に変化！",
  },
};

function getFieldText(metaField) {
  const id = String(metaField?.id ?? "").trim();
  if (!id) return null;

  const fallbackName = String(metaField?.name ?? "").trim();
  const t = FIELD_TEXTS[id];

  const title = t?.title ?? (fallbackName || id);
  const desc = t?.desc ?? "効果の説明は未設定です。";

  return { id, title, desc };
}

const CODE_RENDERERS = {

PHASE1_DICE_DOUBLE: (ev) => {
  return [{
    kind: "meta",
    text: `初回行動ボーナス！出目威力 ×2！`,
  }];
},

  // --- スキル ---
  SKILL_TRIGGERED: (ev) => {
    const cat = String(ev.skill?.category ?? "");
    const side = ev.actor; // "P1" or "P2"

    // 表示名
    const label =
      cat === "A"
        ? "アヒルスキル"
        : cat === "B"
        ? "バトラースキル"
        : cat === "D"
        ? "ダイススキル"
        : "スキル";

    const owner =
      cat === "B" || cat === "D" ? battlerNameOf(side) : duckNameOf(side);

    // 色分けはB/Dだけ
    const extraClass =
      cat === "B" || cat === "D"
        ? side === "P1"
          ? "p1"
          : side === "P2"
          ? "p2"
          : ""
        : "";

    return [{
      kind: `note${extraClass ? " " + extraClass : ""}`,
      text: `${escapeHTML(owner)}の${escapeHTML(label)}！`,
    }];
  },

  C_SKILL_ACTIVATED: (ev) => {
    const owner = duckNameOf(ev.actor);

    return [{
      kind: "note",
      text: `APチャージ完了！<br>${escapeHTML(owner)}のチャージスキル！`,
    }];
  },

  // --- 確率 ---
  CHANCE_ROLL: (ev) => {
    const p =
      typeof ev.probability === "number"
        ? Math.round(ev.probability * 100)
        : null;
    const tail = p === null ? "" : `（${p}%）`;
    return [{
      kind: "meta",
      text: `確率判定 ${ev.success ? "成功" : "失敗"}！${tail}`,
    }];
  },

  // --- ダイス追加 ---
  DICE_ADDED: (ev) => {
    const values = Array.isArray(ev.values) ? ev.values.join("、") : "";
    return [{
      kind: "soft",
      text: `${duckNameOf(ev.target)}にダイス追加：${escapeHTML(values)}`,
    }];
  },

  // --- 荒波 ---
  STATUS_ROUGH_WAVE_ROLL: (ev) => {
    const duck = escapeHTML(duckNameOf(ev.target));
    const name = statusLabel("roughWave");

    const before =
      typeof ev.stacks === "number" && Number.isFinite(ev.stacks)
        ? Math.trunc(ev.stacks)
        : null;
    const after = 0;

    const hint =
      before !== null
        ? ` <span class="miniHint">（荒波 ${before}→${after}）</span>`
        : "";

    return [
      { kind: "note status", text: `${duck}の${escapeHTML(name)}！` },
      {
        kind: "meta",
        text: `${duck}に荒波が襲いかかる…… ${
          ev.success ? "命中" : "回避"
        }！${hint}`,
      },
    ];
  },

  ACTION_CANCELED_ROUGH_WAVE: (ev) => {
    const duck = escapeHTML(duckNameOf(ev.target));

    return [{
      kind: "soft",
      text: `<i>${duck}は荒波のせいで行動できない！</i>`,
    }];
  },

  // --- 湯気（命中率低下） ---
  STATUS_STEAM_ROLL: (ev) => {
    const duck = escapeHTML(duckNameOf(ev.target));
    const name = statusLabel("steam");

    const before =
      typeof ev.stacks === "number" && Number.isFinite(ev.stacks)
        ? Math.trunc(ev.stacks)
        : null;
    const after = 0;

    const hint =
      before !== null
        ? ` <span class="miniHint">（湯気 ${before}→${after}）</span>`
        : "";

    const p =
      typeof ev.probability === "number"
        ? Math.round(ev.probability * 100)
        : null;
    const tail = p === null ? "" : `（${p}%）`;

    return [
      { kind: "note status", text: `${duck}の${escapeHTML(name)}！` },
      {
        kind: "meta",
        text: `${duck}は湯気に包まれている…… ${
          ev.success ? "脱出失敗" : "脱出"
        }！${hint}`,
      },
    ];
  },

  // --- 亀裂 ---
  STATUS_CRACK_DAMAGE: (ev) => {
    const duck = escapeHTML(duckNameOf(ev.target));
    const name = statusLabel("crack");
    const v = ev.value ?? 0;

    return [
      { kind: "note status", text: `${duck}の${escapeHTML(name)}！` },
      {
        kind: "soft",
        text: `<i>${duck}は${escapeHTML(name)}の効果で ${num(
          "damage",
          v
        )} ダメージ！</i>`,
      },
    ];
  },

  // --- 逆風 ---
  STATUS_HEADWIND_ROLL: (ev) => {
    const duck = escapeHTML(duckNameOf(ev.target));
    const name = statusLabel("Headwind");

    const before =
      typeof ev.stacks === "number" && Number.isFinite(ev.stacks)
        ? Math.trunc(ev.stacks)
        : null;

    const after =
      typeof ev.after === "number" && Number.isFinite(ev.after)
        ? Math.trunc(ev.after)
        : 0;

    const hint =
      before !== null
        ? ` <span class="miniHint">（逆風 ${before}→${after}）</span>`
        : "";

    const msg = ev.success ? "耐えきれなかった" : "耐えた";

    return [
      { kind: "note status", text: `${duck}の${escapeHTML(name)}！` },
      {
        kind: "meta",
        text: `${duck}に逆風が吹き荒れる…… ${msg}！${hint}`,
      },
    ];
  },

  ACTION_CANCELED_HEADWIND: (ev) => {
    const duck = escapeHTML(duckNameOf(ev.target));
    return [{
      kind: "soft",
      text: `<i>${duck}は逆風に煽られてスキルを発動できない！</i>`,
    }];
  },

  // --- 清潔（デバフ付与を防ぐ） ---
  STATUS_CLEAN_CONSUMED: (ev) => {
    const duck = escapeHTML(duckNameOf(ev.target));
    const name = statusLabel("clean");

    const before =
      typeof ev.before === "number" && Number.isFinite(ev.before)
        ? Math.trunc(ev.before)
        : null;
    const after =
      typeof ev.after === "number" && Number.isFinite(ev.after)
        ? Math.trunc(ev.after)
        : null;

    const blockedStatus = statusLabel(ev.blockedStatus ?? "");
    const blockedAmount =
      typeof ev.blockedAmount === "number" && Number.isFinite(ev.blockedAmount)
        ? Math.trunc(ev.blockedAmount)
        : null;

    const hint =
      before !== null && after !== null
        ? ` <span class="miniHint">（清潔 ${before}→${after}）</span>`
        : "";

    const tail =
      blockedAmount !== null
        ? ` <span class="miniHint">（${escapeHTML(
            blockedStatus
          )} -${blockedAmount}）</span>`
        : "";

    return [
      { kind: "note status", text: `${duck}の${escapeHTML(name)}！` },
      { kind: "soft", text: `${duck}は清潔で異常付与を防いだ！${tail}${hint}` },
    ];
  },

  // --- 集中 ---
STATUS_FOCUS_CONSUMED: (ev) => {
  const duck = escapeHTML(duckNameOf(ev.target));
  const name = statusLabel("focus");

  const before = typeof ev.before === "number" ? Math.trunc(ev.before) : null;
  const after  = typeof ev.after  === "number" ? Math.trunc(ev.after)  : null;

  // BattleEngine から mul: factor が来てる前提
  const mul =
    typeof ev.mul === "number" && Number.isFinite(ev.mul)
      ? ev.mul
      : null;

  const mulText = mul === null ? "" : escapeHTML(formatMul(mul));
  const tail =
    before !== null && after !== null
      ? ` <span class="miniHint">（集中 ${before}→${after}）</span>`
      : "";

  return [
    { kind: "note status", text: `${duck}の${escapeHTML(name)}！` },
    { kind: "soft", text: `${duck}は集中して攻撃力を${mulText}にした！${tail}` },
  ];
},

  // --- 攻撃結果 ---
  ATTACK_MISSED_BY_EFFECT: (ev) => {
    const duck = escapeHTML(duckNameOf(ev.actor));

    return [{
      kind: "soft",
      text: `<i>${duck}は攻撃できない！</i>`,
    }];
  },


  // --- 連続行動の命中率低下（外れ） ---
  ACCURACY_ROLL_MULTI_ACTION: (_ev) => null, // 判定ログは表示しない

  ATTACK_MISSED_BY_MULTI_ACTION_ACCURACY: (ev) => {
    const attacker = escapeHTML(duckNameOf(ev.actor));
    return [{
      kind: "soft",
      text: `<i>${attacker}は攻撃を外した！</i>`,
    }];
  },

NEXT_ATTACK_ATPLUS_CONSUMED: (ev) => {
  const duck = escapeHTML(duckNameOf(ev.actor));
  const v =
    typeof ev.value === "number" && Number.isFinite(ev.value)
      ? Math.trunc(ev.value)
      : 0;

  return [{
    kind: "meta",
    text: `${duck}は AT${escapeHTML(v > 0 ? `+${v}` : `${v}`)} を消費した！`,
  }];
},

  ATTACK_AVOIDED_BY_TAILWIND: (ev) => {
    const before = ev.tailwindBefore ?? null;
    const after = ev.tailwindAfter ?? null;

    const tail =
      typeof before === "number" && typeof after === "number"
        ? `（追風 ${before}→${after}）`
        : "";

    const duck = escapeHTML(duckNameOf(ev.target));

    return [
      { kind: "note status", text: `${duck}の💨追風！` },
      {
        kind: "soft",
        text:
          `${duck}は💨追風で攻撃を回避した！` +
          (tail ? ` <span class="miniHint">${escapeHTML(tail)}</span>` : ""),
      },
    ];
  },

  // --- 反撃 ---
  COUNTER_TRIGGERED: (ev) => {
    const duck = escapeHTML(duckNameOf(ev.actor)); // 反撃する側
    const name = statusLabel("counter");

    // ここでは「見出し」だけ出す（ダメージ行は counterDamage 側に集約）
    return [{ kind: "note status", text: `${duck}の${escapeHTML(name)}！` }];
  },

  // --- バフ ---
   BUFF_EXPIRED: (ev) => {
    const who = duckNameOf(ev.target);
    const stat = String(ev.stat ?? "");
    const amt = Number(ev.amount ?? 0);
    const sign = amt > 0 ? "+" : "";
    const body =
      stat && Number.isFinite(amt) ? `${stat}${sign}${Math.trunc(amt)}` : "（不明）";

    return [{
      kind: "meta",
      text: `${escapeHTML(who)}のターン効果が終了（${escapeHTML(body)}）`,
    }];
   },


  // --- デバッグ / 未対応 ---
  EFFECT_TYPE_UNSUPPORTED: (ev) => {
    return [{
      kind: "meta",
      text: `未対応effect.type: ${escapeHTML(String(ev.effectType ?? ""))}`,
    }];
  },

CHANGE_VALUE_KEY_UNSUPPORTED: (ev) => ([{
  kind: "meta",
  text: escapeHTML(String(ev.code ?? "")),
}]),
CHANGE_VALUE_OP_UNSUPPORTED: (ev) => ([{
  kind: "meta",
  text: escapeHTML(String(ev.code ?? "")),
}]),
CHANGE_VALUE_OP_UNSUPPORTED_FOR_NULL: (ev) => ([{
  kind: "meta",
  text: escapeHTML(String(ev.code ?? "")),
}]),
CHANGE_STATUS_UNSUPPORTED: (ev) => ([{
  kind: "meta",
  text: escapeHTML(String(ev.code ?? "")),
}]),
CHANGE_STATUS_OP_UNSUPPORTED: (ev) => ([{
  kind: "meta",
  text: escapeHTML(String(ev.code ?? "")),
}]),
CHANGE_ATTACK_CTX_ATTACK_MISSING: (ev) => ([{
  kind: "meta",
  text: escapeHTML(String(ev.code ?? "")),
}]),
CHANGE_ATTACK_MULDAMAGE_VALUE_INVALID: (ev) => ([{
  kind: "meta",
  text: escapeHTML(String(ev.code ?? "")),
}]),
CHANGE_ATTACK_OP_UNSUPPORTED: (ev) => ([{
  kind: "meta",
  text: escapeHTML(String(ev.code ?? "")),
}]),
FIXED_DAMAGE_DEAL_FN_MISSING: (ev) => ([{
  kind: "meta",
  text: escapeHTML(String(ev.code ?? "")),
}]),
HEAL_FN_MISSING: (ev) => ([{
  kind: "meta",
  text: escapeHTML(String(ev.code ?? "")),
}]),
ADD_BUFF_STAT_UNSUPPORTED: (ev) => ([{
  kind: "meta",
  text: escapeHTML(String(ev.code ?? "")),
}]),


  // --- 固定ダメージ（effects.js -> fixedDamage） ---
  FIXED_DAMAGE: (ev) => {
    return [{
      kind: "soft",
      text: `${duckNameOf(ev.target)}に固定 ${num("damage", ev.value)} ダメージ！`,
    }];
  },

  // --- effect の miss 指定（effects.js -> attackChanged op:miss） ---
  ATTACK_MARKED_MISS: (_ev) => {
    return [{ kind: "meta", text: "攻撃は失敗した！" }];
  },

  // --- 集中などの攻撃倍率変更（battleEngine.js -> attackChanged） ---
  ATTACK_DAMAGE_MUL_FOCUS: (_ev) => null,
};

function eventToLineByCode(ev) {
  const code = String(ev.code ?? "");
  if (!code) return null;

  const fn = CODE_RENDERERS[code];
  if (typeof fn !== "function") return null;

  return fn(ev);
}

/* ==========
  events → ブロック化
========== */
const blocks = buildPhaseBlocks(record.events);

if (blocks.length === 0) {
  showError("表示できるログブロックがありません");
  throw new Error("No blocks");
}

/* ==========
  再生制御
========== */
let cursor = 0;
let isRenderingAll = false;
// 「前の画面に戻る」：最後まで表示したら出す
btnBack.hidden = true;
btnBack.addEventListener("click", () => {
  history.back();
});

function showBackButtonIfDone() {
  if (cursor >= blocks.length) {
    btnBack.hidden = false;
  }
}

clearLog();
updateHeaderFromState(blocks[0]); // 初期表示

btnNext.addEventListener("click", () => {
  if (cursor >= blocks.length) return;
  renderBlock(blocks[cursor]);
  updateHeaderFromState(blocks[cursor]);
  cursor++;

  showBackButtonIfDone();
});


btnAll.addEventListener("click", () => {
  if (isRenderingAll) return;
  isRenderingAll = true;

  btnAll.disabled = true;
  btnNext.disabled = true;

  const frag = document.createDocumentFragment();

  while (cursor < blocks.length) {
    const section = buildBlockElement(blocks[cursor]);
    frag.appendChild(section);
    cursor++;
  }

  logArea.appendChild(frag);

  const last = blocks[Math.max(0, blocks.length - 1)];
  updateHeaderFromState(last);

  showBackButtonIfDone();
window.scrollTo({
  top: document.body.scrollHeight,
  behavior: "smooth"
});

  btnAll.disabled = false;
  btnNext.disabled = false;
  isRenderingAll = false;

});

/* ==========
  ブロック生成
========== */
function buildPhaseBlocks(events) {
  const result = [];
  let current = null;
  let pendingSystemLines = [];
  let endTurnLines = [];
  let endTurnSkillGroupId = null;

  // 追加：最初の攻撃フェイズに繰り込みたい常時Bログ
  let deferredPassiveEvents = [];
  let firstPhaseStarted = false;

  let battleStartBlock = null;
  let hasTurnStarted = false;

  // スキル発動～効果のグループ管理
  let currentSkillGroupId = null;

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const pct = (hp, max) => (max > 0 ? Math.round(clamp01(hp / max) * 100) : 0);

  const pushTurnBlock = (ev) => {
    const st = ev.state;

    const hp1 = st?.hp?.P1 ?? 0;
    const hp2 = st?.hp?.P2 ?? 0;
    const ap1 = st?.ap?.P1 ?? 0;
    const ap2 = st?.ap?.P2 ?? 0;

const buildStatusText = (statusObj) => {
  const s = statusObj ?? null;
  if (!s || typeof s !== "object") return "";

  const parts = [];
  for (const [key, val] of Object.entries(s)) {
    const n = Math.trunc(Number(val ?? 0));
    if (n > 0) parts.push(`${statusLabel(key)}${n}`);
  }
  return parts.join("　");
};

const stP1 = buildStatusText(st?.status?.P1);
const stP2 = buildStatusText(st?.status?.P2);

const statusHtmlP1 =
  `<div class="statusLine">${
    stP1 ? escapeHTML(stP1) : "状態変化なし"
  }</div>`;

const statusHtmlP2 =
  `<div class="statusLine">${
    stP2 ? escapeHTML(stP2) : "状態変化なし"
  }</div>`;


    const p1Pct = pct(hp1, maxHP.P1);
    const p2Pct = pct(hp2, maxHP.P2);

const html =
  `<div class="turnTitle">TURN ${escapeHTML(String(ev.turn ?? "-"))}</div>` +
  `<div class="turnRow">` +
  `<div class="miniPanel">` +
  `<span class="miniTag p1">1P</span>` +
  `<span>HP ${escapeHTML(String(hp1))}/${escapeHTML(String(maxHP.P1))}</span>` +
  `<div class="hpBar"><div class="hpFill p1" style="width:${p1Pct}%;"></div></div>` +
  `<span>AP ${escapeHTML(String(ap1))}</span>` +
  `</div>` +

  `<div class="miniPanel">` +
  `<span class="miniTag p2">2P</span>` +
  `<span>HP ${escapeHTML(String(hp2))}/${escapeHTML(String(maxHP.P2))}</span>` +
  `<div class="hpBar"><div class="hpFill p2" style="width:${p2Pct}%;"></div></div>` +
  `<span>AP ${escapeHTML(String(ap2))}</span>` +
  `</div>` +

  statusHtmlP1 +
  statusHtmlP2 +
  `</div>`;


    const sit1 = turnSituationKeyFor("P1", ev.state);
    const sit2 = turnSituationKeyFor("P2", ev.state);

    const tq1 = getBattlerQuote("P1", "turn", sit1);
    const tq2 = getBattlerQuote("P2", "turn", sit2);

    const turnQuote = makeQuoteRowLine(
      { text: tq1.text, iconKey: tq1.iconKey },
      { text: tq2.text, iconKey: tq2.iconKey }
    );

    // ===== フィールド（氷風呂） =====
    const iceOn =
      (battleStart?.meta?.field?.id === "iceBath") && Number(ev.turn) >= 1;

    const iceLines = iceOn
      ? [
          { kind: "note", text: "🛁氷風呂のフィールド効果！" },
          { kind: "soft", text: "通常攻撃のダメージが 2倍！" },
        ]
      : [];

    // ===== フィールド（電気風呂） =====
    const electricOn =
      String(ev.field ?? "") === "electricBath" && Number(ev.apPlus) === 2;

    const electricLines = electricOn
      ? [
          { kind: "note", text: "🛁電気風呂のフィールド効果！" },
          { kind: "soft", text: "ターン開始時のAP増加量が +2！" },
        ]
      : [];

    const lines = [
      { kind: "soft", text: html },

      ...electricLines,
      ...iceLines,

      ...(turnQuote ? [turnQuote] : []),
      ...pendingSystemLines,
    ];

    pendingSystemLines = [];

    result.push({
      side: "system",
      turn: ev.turn,
      phase: 0,
      headerText: "🌊 NEXT TURN 🌊",
      lines,
      stateAfter: ev.state,
    });
  };

  // 戦闘開始ブロック（Dスキル等は events から拾う）
  const pushBattleStartBlock = (ev) => {
    const first = ev.meta?.first ?? "-";

    const q1 = getBattlerQuote("P1", "battleStart");
    const q2 = getBattlerQuote("P2", "battleStart");
    const quoteLine = makeQuoteRowLine(
      { text: q1.text, iconKey: q1.iconKey },
      { text: q2.text, iconKey: q2.iconKey }
    );

  const fieldInfo = getFieldText(ev.meta?.field);

  const lines = [
    // フィールドがある時だけ、先攻より前に表示
    ...(fieldInfo
      ? [
          {
            kind: "note",
            text: escapeHTML(`⚠フィールド効果：${fieldInfo.title}発動中！⚠`),
          },
          {
            kind: "meta",
            text: escapeHTML(fieldInfo.desc),
          },
        ]
      : []),

    { kind: "note", text: escapeHTML(`先攻：${first}`) },
    ...(quoteLine ? [quoteLine] : []),
  ];

    const block = {
      side: "system",
      turn: 0,
      phase: 0,
      headerText: "🐤 BATTLE START 🐤",
      lines,
      stateAfter: ev.state,
    };

    result.push(block);
    return block;
  };

  const isSkillStartEvent = (ev) =>
    ev.type === "skillTriggered" || ev.type === "cSkillActivated";

  // ===== フィールド効果を「スキル塊」と同じ見た目でまとめる =====
  const isFieldStartEvent = (ev) => ev?.type === "fieldTriggered";

  // fieldTriggered の直後に来る「実効果ログ」をフィールド塊に含める
  // ※ hotBath は fixedDamage + source:"field:hotBath"
  // ※ foamBath は heal       + source:"field:foamBath"
  const isFieldEffectEvent = (ev) => {
    const src = String(ev?.source ?? "");
    if (!src.startsWith("field:")) return false;
    return ev?.type === "fixedDamage" || ev?.type === "heal";
  };

  const getGroupId = (ev) => (ev && ev.groupId != null ? ev.groupId : null);

  for (const ev of events) {
    if (ev.type === "battleStart") {
      battleStartBlock = pushBattleStartBlock(ev);
      continue;
    }
    // ===== ターン開始 =====
    if (ev.type === "turnStart") {
      hasTurnStarted = true;

      // ターンが変わるタイミングではスキル塊グループも終了
      currentSkillGroupId = null;
      endTurnSkillGroupId = null;

      if (current) {
        result.push(current);
        current = null;
      }

      pushTurnBlock(ev);
      continue;
    }

    // ===== ターン終了 =====
    if (ev.type === "turnEnd") {
      // ターンが変わるタイミングではグループ終了
      currentSkillGroupId = null;

      // 最終フェイズブロックを閉じる
      if (current) {
        result.push(current);
        current = null;
      }

      // ターン終了直前の単独ブロック（バフTick / beforeTurnEnd Cスキル等）
      if (endTurnLines.length) {
        result.push({
          side: "system",
          turn: ev.turn,
          phase: ev.phase,
          headerText: "",
          lines: [...endTurnLines],
          stateAfter: ev.state,
        });
        endTurnLines = [];
      }

      endTurnSkillGroupId = null;
      continue;
    }


    if (ev.type === "phaseStart") {
      // フェイズ開始はグループを切る
      currentSkillGroupId = null;

      if (current) result.push(current);

      current = {
        side: ev.actor, // "P1" or "P2"
        turn: ev.turn,
        phase: ev.phase,
        headerText: `${battlerNameOf(ev.actor)} × ${duckNameOf(ev.actor)}の攻撃！`,
        lines: [],
        stateAfter: ev.state,
      };

      // 追加：初回のphaseStartなら、保留していた常時Bログをこのブロック冒頭に差し込む
      if (!firstPhaseStarted) {
        firstPhaseStarted = true;

        for (const pev of deferredPassiveEvents) {
          const plines = eventToLines(pev);
          if (plines.length) current.lines.push(...plines);
        }

        deferredPassiveEvents = [];
      }

      continue;
    }
    // ===== ターン終了直前にまとめたいログ（バフTick/Expired、beforeTurnEndのCスキル） =====
    {
      const isBuffTail = ev.type === "buffTick" || ev.type === "buffExpired";

      const isBeforeTurnEndC =
        ev.type === "cSkillActivated" && String(ev.trigger ?? "") === "beforeTurnEnd";

      const gid = ev.groupId != null ? ev.groupId : null;

      // beforeTurnEnd の Cスキルが来たら、その groupId をターン終端枠へ寄せる
      if (isBeforeTurnEndC && gid != null) {
        endTurnSkillGroupId = gid;
      }

      // すでに beforeTurnEnd Cスキルの groupId を掴んでいるなら、その効果ログも一緒に寄せる
      const isEndTurnSkillRelated = endTurnSkillGroupId != null && gid === endTurnSkillGroupId;

      if (isBuffTail || isBeforeTurnEndC || isEndTurnSkillRelated) {
        // フェイズ末尾に出さないため、ここでフェイズブロックを閉じる
        if (current) {
          result.push(current);
          current = null;
          currentSkillGroupId = null;
        }

        const lines = eventToLines(ev);
        if (lines.length) endTurnLines.push(...lines);
        continue;
      }
    }
    // phaseStart が来るまでのイベントは「pending」に積む（戦闘開始に回すものもある）
    if (!current) {
      // 追加：戦闘開始〜最初のphaseStartまでに出た常時Bログは、最初の攻撃フェイズへ繰り込む
      if (
        !firstPhaseStarted &&
        (ev.type === "passiveSkillStateChanged" ||
          ev.type === "passiveBonusTotalChanged")
      ) {
        deferredPassiveEvents.push(ev);
        continue;
      }

      const lines = eventToLines(ev);
      if (lines.length) {
        if (!hasTurnStarted && battleStartBlock) {
          battleStartBlock.lines.push(...lines);
        } else {
          pendingSystemLines.push(...lines);
        }
      }

      continue;
    }


    // 追加：roll（ダイス結果）の直前に1回だけスペースを入れる
    if (ev.type === "roll") {
      const last = current.lines[current.lines.length - 1];
      const lastKind = last?.kind ?? "";

      // 直前が spacer じゃなければ入れる（連続スペース防止）
      if (lastKind !== "spacer") {
        current.lines.push(spacerLine());
      }
    }

    // current がある場合：スキル塊/フィールド塊の後ろにだけ spacer を入れる
    const lines = eventToLines(ev);
    if (lines.length) {
      // --- スキル塊判定 ---
      const isSkillStart = isSkillStartEvent(ev);
      const gid = getGroupId(ev);
      const isSkillRelated = isSkillStart || gid !== null;

      // --- フィールド塊判定 ---
      const isFieldStart = isFieldStartEvent(ev);
      const isFieldRelated = isFieldStart || isFieldEffectEvent(ev);

      // 「いま塊の中か？」を判定（スキル or フィールド）
      const inAnyGroupNow = currentSkillGroupId !== null;

      // フィールド塊は groupId が無いので、専用の疑似IDを使う
      // ※固定文字列でOK（塊の開始/終了だけ管理できれば良い）
      const FIELD_GROUP = "__FIELD__";

      // まず、このイベントが「どの塊に属するか」を決める
      let nextGroupId = null;
      if (isSkillRelated) nextGroupId = gid;            // スキル塊（本物の groupId）
      else if (isFieldRelated) nextGroupId = FIELD_GROUP; // フィールド塊（疑似ID）

      if (inAnyGroupNow) {
        // いま塊の中 → 次が塊じゃないなら塊終了（spacer）
        if (nextGroupId === null) {
          current.lines.push(spacerLine());
          currentSkillGroupId = null;
        }
        // いま塊の中 → 次が別の塊なら区切る（spacer）
        else if (nextGroupId !== currentSkillGroupId) {
          current.lines.push(spacerLine());
          currentSkillGroupId = nextGroupId;
        }
        // 同じ塊ならそのまま
      } else {
        // いま塊の外 → 次が塊なら開始
        if (nextGroupId !== null) currentSkillGroupId = nextGroupId;
      }

      // 塊の行だけ "skill" クラスを付与してインデント対象にする
      const inGroup = nextGroupId !== null || currentSkillGroupId !== null;
      const decorated = inGroup
        ? lines.map((l) => {
            if (!l || l.kind === "spacer") return l;
            const k = String(l.kind ?? "").trim();
            return { ...l, kind: (k ? k + " " : "") + "skill" };
          })
        : lines;

      current.lines.push(...decorated);
    }

    if (ev.state) current.stateAfter = ev.state;
  }

  if (current) result.push(current);

  // battleEnd を後ろから探す
  let battleEnd = null;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "battleEnd") {
      battleEnd = events[i];
      break;
    }
  }

  const lastBlock = result.length ? result[result.length - 1] : null;

  if (battleEnd) {
    const outcome = battleEnd.result; // "P1_win" | "P2_win" | "draw"

    if (outcome === "draw") {
      const dq1 = getBattlerQuote("P1", "battleEnd", "draw");
      const dq2 = getBattlerQuote("P2", "battleEnd", "draw");
      const endQuote = makeQuoteRowLine(
        { text: dq1.text, iconKey: dq1.iconKey },
        { text: dq2.text, iconKey: dq2.iconKey }
      );

      result.push({
        side: "system",
        turn: battleEnd.turn ?? (lastBlock?.turn ?? 0),
        phase: battleEnd.phase ?? (lastBlock?.phase ?? 0),
        headerText: " RESULT ",
        lines: [
          ...(endQuote ? [endQuote] : []),
          { kind: "soft", text: "引き分け……" },
        ],
        stateAfter: battleEnd.state ?? lastBlock?.stateAfter,
      });
    } else {
      const winnerSide = outcome === "P1_win" ? "P1" : "P2";

      const wq1 = getBattlerQuote(
        "P1",
        "battleEnd",
        winnerSide === "P1" ? "win" : "lose"
      );
      const wq2 = getBattlerQuote(
        "P2",
        "battleEnd",
        winnerSide === "P2" ? "win" : "lose"
      );

      const loserSide = winnerSide === "P1" ? "P2" : "P1";

// 敗北セリフ → 勝利セリフ の順に並べる（位置はp1/p2のまま）
const endQuote = makeQuoteRowLine(
  { text: wq1.text, iconKey: wq1.iconKey },
  { text: wq2.text, iconKey: wq2.iconKey },
  [loserSide, winnerSide]
);

      const winnerBattler = battlerNameOf(winnerSide);
      const winnerDuck = duckNameOf(winnerSide);

      result.push({
        side: "system",
        turn: battleEnd.turn ?? (lastBlock?.turn ?? 0),
        phase: battleEnd.phase ?? (lastBlock?.phase ?? 0),
        headerText: "🐣 BATTLE FINISH 🐣",
        lines: [
          ...(endQuote ? [endQuote] : []),
          { kind: "victoryLine", text: buildVictoryHtml(winnerBattler, winnerDuck) },
        ],
        stateAfter: battleEnd.state ?? lastBlock?.stateAfter,
      });
    }
  }

  return result;
}

/* ==========
  event → 行
========== */
function spacerLine() {
  return { kind: "spacer", text: "" };
}

function diceEffectSummary(v) {
  switch (v) {
    case 1:
      return "自分のAP+1";
    case 2:
      return "通常攻撃2回";
    case 3:
      return "自分のHP3回復";
    case 4:
      return "自分に反撃 +1";
    case 5:
      return "相手のAP -1";
    case 6:
      return "DF無視攻撃＋反動3ダメージ";
    default:
      return "特殊効果なし";
  }
}

function eventToLines(ev) {
  // ===== 反撃：counterDamage 側に counterBefore/counterAfter が来るので、それをそのまま表示 =====
  if (ev.type === "counterDamage") {
    const before =
      typeof ev.counterBefore === "number" ? ev.counterBefore : null;
    const after =
      typeof ev.counterAfter === "number" ? ev.counterAfter : null;

    const hint =
      typeof before === "number" && typeof after === "number"
        ? ` <span class="miniHint">（反撃 ${before}→${after}）</span>`
        : "";

    const one = eventToLine(ev);
    if (!one) return [];
    return [{ ...one, text: `${one.text}${hint}` }];
  }


  // 常時Bだけ特別に複数行
  if (ev.type === "passiveSkillStateChanged") {
    const lines = [];

    const side = ev.target; // "P1"/"P2"
    const battler = battlerNameOf(side);
    const duck = duckNameOf(side);

    const skillName = String(ev.skill?.skillName ?? "常時スキル");

    const hpPct =
      typeof ev.hpPct === "number" && Number.isFinite(ev.hpPct)
        ? Math.round(ev.hpPct * 100)
        : null;
    const hpText = hpPct === null ? "" : ` <span class="miniHint">（現HP${hpPct}%）</span>`;

    const at = Math.trunc(Number(ev.bonus?.AT ?? 0));
    const df = Math.trunc(Number(ev.bonus?.DF ?? 0));

    const bonusParts = [];
    if (at !== 0) bonusParts.push(`AT${at > 0 ? "+" : ""}${at}`);
    if (df !== 0) bonusParts.push(`DF${df > 0 ? "+" : ""}${df}`);
    const bonusText = bonusParts.length ? bonusParts.join(" ") : "効果なし";

    if (ev.active) {
      lines.push({
        kind: `note skill ${side === "P1" ? "p1" : side === "P2" ? "p2" : ""}`.trim(),
        text: `${escapeHTML(battler)}のバトラースキル！`,
      });

      lines.push({
        kind: "soft skill",
        text: `${escapeHTML(duck)}の${escapeHTML(bonusText)}！${hpText}`,
      });
    } else {
      lines.push({
        kind: "meta skill",
        text: `${escapeHTML(duck)}の${escapeHTML(
          bonusText
        )}が解除された！${hpText}`,
      });
    }

    return lines;
  }

  // code renderer
const byCode = eventToLineByCode(ev) ?? [];
if (byCode.length) return byCode;


  // その他は従来通り（1行）
  const one = eventToLine(ev);
  return one ? [one] : [];
}

function eventToLine(ev) {
  switch (ev.type) {

    // --- ダイス ---
    case "roll": {
      const side = ev.actor; // "P1" or "P2"

      // DUCKSの icons が battleStart.meta に入っていればそれを優先
      const iconSrc =
        side === "P1"
          ? metaP1.duckIcons?.icon ?? `img/Duck/${metaP1.duckId}.png`
          : side === "P2"
          ? metaP2.duckIcons?.icon ?? `img/Duck/${metaP2.duckId}.png`
          : null;

      const iconHtml = iconSrc
        ? `<img class="logDuckIcon" src="${escapeHTML(iconSrc)}" alt="">`
        : "";

      const v = Number(ev.diceValue ?? 0);
      const effectText = diceEffectSummary(v);

      return {
        kind: "soft rollLine",
        text:
          `${iconHtml}` +
          `<div class="rollTexts">` +
          `<div class="rollMain">ダイス結果 → ${num("dice", ev.diceValue)}！</div>` +
          `<div class="rollSub">${escapeHTML(effectText)}</div>` +
          `</div>`,
      };
    }

    // --- 値変化（effects.changeValue） ---
    case "valueChanged": {
      const key = String(ev.key ?? "");
      const delta = ev.delta;

      if (typeof delta !== "number" || !Number.isFinite(delta) || delta === 0)
        return null;

      const who = duckNameOf(ev.target);
      const text = formatValueChangedText({ who, key, delta, ev });
      if (!text) return null;

      return { kind: "soft", text };
    }

    // --- 攻撃変更（effects.changeAttack / focus等） ---
    case "attackChanged": {
      const op = String(ev.op ?? "");
      if (op === "miss") {
        return { kind: "meta", text: "攻撃は失敗した！" };
      }

      // 集中（focus）由来の倍率変更は、専用ログ（STATUS_FOCUS_CONSUMED）だけ出したいので非表示
      if (String(ev.code ?? "") === "ATTACK_DAMAGE_MUL_FOCUS") {
        return null;
      }

      if (op === "mulDamage") {
        const mul = formatMul(ev.value);
        return {
          kind: "meta",
          text: `ダメージ倍率 ${escapeHTML(mul)}！`,
        };
      }

      if (op === "addDamage") {
        return {
          kind: "meta",
          text: `ダメージが変化（${escapeHTML(String(ev.value ?? ""))}）`,
        };
      }
      if (op === "setDamage") {
        return {
          kind: "meta",
          text: `ダメージが固定化（${escapeHTML(String(ev.value ?? ""))}）`,
        };
      }
      return { kind: "meta", text: "攻撃内容が変化！" };
    }

    // --- フィールド効果（発動見出し） ---
    case "fieldTriggered": {
      const fname = ev.field?.name ?? "フィールド";
      return {
        kind: "note",
        text: `🛁${escapeHTML(String(fname))}のフィールド効果！`,
      };
    }

    // --- 状態（battleEngine/effects 共通） ---
    case "statusEffect":
      return { kind: "soft", text: buildStatusEffectText(ev) };

    case "statusChange": {
      const isDice = ev.source === "dice4";
      const prefix = isDice ? "🎲 " : "";

      const targetSide = ev.target; // "P1"/"P2"
      const targetDuck = duckNameOf(targetSide);

      const name = statusLabel(ev.status);
      const plainName = statusLabelPlain(ev.status);

      const before = Number(ev.before ?? 0);
      const after = Number(ev.after ?? 0);

      const reason = String(ev.reason ?? "");

      // 発動で全消費される statusChange は、専用ログ（ROLL系）と重複するので表示しない
      if (String(ev.code ?? "") === "STATUS_CONSUMED_ON_TRIGGER") {
        return null;
      }

      const isDecay = String(ev.code ?? "") === "STATUS_DECAY";

      const kind = isDecay ? "meta" : "soft";
      const reasonText = "";

      if (!Number.isFinite(before) || !Number.isFinite(after)) {
        return {
          kind,
          text: `${prefix}${escapeHTML(targetDuck)}に${escapeHTML(
            name
          )}（${escapeHTML(String(ev.before ?? "-"))}→${escapeHTML(
            String(ev.after ?? "-"))
          }）${reasonText}`,
        };
      }

      const delta = after - before;

      const hint =
        Number.isFinite(before) && Number.isFinite(after)
          ? ` <span class="miniHint">${escapeHTML(plainName)}（${before}→${after}）</span>`
          : "";

      if (delta > 0) {
        return {
          kind,
          text:
            `${prefix}${escapeHTML(targetDuck)}に${escapeHTML(name)}を` +
            `${num("buff", delta)}付与！` +
            `${hint}${reasonText}`,
        };
      }

      if (delta < 0) {
        const n = Math.abs(delta);
        return {
          kind,
          text: `${prefix}${escapeHTML(targetDuck)}の${escapeHTML(
            name
          )}を${escapeHTML(String(n))}解除！${hint}${reasonText}`,
        };
      }

      // 変化なし（上限に弾かれた等）
      return {
        kind,
        text: `${prefix}${escapeHTML(targetDuck)}の${escapeHTML(
          name
        )}は変化しなかった……${hint}${reasonText}`,
      };
    }

    // --- ダメージ/回復 ---
    case "normalDamage":
      return {
        kind: "soft",
        text: `🎲 ${duckNameOf(ev.target)}に ${num("damage", ev.value)} ダメージ！`,
      };

    case "heal": {
      const isDice = ev.source === "dice3";
      const prefix = isDice ? "🎲 " : "";
      return {
        kind: "soft",
        text: `${prefix}${duckNameOf(ev.target)}のHPが ${num(
          "heal",
          ev.value
        )} 回復！`,
      };
    }

    case "recoil": {
      const isDice = ev.source === "dice6";
      const prefix = isDice ? "🎲 " : "";
      return {
        kind: "soft",
        text: `${prefix}${duckNameOf(ev.target)}は反動で ${num(
          "damage",
          ev.value
        )} ダメージ！`,
      };
    }

    case "counterDamage":
      return {
        kind: "soft",
        text: `${duckNameOf(ev.target)}に🛡️反撃で ${num(
          "damage",
          ev.value
        )} ダメージを返した！`,
      };

    // --- バフ ---
    case "buffApplied":
      return {
        kind: "soft",
        text: `${duckNameOf(ev.target)}にターン効果（${escapeHTML(
          String(ev.stat)
        )}${escapeHTML(String(ev.amount))} / ${escapeHTML(
          String(ev.turns)
        )}T）を追加！`,
      };

     case "buffTick":
      {
        const who = duckNameOf(ev.target);
        const stat = String(ev.stat ?? "");
        const amt = Number(ev.amount ?? 0);
        const sign = amt > 0 ? "+" : "";
        const body =
          stat && Number.isFinite(amt) ? `${stat}${sign}${Math.trunc(amt)}` : "（不明）";

        const remain =
          typeof ev.after === "number" && Number.isFinite(ev.after)
            ? Math.trunc(ev.after)
            : 0;

        return {
          kind: "meta center",
          text: `${escapeHTML(who)}のターン効果（${escapeHTML(body)}／残り ${escapeHTML(
            String(remain)
          )}T）`,
        };
      }


    // --- 復活 ---
    case "revived":
      return {
        kind: "note",
        text: `${duckNameOf(ev.target)}が復活した！`,
      };

    // --- その他メモ ---
    case "note": {
      // note本文は使わない。codeだけ（デバッグ）
      const msg = ev.code ?? "";
      if (!msg) return null;
      return { kind: "meta", text: escapeHTML(String(msg)) };
    }

    default:
      return null;
  }
}

/* ==========
  描画
========== */
function buildBlockElement(block) {
  const sideClass =
    block.side === "P1" ? "p1" : block.side === "P2" ? "p2" : "system";

  const section = document.createElement("section");
  section.className = `phaseBlock ${sideClass}`;

  const header = document.createElement("div");
  header.className = `phaseHeader ${sideClass}`;
  header.textContent = block.headerText;

  const lines = document.createElement("div");
  lines.className = "lines";

  for (const l of block.lines) {
    const div = document.createElement("div");
    div.className = "line" + (l.kind ? ` ${l.kind}` : "");

    div.innerHTML = (l.kind === "spacer") ? "" : l.text;
    lines.appendChild(div);
  }

  if (block.headerText) section.appendChild(header);
  section.appendChild(lines);

  return section;
}

function renderBlock(block, doScroll = true) {
  const section = buildBlockElement(block);
  logArea.appendChild(section);

  if (doScroll) {
    // 追加したブロックの「先頭」を表示する
    const headerH = parseInt(
  getComputedStyle(document.documentElement)
    .getPropertyValue("--header-h")
);

const y =
  section.getBoundingClientRect().top +
  window.scrollY -
  headerH;

window.scrollTo({
  top: y,
  behavior: "smooth"
});
  }
}


function clearLog() {
  logArea.innerHTML = "";
}

/* ==========
  ヘッダー更新
========== */
function updateHeaderFromState(block) {
  const st = block?.stateAfter;
  if (!st) return;

  const hp1 = st.hp?.P1 ?? "-";
  const hp2 = st.hp?.P2 ?? "-";
  const ap1 = st.ap?.P1 ?? "-";
  const ap2 = st.ap?.P2 ?? "-";

  elTurn.textContent = `TURN ${block.turn ?? "-"}`;
  elHP_P1.textContent = ` ${hp1}/${maxHP.P1}`;
  elHP_P2.textContent = ` ${hp2}/${maxHP.P2}`;
  elAP_P1.textContent = ` ${ap1}`;
  elAP_P2.textContent = ` ${ap2}`;
  const sideLabel = block.side === "system" ? "-" : (block.side ?? "-");
  elPhase.textContent = `PHASE ${block.phase ?? "-"}（${sideLabel}）`;
}

/* ==========
  util（名前）
========== */
function duckNameOf(side) {
  return names[side]?.duck ?? side;
}

function battlerNameOf(side) {
  return names[side]?.battler ?? side;
}

/* ==========
  util（状態名ラベル）
========== */
function statusLabel(key) {
  const k = String(key ?? "");

  if (k === "crack") return "⚡亀裂";
  if (k === "Headwind") return "🌪️逆風";
  if (k === "roughWave") return "🌊荒波";
  if (k === "tailwind") return "💨追風";
  if (k === "focus") return "🎯集中";
  if (k === "counter") return "🛡️反撃";
  if (k === "clean") return "🧼清潔";
  if (k === "steam") return "🌫️湯気";

  return k || "状態";
}

function statusLabelPlain(key) {
  // statusLabel の先頭に付いてる絵文字を落とす
  const s = statusLabel(key);
  return String(s).replace(/^[^\p{L}\p{N}]+/u, "");
}

function buildStatusEffectText(ev) {
  const name = statusLabel(
    ev.status ??
      ev.statusKey ??
      ev.statusId ??
      ev.statusName ??
      ev.name ??
      "状態"
  );

  const targetDuck = duckNameOf(ev.target);
  const v = ev.value ?? ev.amount ?? 0;
  const kind = ev.kind ?? "";
  const code = String(ev.code ?? "");

  if (kind === "damage") {
    return `${escapeHTML(targetDuck)}は${escapeHTML(name)}の効果で ${num(
      "damage",
      v
    )} ダメージ！`;
  }
  if (kind === "heal") {
    return `${escapeHTML(targetDuck)}は${escapeHTML(name)}の効果で ${num(
      "heal",
      v
    )} 回復！`;
  }

  // 互換：古いログに text が残っている場合はそれを表示（将来消してOK）
  if (typeof ev.text === "string" && ev.text.trim()) {
    return escapeHTML(ev.text);
  }

  return `${escapeHTML(name)}の効果！`;
}

/* ==========
  util（data参照）
========== */
function getBattlerById(battlerId) {
  return BATTLERS.find((b) => b.id === battlerId) ?? null;
}

/* ==========
  セリフ（開始/ターン/終了）
========== */
function pickQuoteNode(node) {
  // node が {text, icon} 形式ならそれを返す
  if (node && typeof node === "object") {
    const text = node.text ?? node.line ?? null;
    const icon = node.icon ?? node.iconKey ?? null;
    return {
      text: text != null ? String(text) : "",
      icon: icon != null ? String(icon) : null,
    };
  }
  // 文字列だけでも許容（アイコンは neutral 扱い）
  if (typeof node === "string") return { text: node, icon: null };
  return { text: "", icon: null };
}

function battlerIconSrc(side, iconKey) {
  const b = battlerBySide?.[side];
  const id = side === "P1" ? metaP1.battlerId : metaP2.battlerId;

  const k = String(iconKey ?? "neutral");
  const fromData = b?.icons?.[k];

  return (
    fromData ??
    b?.icons?.neutral ??
    `img/Battlers/icon/${id}_01.png`
  );
}

function makeQuoteRowLine(p1, p2, order = ["P1", "P2"]) {
  // p1/p2: { text, iconKey }
  const p1Text = p1?.text ? String(p1.text) : "";
  const p2Text = p2?.text ? String(p2.text) : "";

  // 空なら表示しない
  if (!p1Text && !p2Text) return null;

  const p1Icon = battlerIconSrc("P1", p1?.iconKey ?? "neutral");
  const p2Icon = battlerIconSrc("P2", p2?.iconKey ?? "neutral");

  const cells = {
    P1:
      `<div class="quoteCell p1">` +
      `<img class="quoteIcon" src="${escapeHTML(p1Icon)}" alt="">` +
      `<div class="quoteBubble p1">` +
      `${escapeHTML(p1Text)}` +
      `</div>` +
      `</div>`,
    P2:
      `<div class="quoteCell p2">` +
      `<img class="quoteIcon" src="${escapeHTML(p2Icon)}" alt="">` +
      `<div class="quoteBubble p2">` +
      `${escapeHTML(p2Text)}` +
      `</div>` +
      `</div>`,
  };

  const first = order?.[0] === "P2" ? "P2" : "P1";
  const second = first === "P1" ? "P2" : "P1";

  const html =
    `<div class="quoteRow">` +
    cells[first] +
    cells[second] +
    `</div>`;

  return { kind: "quoteLine", text: html };
}

// ルール：disadv = 自分HP%<=25% / adv = 相手だけdisadv / even = その他
function turnSituationKeyFor(side, st) {
  const hp1 = st?.hp?.P1 ?? 0;
  const hp2 = st?.hp?.P2 ?? 0;

  const r1 = maxHP.P1 > 0 ? hp1 / maxHP.P1 : 0;
  const r2 = maxHP.P2 > 0 ? hp2 / maxHP.P2 : 0;

  const T_CRIT = 0.20; // 両者劣勢が許されるライン
  const T_WARN = 0.40; // 片方だけなら劣勢と言ってよいライン

  const p1Crit = r1 < T_CRIT;
  const p2Crit = r2 < T_CRIT;

  const p1Warn = r1 < T_WARN;
  const p2Warn = r2 < T_WARN;

  // 1) 両方20%未満 → 両方劣勢
  if (p1Crit && p2Crit) return "behind";

  // 2) 片方だけ20%未満 → 低い方が劣勢・高い方が優勢
  if (p1Crit !== p2Crit) {
    if (side === "P1") return p1Crit ? "behind" : "lead";
    return p2Crit ? "behind" : "lead";
  }

  // 3) 両方20〜40% → HP%で比較（同じなら両方劣勢）
  if (p1Warn && p2Warn) {
    if (r1 === r2) return "behind";
    const p1Behind = r1 < r2;

    if (side === "P1") return p1Behind ? "behind" : "lead";
    return p1Behind ? "lead" : "behind";
  }

  // 4) 片方だけ40%未満 → その側が劣勢、相手が優勢
  if (p1Warn !== p2Warn) {
    if (side === "P1") return p1Warn ? "behind" : "lead";
    return p2Warn ? "behind" : "lead";
  }

  // 5) それ以外（両方40%以上） → 互角
  return "even";
}


function getBattlerQuote(side, timing, detailKey) {
  const b = battlerBySide?.[side];
  const q = b?.quotes;

  if (!q || typeof q !== "object") return { text: "", iconKey: "neutral" };

  if (timing === "battleStart") {
    const node = pickQuoteNode(q.battleStart);
    return { text: node.text, iconKey: node.icon ?? "neutral" };
  }

  if (timing === "turn") {
    const node = pickQuoteNode(q?.turn?.[detailKey]);
    return { text: node.text, iconKey: node.icon ?? "neutral" };
  }

  if (timing === "battleEnd") {
    const node = pickQuoteNode(q?.battleEnd?.[detailKey]);
    return { text: node.text, iconKey: node.icon ?? "neutral" };
  }

  return { text: "", iconKey: "neutral" };
}

/* ==========
  util（表示）
========== */
function num(cls, value) {
  return `<span class="num ${cls}">${escapeHTML(String(value))}</span>`;
}

function escapeHTML(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMul(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "";

  // 整数なら整数表示（×2）
  if (Number.isInteger(v)) return `×${v}`;

  // 小数がある場合だけ小数表示（×1.25）
  return `×${parseFloat(v.toFixed(2))}`;
}

function setIfExists(el, attr, value) {
  if (!el) return;
  el.setAttribute(attr, value);
}

function showError(msg) {
  logArea.innerHTML = `<div style="padding:16px;">${escapeHTML(msg)}</div>`;
}

/* ==========
  util（valueChanged用）
========== */
function formatValueChangedText({ who, key, delta, ev }) {
  const abs = Math.abs(delta);

  switch (key) {
    case "ap": {
      const cls = delta >= 0 ? "buff" : "debuff";
      const sign = delta >= 0 ? "+" : "";

      const isDice = ev?.source === "dice1" || ev?.source === "dice5";
      const prefix = isDice ? "🎲 " : "";

      return `${prefix}${escapeHTML(who)}のAPが ${num(
        cls,
        `${sign}${delta}`
      )}！`;
    }

    case "hp": {
      const cls = delta >= 0 ? "heal" : "damage";
      const label = delta >= 0 ? "回復" : "減少";
      return `${escapeHTML(who)}のHPが ${num(cls, abs)} ${label}！`;
    }

    case "tempDfPlus": {
      const sign = delta >= 0 ? "+" : "-";
      return `${escapeHTML(who)}のDFがターン中 ${sign}${abs}！`;
    }

    case "nextAttackATPlus": {
      const sign = delta >= 0 ? "+" : "-";
      return `${escapeHTML(who)}の次の攻撃にAT ${sign}${abs}！`;
    }

    case "attackTimesAdd": {
      const sign = delta >= 0 ? "+" : "-";
      return `${escapeHTML(who)}の攻撃回数が ${sign}${abs}！`;
    }

    case "attackTimesOverride": {
      const before = ev.before;
      const after = ev.after;
      const b = before === null ? "通常" : String(before);
      const a = after === null ? "通常" : String(after);

      return `${escapeHTML(who)}の攻撃回数が ${escapeHTML(b)} → ${escapeHTML(
        a
      )} に変更！`;
    }

    case "recoilMinus": {
  const dmgDelta = -delta; // ← 符号反転

  const sign = dmgDelta > 0 ? "+" : "";
  const cls = dmgDelta > 0 ? "damage" : "buff";

  return `${escapeHTML(who)}の反動ダメージが ${num(cls, `${sign}${dmgDelta}`)}！`;
}

    default: {
      const tag = String(ev.tag ?? key);
      const sign = delta > 0 ? "+" : "";
      return `${escapeHTML(who)} ${escapeHTML(tag)} ${sign}${escapeHTML(
        String(delta)
      )}`;
    }
  }
}
function buildVictoryHtml(battlerName, duckName) {
  const battler = escapeHTML(String(battlerName ?? ""));
  const duck = escapeHTML(String(duckName ?? ""));

  return (
    `<div class="victoryWrap">` +
    `<div class="victoryTop">🏆 WINNER 🏆</div>` +
    `<div class="victoryMain">${battler}</div>` +
    `<div class="victoryMain">${duck}</div>` +
    `</div>`
 );
}
