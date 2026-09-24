import { buildBlocks, numberOr } from "./resultBlocks.js";
import { setHeaderIcon, attachImageFallbacks } from "./resultPresentation.js";
import { createBattleResultStorage } from "./battleResultStorage.js";

const el = id => document.getElementById(id);
const logArea = el("logArea");
const btnNext = el("btnNext");
const btnAll = el("btnAll");
const btnBack = el("btnBack");
const battleId = new URLSearchParams(location.search).get("battleId");
const loaded = battleId ? createBattleResultStorage().load(battleId) : { ok: false, status: "invalid-id" };

if (!loaded.ok) {
  const messages = {
    "invalid-id": "battleId が指定されていません。",
    "not-found": "指定された戦闘結果が見つかりません。",
    corrupt: "戦闘結果を読み込めませんでした。",
    "storage-error": "ブラウザの保存領域を読み込めませんでした。",
  };
  showError(messages[loaded.status] ?? "戦闘結果を表示できませんでした。");
} else {
  setup(loaded.record);
}

function setup(record) {
  const start = record.events.find(event => event?.type === "battleStart");
  const meta = {
    P1: start?.meta?.P1 ?? record.p1,
    P2: start?.meta?.P2 ?? record.p2,
  };
  const names = {
    P1: { battler: record.p1.battlerName, duck: record.p1.duckName },
    P2: { battler: record.p2.battlerName, duck: record.p2.duckName },
  };
  const maxHP = { P1: numberOr(meta.P1?.maxHP, 0), P2: numberOr(meta.P2?.maxHP, 0) };

  el("p1Name").textContent = `${names.P1.battler} ＋ ${names.P1.duck}`;
  el("p2Name").textContent = `${names.P2.battler} ＋ ${names.P2.duck}`;

  const presentations = { P1: record.p1.presentation, P2: record.p2.presentation };
  for (const side of ["P1", "P2"]) {
    setHeaderIcon(el(`${side.toLowerCase()}BattlerIcon`), presentations[side]?.battlerDefaultIconUrl);
    setHeaderIcon(el(`${side.toLowerCase()}DuckIcon`), presentations[side]?.duckIconUrl);
  }
  const context = { names, maxHP, start, presentations };
  const blocks = buildBlocks(record.events, record.result, context);
  let cursor = 0;
  updateHeader({ turn: 0, phase: 0, stateAfter: { hp: { ...maxHP }, ap: { P1: 0, P2: 0 } } }, maxHP);

  btnBack.addEventListener("click", () => history.back());
  btnNext.addEventListener("click", () => {
    if (cursor >= blocks.length) return;
    renderBlock(blocks[cursor], true);
    updateHeader(blocks[cursor], maxHP);
    cursor += 1;
    finishControls(cursor, blocks.length);
  });
  btnAll.addEventListener("click", () => {
    if (cursor >= blocks.length) return;
    const fragment = document.createDocumentFragment();
    while (cursor < blocks.length) fragment.append(buildBlockElement(blocks[cursor++]));
    logArea.append(fragment);
    updateHeader(blocks.at(-1), maxHP);
    finishControls(cursor, blocks.length);
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  });
}

function finishControls(cursor, length) {
  const done = cursor >= length;
  btnNext.disabled = done;
  btnAll.disabled = done;
  btnBack.hidden = !done;
}

function buildBlockElement(block) {
  const section = document.createElement("section");
  const side = String(block.side ?? "system").toLowerCase();
  section.className = `phaseBlock ${side}`;
  if (block.headerText) {
    const header = document.createElement("div");
    header.className = `phaseHeader ${side}`;
    header.innerHTML = block.headerText;
    section.append(header);
  }
  const lines = document.createElement("div");
  lines.className = "lines";
  for (const line of block.lines) {
    const div = document.createElement("div");
    div.className = `line${line.kind ? ` ${line.kind}` : ""}`;
    div.innerHTML = line.text;
    attachImageFallbacks(div);
    lines.append(div);
  }
  section.append(lines);
  return section;
}

function renderBlock(block, scroll) {
  const section = buildBlockElement(block);
  logArea.append(section);
  if (scroll) {
    const headerHeight = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue("--header-h"), 10) || 0;
    window.scrollTo({ top: section.getBoundingClientRect().top + window.scrollY - headerHeight, behavior: "smooth" });
  }
}

function updateHeader(block, maxHP) {
  const state = block?.stateAfter;
  if (!state) return;
  el("centerTurn").textContent = `TURN ${block.turn ?? "-"}`;
  el("centerPhase").textContent = `PHASE ${block.phase ?? "-"}${block.side && block.side !== "system" ? `（${block.side}）` : ""}`;
  el("centerHP_P1").textContent = `1P ${state.hp?.P1 ?? "-"}/${maxHP.P1}`;
  el("centerHP_P2").textContent = `2P ${state.hp?.P2 ?? "-"}/${maxHP.P2}`;
  el("centerAP_P1").textContent = `1P ${state.ap?.P1 ?? "-"}`;
  el("centerAP_P2").textContent = `2P ${state.ap?.P2 ?? "-"}`;
}

function showError(message) {
  logArea.innerHTML = "";
  const error = document.createElement("div");
  error.className = "errorMessage";
  error.textContent = message;
  logArea.append(error);
  btnNext.disabled = true;
  btnAll.disabled = true;
  btnBack.hidden = false;
  btnBack.addEventListener("click", () => history.back());
}
