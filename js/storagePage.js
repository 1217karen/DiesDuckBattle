import { createBattleResultStorage } from "./battleResultStorage.js";

const PAGE_SIZE = 30;
const storage = createBattleResultStorage();
const el = id => document.getElementById(id);
let page = 1;
let order = "desc";

el("order").addEventListener("change", event => {
  order = event.target.value === "asc" ? "asc" : "desc";
  page = 1;
  render();
});
el("prev").addEventListener("click", () => { if (page > 1) { page -= 1; render(); } });
el("next").addEventListener("click", () => { page += 1; render(); });
window.addEventListener("focus", render);
window.addEventListener("storage", render);
window.addEventListener("pageshow", render);

function render() {
  order = el("order").value === "asc" ? "asc" : "desc";
  const result = storage.list({ page, pageSize: PAGE_SIZE, order });
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

  const date = document.createElement("time");
  date.className = "date";
  date.dateTime = record.dateISO;
  date.textContent = formatDate(record.dateISO);

  const p1 = buildPlayer("P1", record.p1, outcomeForSide(record.result, "P1"));
  const p2 = buildPlayer("P2", record.p2, outcomeForSide(record.result, "P2"));
  const vs = document.createElement("div");
  vs.className = "vs";
  vs.textContent = "VS";

  const link = document.createElement("a");
  link.className = "resultLink";
  link.href = `result.html?battleId=${encodeURIComponent(record.battleId)}`;
  link.textContent = "結果を見る";

  row.append(date, p1, vs, p2, link);
  return row;
}

function buildPlayer(side, player, outcome) {
  const cell = document.createElement("section");
  cell.className = `player ${side.toLowerCase()}`;
  cell.setAttribute("aria-label", `${side} ${player.battlerName} ${player.duckName} ${outcome}`);

  const icon = document.createElement("div");
  icon.className = "icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = side;

  const info = document.createElement("div");
  info.className = "playerInfo";
  const name = document.createElement("div");
  name.className = "playerName";
  name.textContent = `${player.battlerName} ＋ ${player.duckName}`;
  const badge = document.createElement("span");
  badge.className = `badge ${outcome.toLowerCase()}`;
  badge.textContent = outcome;
  info.append(name, badge);
  cell.append(icon, info);
  return cell;
}

function updatePager(result) {
  const totalPages = result.totalPages || 0;
  const shownPage = totalPages === 0 ? 1 : result.page;
  el("pageInfo").textContent = `${shownPage} / ${Math.max(1, totalPages)}`;
  el("prev").disabled = totalPages === 0 || shownPage <= 1;
  el("next").disabled = totalPages === 0 || shownPage >= totalPages;
}

function outcomeForSide(result, side) {
  if (result === "draw") return "DRAW";
  if (result === "P1_win") return side === "P1" ? "WIN" : "LOSE";
  if (result === "P2_win") return side === "P2" ? "WIN" : "LOSE";
  return "DRAW";
}

function formatDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}\n${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

render();
