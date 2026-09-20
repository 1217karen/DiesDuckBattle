//storagePage.js
console.log("storagePage.js loaded");

import {
  listBattleSummaries,
  deleteBattlesByIds,
  setBattlesProtected,
  formatDateJP,
} from "./storage.js";

import { BATTLERS } from "./data.js";

const elList = document.getElementById("list");
const elEmpty = document.getElementById("empty");

// 追加：操作ボタンをヘッダーに作る（HTMLは変えなくてもJSで足す）
const tools = document.querySelector(".tools");
const btnDeleteSel = document.createElement("button");
btnDeleteSel.className = "btn danger";
btnDeleteSel.type = "button";
btnDeleteSel.textContent = "🗑️選択を削除";

const btnProtectSel = document.createElement("button");
btnProtectSel.className = "btn";
btnProtectSel.type = "button";
btnProtectSel.textContent = "🔒 選択を保護";

const btnUnprotectSel = document.createElement("button");
btnUnprotectSel.className = "btn";
btnUnprotectSel.type = "button";
btnUnprotectSel.textContent = "🔓 保護解除";

const btnClearAll = document.createElement("button");
btnClearAll.id = "btnClearAll";
btnClearAll.className = "btn danger";
btnClearAll.type = "button";
btnClearAll.textContent = "💣全削除";

tools?.append(btnProtectSel);
tools?.append(btnUnprotectSel);
tools?.append(btnDeleteSel);
tools?.append(btnClearAll);

function getBattlerById(id) {
  return BATTLERS.find((b) => b.id === id) ?? null;
}

function battlerIconPath(battlerId) {
  const b = getBattlerById(battlerId);
  return b?.icons?.neutral ?? `img/Battler/icon/${battlerId}_1.png`;
}

function duckIconPath(duckId) {
  return `img/Duck/${duckId}.png`;
}

function outcomeForSide(result, side) {
  if (result === "draw") return "DRAW";
  if (result === "P1_win") return side === "P1" ? "WIN" : "LOSE";
  if (result === "P2_win") return side === "P2" ? "WIN" : "LOSE";
  return "DRAW";
}

function badgeClass(text) {
  if (text === "WIN") return "win";
  if (text === "LOSE") return "lose";
  return "draw";
}

function escapeHTML(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getSelectedIds() {
  const chks = elList.querySelectorAll('input[type="checkbox"][data-battle-id]:checked');
  return Array.from(chks).map(c => Number(c.getAttribute("data-battle-id"))).filter(Number.isFinite);
}

function render() {
  const list = listBattleSummaries();

  elList.innerHTML = "";
  elEmpty.hidden = list.length !== 0;

  for (const r of list) {
    const p1 = r.p1;
    const p2 = r.p2;

    const p1Res = outcomeForSide(r.result, "P1");
    const p2Res = outcomeForSide(r.result, "P2");

    const row = document.createElement("div");
    row.className = "row";

    // 左：チェック＋🔒＋ID
    const sel = document.createElement("div");
    sel.className = "sel";
    sel.innerHTML =
      `<input class="chk" type="checkbox" data-battle-id="${escapeHTML(String(r.battleId))}" aria-label="選択">` +
      `<span class="lock ${r.protected ? "" : "hidden"}" title="保護">🔒</span>` +
      `<span class="id">#${escapeHTML(String(r.battleId))}</span>`;
    row.appendChild(sel);

    // 左側（P1）：アイコンだけ
    const left = document.createElement("div");
    left.className = "cell";
    left.innerHTML =
      `<img class="icon" src="${escapeHTML(battlerIconPath(p1.battlerId))}" alt="">` +
      `<img class="icon" src="${escapeHTML(duckIconPath(p1.duckId))}" alt="">`;
    row.appendChild(left);

    // 中央：P1勝敗 / VS / P2勝敗 をまとめる
    const mid = document.createElement("div");
    mid.className = "mid";

    const p1Badge = document.createElement("span");
    p1Badge.className = `badge ${badgeClass(p1Res)} badgeP1`;
    p1Badge.textContent = p1Res;

    const vs = document.createElement("a");
    vs.className = "vs";
    vs.href = `result.html?battleId=${encodeURIComponent(String(r.battleId))}`;
    vs.textContent = "VS";

    const p2Badge = document.createElement("span");
    p2Badge.className = `badge ${badgeClass(p2Res)} badgeP2`;
    p2Badge.textContent = p2Res;

    mid.appendChild(p1Badge);
    mid.appendChild(vs);
    mid.appendChild(p2Badge);
    row.appendChild(mid);

    // 右側（P2）：アイコンだけ
    const right = document.createElement("div");
    right.className = "cell";
    right.innerHTML =
      `<img class="icon" src="${escapeHTML(duckIconPath(p2.duckId))}" alt="">` +
      `<img class="icon" src="${escapeHTML(battlerIconPath(p2.battlerId))}" alt="">`;
    row.appendChild(right);



    // 日時
    const date = document.createElement("div");
    date.className = "date";
    date.textContent = formatDateJP(r.dateISO);
    row.appendChild(date);

    elList.appendChild(row);
  }
}

btnDeleteSel.addEventListener("click", () => {
  const ids = getSelectedIds();
  if (ids.length === 0) return;

  const ok = confirm(`選択した ${ids.length} 件を削除します。よろしいですか？\n（保護🔒されているものは削除されません）`);
  if (!ok) return;

  const res = deleteBattlesByIds(ids);
  if (res.skippedProtected > 0) {
    alert(`削除: ${res.deleted}件 / 保護のためスキップ: ${res.skippedProtected}件`);
  }
  render();
});

btnProtectSel.addEventListener("click", () => {
  const ids = getSelectedIds();
  if (ids.length === 0) return;
  setBattlesProtected(ids, true);
  render();
});

btnUnprotectSel.addEventListener("click", () => {
  const ids = getSelectedIds();
  if (ids.length === 0) return;
  setBattlesProtected(ids, false);
  render();
});

btnClearAll?.addEventListener("click", () => {
  const list = listBattleSummaries();

  const unprotectedIds = list
    .filter((r) => !r.protected)
    .map((r) => r.battleId);

  if (unprotectedIds.length === 0) {
    alert("削除できる履歴がありません（全て保護されています）");
    return;
  }

  const protectedCount = list.length - unprotectedIds.length;

  const ok = confirm(
    `保護されていない履歴 ${unprotectedIds.length} 件を削除します。\n` +
      `（保護🔒：${protectedCount} 件は残ります）\n\n` +
      `よろしいですか？`
  );
  if (!ok) return;

  deleteBattlesByIds(unprotectedIds);
  render();
});

// 初回描画
render();

// result画面から戻ってきた時や、別タブで更新された時に再描画
window.addEventListener("focus", render);
window.addEventListener("storage", render);
