import { createBattleResultStorage } from "./battleResultStorage.js";
import { getSupabaseClient } from "./authRuntime.js";
import { createOnlinePlayerStorage } from "./onlinePlayerStorage.js";
import { FIXED_IMAGES, setImageWithFallback } from "./fixedImages.js";

const PAGE_SIZE = 30;
const storage = createBattleResultStorage();
const el = id => document.getElementById(id);
let page = 1;
let requestVersion = 0;
let gameAccountId = null;
let ready = false;
let eno = null;
const favoritePending = new Set();

function applyFilters() {
  if (!el("eno").checkValidity()) { el("eno").reportValidity(); return; }
  const value = el("eno").value.trim();
  if (value && (!/^[1-9][0-9]*$/.test(value) || BigInt(value) > 9223372036854775807n)) {
    el("eno").setCustomValidity("ENoは1以上の整数で入力してください。");
    el("eno").reportValidity();
    return;
  }
  eno = value || null;
  el("outcome").disabled = eno === null;
  if (eno === null) el("outcome").value = "all";
  page = 1;
  render();
}
el("eno").addEventListener("input", () => el("eno").setCustomValidity(""));
el("eno").addEventListener("change", applyFilters);
el("eno").addEventListener("keydown", event => { if (event.key === "Enter") applyFilters(); });
for (const id of ["outcome", "favorites", "order"]) el(id).addEventListener("change", applyFilters);
el("prev").addEventListener("click", () => { if (page > 1) { page -= 1; render(); } });
el("next").addEventListener("click", () => { if (!el("next").disabled) { page += 1; render(); } });
window.addEventListener("focus", render);
window.addEventListener("pageshow", render);

async function initialize() {
  for (const id of ["eno", "outcome", "favorites", "order", "prev", "next"]) el(id).disabled = true;
  let account;
  try { account = await createOnlinePlayerStorage(await getSupabaseClient()).resolveAccount(); }
  catch { account = { ok: false }; }
  if (account.ok) {
    gameAccountId = account.account.id;
    eno = account.account.eno;
    el("eno").value = eno;
  } else {
    el("eno").value = "";
    el("accountNotice").hidden = false;
    el("accountNotice").textContent = account.status === "selection-required"
      ? "複数のENoがあるため、初期ENoとお気に入りの対象を選択できません。指定ENoで履歴を検索できます。"
      : "アカウントを解決できないため、お気に入りは使用できません。";
  }
  el("outcome").value = "all";
  el("favorites").value = "all";
  el("order").value = "desc";
  el("eno").disabled = el("order").disabled = false;
  el("outcome").disabled = eno === null;
  el("favorites").disabled = gameAccountId === null;
  ready = true;
  await render();
}

async function render() {
  if (!ready) return;
  const ticket = ++requestVersion;
  el("prev").disabled = true;
  el("next").disabled = true;
  const result = await storage.list({ page, pageSize: PAGE_SIZE,
    order: el("order").value === "asc" ? "asc" : "desc", eno,
    outcome: eno === null ? "all" : el("outcome").value,
    favoritesOnly: gameAccountId !== null && el("favorites").value === "only", gameAccountId });
  if (ticket !== requestVersion) return;
  const list = el("list");
  list.replaceChildren();
  el("error").hidden = result.ok;
  if (!result.ok) {
    el("empty").hidden = true;
    updatePager({ page: 1, totalPages: 0 });
    return;
  }
  page = result.page;
  el("empty").hidden = result.total !== 0;
  for (const record of result.records) list.append(buildRow(record));
  updatePager(result);
}

function buildRow(record) {
  const row = document.createElement("article");
  row.className = "row";
  const identity = document.createElement("div");
  identity.className = "identity";
  const star = document.createElement("button");
  star.className = "favorite";
  star.type = "button";
  setStar(star, record.favorite);
  star.disabled = gameAccountId === null || favoritePending.has(record.battleId);
  star.addEventListener("click", async () => {
    if (star.disabled || favoritePending.has(record.battleId)) return;
    const favorite = !record.favorite;
    favoritePending.add(record.battleId);
    star.disabled = true;
    el("favoriteError").hidden = true;
    // Invalidate pending lists so a pre-write response cannot restore an old star.
    ++requestVersion;
    const result = await storage.setFavorite({ gameAccountId, battleId: record.battleId, favorite });
    favoritePending.delete(record.battleId);
    if (result.ok) { record.favorite = result.favorite; setStar(star, record.favorite); }
    else el("favoriteError").hidden = false;
    star.disabled = gameAccountId === null;
    await render();
  });
  const number = document.createElement("span");
  number.className = "id";
  number.textContent = `#${record.battleNo}`;
  identity.append(star, number);

  const mid = document.createElement("div");
  mid.className = "mid";
  const vs = document.createElement("a");
  vs.className = "vs";
  vs.href = `result.html?battleId=${encodeURIComponent(record.battleId)}`;
  vs.textContent = "VS";
  vs.setAttribute("aria-label", `戦闘 #${record.battleNo} の結果を見る`);
  mid.append(buildBadge(record.result, "P1"), vs, buildBadge(record.result, "P2"));
  const date = document.createElement("time");
  date.className = "date";
  date.dateTime = record.dateISO;
  date.title = new Date(record.dateISO).toLocaleString("ja-JP");
  date.textContent = formatDate(record.dateISO);
  row.append(identity, buildPlayer("P1", record.p1), mid, buildPlayer("P2", record.p2), date);
  return row;
}

function setStar(button, favorite) {
  button.textContent = favorite ? "★" : "☆";
  button.setAttribute("aria-pressed", String(Boolean(favorite)));
  const label = favorite ? "お気に入りを解除" : "お気に入りに追加";
  button.setAttribute("aria-label", label);
  button.title = label;
}
function buildPlayer(side, player) {
  const cell = document.createElement("div");
  cell.className = `cell ${side.toLowerCase()}`;
  const identity = `ENo.${player.eno} ${player.battlerName} ＋ ${player.duckName}`;
  cell.setAttribute("aria-label", `${side} ${identity}`);
  const battler = document.createElement("img");
  battler.className = "icon";
  battler.alt = `ENo.${player.eno} Battler: ${player.battlerName}`;
  battler.title = battler.alt;
  setImageWithFallback(battler, player.presentation?.battlerDefaultIconUrl, FIXED_IMAGES.battlerIcon);
  const duck = document.createElement("img");
  duck.className = "icon";
  duck.alt = `ENo.${player.eno} Duck: ${player.duckName}`;
  duck.title = duck.alt;
  setImageWithFallback(duck, player.presentation?.duckIconUrl, FIXED_IMAGES.duckIcon);
  cell.append(...(side === "P1" ? [battler, duck] : [duck, battler]));
  return cell;
}
function buildBadge(result, side) {
  const outcome = result === "draw" ? "DRAW" : result === `${side}_win` ? "WIN" : "LOSE";
  const badge = document.createElement("span");
  badge.className = `badge ${outcome.toLowerCase()} badge${side}`;
  badge.textContent = outcome;
  return badge;
}
function updatePager(result) {
  const totalPages = result.totalPages || 0;
  const shownPage = totalPages === 0 ? 1 : result.page;
  el("pageInfo").textContent = `${shownPage} / ${Math.max(1, totalPages)}`;
  el("prev").disabled = totalPages === 0 || shownPage <= 1;
  el("next").disabled = totalPages === 0 || shownPage >= totalPages;
}
function formatDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  const pad = value => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}\n${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
await initialize();
