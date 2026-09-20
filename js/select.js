// select.js
import { listForTray, getById, formatBattlerInfo, formatDuckInfo } from "./charaCatalog.js";

// 戦闘実行＆保存＆遷移に必要
import { runBattle } from "./battleEngine.js?v=20260214";
import * as data from "./data.js?v=20260224";
import { saveBattle } from "./storage.js?v=20260214";

// 長押しで衣装違いなどに切り替える設定
const LONG_PRESS_MS = 3000; // 3秒

// kindごとの「元ID → 別ID」対応表
const LONG_PRESS_MAP = {
  battler: {
    "B06": "B06-2",
    "B14": "B14-2",
    "B25": "B25-2",
    "B26": "B26-2",
  },
  duck: {
  },
};

// tray表示用の形に揃える（listForTrayと同じ形）
function makeTrayItem(kind, raw) {
  if (!raw) return null;
  if (kind === "battler") {
    return {
      kind: "battler",
      id: raw.id,
      name: raw.name,
      icon: raw.icons?.neutral ?? null,
    };
  }
  if (kind === "duck") {
    return {
      kind: "duck",
      id: raw.id,
      name: raw.name,
      icon: raw.icons?.icon ?? null,
    };
  }
  return null;
}

const state = {
  tray: { open: false, player: null, kind: null }, // player: "p1"|"p2", kind:"battler"|"duck"
  selected: {
    p1: { battlerId: null, duckId: null },
    p2: { battlerId: null, duckId: null },
  },
};

const el = {
  tray: document.getElementById("tray"),
  trayTitle: document.getElementById("trayTitle"),
  trayGrid: document.getElementById("trayGrid"),
  trayClose: document.getElementById("trayClose"),

  vsButton: document.getElementById("vsButton"),
  vsSub: document.getElementById("vsSub"),

  btnRandomAll: document.getElementById("btnRandomAll"),

  // 画像表示（立ち絵・アヒル）
  imgs: {
    p1: {
      battler: document.getElementById("p1-battler-img"),
      duck: document.getElementById("p1-duck-img"),
    },
    p2: {
      battler: document.getElementById("p2-battler-img"),
      duck: document.getElementById("p2-duck-img"),
    },
  },

  // 説明枠（赤青の中）
  infos: {
    p1: {
      battler: document.getElementById("p1-battler-info"),
      duck: document.getElementById("p1-duck-info"),
    },
    p2: {
      battler: document.getElementById("p2-battler-info"),
      duck: document.getElementById("p2-duck-info"),
    },
  },

    btnHowTo: document.getElementById("btnHowTo"),
    howtoOverlay: document.getElementById("howtoOverlay"),

    howtoTips: {
      p1Battler: document.getElementById("howtoTipP1Battler"),
      p1Duck: document.getElementById("howtoTipP1Duck"),
      vs: document.getElementById("howtoTipVS"),
      p2Duck: document.getElementById("howtoTipP2Duck"),
      p2Battler: document.getElementById("howtoTipP2Battler"),
      random: document.getElementById("howtoTipRandom"),
    },
};

// クリックでトレイを開く（p1/p2 + battler/duck）
document.querySelectorAll("[data-open]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const v = btn.getAttribute("data-open"); // "p1:battler"
    const [player, kind] = v.split(":");
    openTray(player, kind);
  });
});

el.trayClose.addEventListener("click", closeTray);

el.btnRandomAll?.addEventListener("click", () => {
  closeTray();
  randomSelectAll();
});
function randomPick(items) {
  if (!items || items.length === 0) return null;
  const i = Math.floor(Math.random() * items.length);
  return items[i] ?? null;
}

el.btnHowTo?.addEventListener("click", () => {
  closeTray();
  openHowTo();
});

el.howtoOverlay?.addEventListener("click", () => {
  closeHowTo();
});

function pickForced(player, kind, item) {
  if (!player || !kind || !item) return;

  // pick() は state.tray.player/kind を参照するので、一時的に差し替えて使う
  const prevPlayer = state.tray.player;
  const prevKind = state.tray.kind;

  state.tray.player = player;
  state.tray.kind = kind;
  pick(item);

  state.tray.player = prevPlayer;
  state.tray.kind = prevKind;
}

function randomSelectAll() {
  // battler：-2など除外
  const battlers = listForTray("battler").filter(
    (x) => !String(x.id).includes("-")
  );

const b1 = randomPick(battlers);

  if (!b1) return;

  const b1Base = getBattlerBaseId(b1.id);
  const battlers2 = battlers.filter((x) => getBattlerBaseId(x.id) !== b1Base);
  const b2 = randomPick(battlers2) || b1; // 万一候補が無ければ同じ（通常は起きにくい）

  // duck：ID重複させない
  const ducks = listForTray("duck");
  const d1 = randomPick(ducks);
  if (!d1) return;

  const ducks2 = ducks.filter((x) => x.id !== d1.id);
  const d2 = randomPick(ducks2) || d1;

  // 強制上書き（A）
  pickForced("p1", "battler", b1);
  pickForced("p2", "battler", b2);
  pickForced("p1", "duck", d1);
  pickForced("p2", "duck", d2);

  // 念のため
  requestLayoutRecalc();
}

// Escで閉じる
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeTray();
});

el.vsButton.addEventListener("click", () => {
  if (el.vsButton.disabled) return;

  // battleEngine は p1/p2 キーで受け取る（そのまま渡せる）
  const payload = {
    p1: { ...state.selected.p1 },
    p2: { ...state.selected.p2 },
  };

  // ここからが本番：戦闘→保存→遷移
  try {
    // 1) 戦闘実行
    const out = runBattle({
      p1: payload.p1,
      p2: payload.p2,
      data, // data.BATTLERS / data.DUCKS を参照する
    });

    // 2) 保存して battleId 発行
    const battleId = saveBattle({
      p1: payload.p1,
      p2: payload.p2,
      result: out.result,
      events: out.events,
    });

    // 3) 結果画面へ
    location.href = `result.html?battleId=${encodeURIComponent(String(battleId))}`;
  } catch (err) {
    console.error("[START BATTLE ERROR]", err, payload);
    alert(
      "戦闘開始に失敗しました。\n\n" +
        (err?.message ? String(err.message) : String(err))
    );
  }
});

function openTray(player, kind) {
  state.tray.open = true;
  state.tray.player = player;
  state.tray.kind = kind;

  const titleKind = kind === "battler" ? "バトラー" : "アヒル";
  const titlePlayer = player === "p1" ? "1P" : "2P";
  el.trayTitle.textContent = `${titlePlayer}：${titleKind}を選択`;

  renderTrayItems(listForTray(kind));

  // 既存の色クラスを削除
  el.tray.classList.remove("tray--p1", "tray--p2");
  el.tray.classList.remove("tray--battler", "tray--duck");

  // プレイヤーに応じて色付け
  el.tray.classList.add(player === "p1" ? "tray--p1" : "tray--p2");

  // 種類に応じて色付け
  el.tray.classList.add(kind === "duck" ? "tray--duck" : "tray--battler");

  // ← これ忘れない（表示）
  el.tray.classList.remove("tray--hidden");
}

function closeTray() {
  state.tray.open = false;
  state.tray.player = null;
  state.tray.kind = null;
  el.tray.classList.add("tray--hidden");
  el.trayGrid.innerHTML = "";
}

function getBattlerBaseId(id) {
  if (!id) return null;
  // 例: "B06-2" -> "B06"（末尾が -数字 のときだけまとめる）
  const m = String(id).match(/^(B\d+)(?:-\d+)?$/);
  return m ? m[1] : String(id);
}

function renderTrayItems(items) {
  el.trayGrid.innerHTML = "";

  const { player, kind } = state.tray;
  if (!player || !kind) return;

  // 相手プレイヤー
  const other = player === "p1" ? "p2" : "p1";

  // 相手がすでに選んでいるID
  const usedId =
    kind === "battler"
      ? state.selected[other].battlerId
      : state.selected[other].duckId;

  // battlerは「同一人物グループ」で使用中扱いにする
  const usedBase = kind === "battler" ? getBattlerBaseId(usedId) : usedId;


  for (const item of items) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "trayItem";
    card.dataset.id = item.id;

    const isUsed =
      kind === "battler"
        ? (usedBase && getBattlerBaseId(item.id) === usedBase)
        : (usedId && item.id === usedId);

    if (isUsed) {
      card.disabled = true;
      card.classList.add("trayItem--disabled");
    }

    const img = document.createElement("img");
    img.className = "trayItem__img";
    img.alt = "";
    if (item.icon) img.src = item.icon;
    img.onerror = () => {
      img.style.display = "none";
    };

    const name = document.createElement("div");
    name.className = "trayItem__name";
    name.textContent = item.name ?? item.id;

    card.appendChild(img);
    card.appendChild(name);

if (!isUsed) {
  const altId = LONG_PRESS_MAP?.[kind]?.[item.id] ?? null;

  let timer = null;
  let didLongPress = false;

  const startPress = () => {
    didLongPress = false;
    if (!altId) return; // 対応表にないなら長押し判定しない

    clearTimeout(timer);
    timer = setTimeout(() => {
      didLongPress = true;

      // 別IDがdataに存在するか確認して、選択
      const altRaw = getById(kind, altId);
      const altItem = makeTrayItem(kind, altRaw);
      if (!altItem) return; // 未登録なら何もしない

      pick(altItem);
      closeTray();
    }, LONG_PRESS_MS);
  };

  const cancelPress = () => {
    clearTimeout(timer);
    timer = null;
  };

  // 短押し（通常クリック）
  card.addEventListener("click", (e) => {
    // 長押し発動直後にclickが来る環境があるので抑止
    if (didLongPress) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    pick(item);
    closeTray();
  });

  // マウス/タッチ両対応（pointerで統一）
  card.addEventListener("pointerdown", startPress);
  card.addEventListener("pointerup", cancelPress);
  card.addEventListener("pointercancel", cancelPress);
  card.addEventListener("pointerleave", cancelPress);

  // 長押し時に出ることがあるメニュー抑止（保険）
  card.addEventListener("contextmenu", (e) => e.preventDefault());
}


    el.trayGrid.appendChild(card);
  }
}


function pick(item) {
  const { player, kind } = state.tray;
  if (!player || !kind) return;

  if (kind === "battler") state.selected[player].battlerId = item.id;
  if (kind === "duck") state.selected[player].duckId = item.id;

  renderSide(player);
  updateVS();
}

function renderSide(player) {
  const s = state.selected[player];

  // まずシルエット画像を決める（先）
  const silhouetteSrc = "/img/B00.png";

// battler
const b = getById("battler", s.battlerId);
if (el.infos?.[player]?.battler) {
  el.infos[player].battler.textContent = formatBattlerInfo(b);
}

  setImg(
    el.imgs[player].battler,
    b?.icons?.full ?? null, // 選択済みなら立ち絵
    silhouetteSrc              // 未選択ならシルエット
  );


// duck
const d = getById("duck", s.duckId);
if (el.infos?.[player]?.duck) {
  el.infos[player].duck.textContent = formatDuckInfo(d);
}


  // 未選択/404でも枠が寂しくならないようにフォールバック
  const duckFallback = "../img/D00.png";
  setImg(el.imgs[player].duck, d?.icons?.icon ?? null, duckFallback);

  requestLayoutRecalc();
}


function setImg(imgEl, src, fallbackSrc = null) {
  if (!imgEl) return;

  const wrapper = imgEl.closest(".silhouette, .duckPick");

  // 表示する画像がある場合
  if (src) {
    imgEl.src = src;
    imgEl.style.display = "";
        imgEl.onload = () => {
      requestLayoutRecalc();
    };

    imgEl.onerror = () => {
      // 立ち絵が無ければフォールバックへ
      if (fallbackSrc) {
        imgEl.src = fallbackSrc;
      } else {
        imgEl.style.display = "none";
      }
    };

    wrapper?.classList.add("has-img");
    return;
  }

  // 未選択：フォールバック（シルエット）を使う
  if (fallbackSrc) {
    imgEl.src = fallbackSrc;
    imgEl.style.display = "";

    imgEl.onload = () => {
      requestLayoutRecalc();
    };
    imgEl.onerror = () => {
      imgEl.style.display = "none";
    };

    wrapper?.classList.remove("has-img");
    return;
  }

  // 何も出さない
  imgEl.removeAttribute("src");
  imgEl.style.display = "none";
  wrapper?.classList.remove("has-img");
}

function updateVS() {
  const ok =
    !!state.selected.p1.battlerId &&
    !!state.selected.p1.duckId &&
    !!state.selected.p2.battlerId &&
    !!state.selected.p2.duckId;

  el.vsButton.disabled = !ok;
  el.vsButton.classList.toggle("vs--disabled", !ok);
  el.vsButton.classList.toggle("vs--ready", ok);
}

let howtoOpen = false;

function openHowTo() {
  if (!el.howtoOverlay) return;
  howtoOpen = true;
  el.howtoOverlay.classList.remove("howtoOverlay--hidden");
  el.howtoOverlay.setAttribute("aria-hidden", "false");
  positionHowToTips();
}

function closeHowTo() {
  if (!el.howtoOverlay) return;
  howtoOpen = false;
  el.howtoOverlay.classList.add("howtoOverlay--hidden");
  el.howtoOverlay.setAttribute("aria-hidden", "true");
}

// 目標要素の近くに吹き出しを配置（画面外に出ないよう軽く補正）
function placeTip(tipEl, targetEl, opts = {}) {
  if (!tipEl || !targetEl) return;

  const rect = targetEl.getBoundingClientRect();

  let x = rect.left + rect.width * 0.5;
  let y = rect.top + rect.height * 0.5;

  const pad = 8;

  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${y}px`;
  tipEl.style.transform = "translate(-50%, -50%)";

  // 描画後のサイズで画面外チェック → 補正
  const t = tipEl.getBoundingClientRect();

  if (t.left < pad) {
    tipEl.style.left = `${pad}px`;
    tipEl.style.transform = "translate(0, -100%)";
  } else if (t.right > window.innerWidth - pad) {
    tipEl.style.left = `${window.innerWidth - pad}px`;
    tipEl.style.transform = "translate(-100%, -100%)";
  }

  if (t.top < pad) {
    // 上に出せない場合：下に出す
    tipEl.style.top = `${rect.bottom + 10}px`;
    tipEl.style.transform = "translate(-50%, 0)";
  }
}

function positionHowToTips() {
  if (!howtoOpen) return;

  // ターゲット
  const p1BattlerBtn = document.getElementById("p1-battler-slot");
  const p2BattlerBtn = document.getElementById("p2-battler-slot");
  const p1DuckBtn = document.getElementById("p1-duck-slot");
  const p2DuckBtn = document.getElementById("p2-duck-slot");
  const vsBtn = document.getElementById("vsButton");
  const randomBtn = document.getElementById("btnRandomAll");

  placeTip(el.howtoTips?.p1Battler, p1BattlerBtn);
  placeTip(el.howtoTips?.p1Duck, p1DuckBtn);
  placeTip(el.howtoTips?.vs, vsBtn);
  placeTip(el.howtoTips?.p2Duck, p2DuckBtn);
  placeTip(el.howtoTips?.p2Battler, p2BattlerBtn);
  placeTip(el.howtoTips?.random, randomBtn);
}

function fitBattlersToAvoidOverlap() {
  const img1 = el.imgs?.p1?.battler;
  const img2 = el.imgs?.p2?.battler;
  if (!img1 || !img2) return;

  // いったん等倍に戻してから計測
  const wrap1 = img1.closest(".silhouette") || img1;
  const wrap2 = img2.closest(".silhouette") || img2;

  wrap1.style.setProperty("--battlerScale", "1");
  wrap2.style.setProperty("--battlerScale", "1");

  // 画像がまだレイアウトに乗ってない場合は中断
  const r1 = img1.getBoundingClientRect();
  const r2 = img2.getBoundingClientRect();
  if (r1.width === 0 || r2.width === 0) return;

  // 中心間距離（横）
  const c1 = (r1.left + r1.right) / 2;
  const c2 = (r2.left + r2.right) / 2;
  const D = c2 - c1;

  // 余白（重ならないためのスキマ）
  const margin = 16;

  const hw1 = r1.width / 2;
  const hw2 = r2.width / 2;

  // すでに重なっていないならOK（等倍のまま）
  if (hw1 + hw2 + margin <= D) return;

  // 必要な縮小率（両者同率で縮める）
  let s = (D - margin) / (hw1 + hw2);

  // 下限（これ以上小さくしたくないライン）
  const minScale = 0.55;
  if (!Number.isFinite(s)) s = 1;
  s = Math.max(minScale, Math.min(1, s));

  wrap1.style.setProperty("--battlerScale", String(s));
  wrap2.style.setProperty("--battlerScale", String(s));
}

let layoutRaf = 0;
function requestLayoutRecalc() {
  cancelAnimationFrame(layoutRaf);
  layoutRaf = requestAnimationFrame(() => {
    fitBattlersToAvoidOverlap();
    updateRowSplitByBattlerHeight();
  });
}

function updateRowSplitByBattlerHeight() {
  const grid = document.querySelector(".selectGrid");
  if (!grid) return;

  const img1 = el.imgs?.p1?.battler;
  const img2 = el.imgs?.p2?.battler;
  if (!img1 || !img2) return;

  // 画像の表示高さ（実測）
  const h1 = img1.getBoundingClientRect().height || 0;
  const h2 = img2.getBoundingClientRect().height || 0;
  const h = Math.max(h1, h2);

  // 上段に欲しい余白（好みで後で調整）
  const pad = 0;

  // 画面の利用可能高さ（selectGridは height: calc(100vh - 36px) なのでそれに合わせる）
  const vh = window.visualViewport?.height ?? window.innerHeight;
const gridH = vh;

  // h が 0（未読み込み）だと変な値になるので、とりあえず何もしない
  if (h <= 0 || gridH <= 0) return;

  // 上段の必要高さ（立ち絵高さ + 余白）
  let topH = h + pad;

  // 上限/下限（極端な端末でも破綻しづらくする保険）
  const minTop = Math.max(220, Math.floor(gridH * 0.40));
  const maxTop = Math.floor(gridH * 0.85);
  topH = Math.max(minTop, Math.min(maxTop, topH));

  // CSS変数へ反映（px指定）
  grid.style.setProperty("--topH", `${Math.round(topH)}px`);
}

// 初期描画
renderSide("p1");
renderSide("p2");
updateVS();

requestLayoutRecalc();

window.addEventListener("resize", () => {
  requestLayoutRecalc();
  positionHowToTips();
});


