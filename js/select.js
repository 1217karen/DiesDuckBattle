import { createPlayerBuildStorage } from "./playerBuildStorage.js";
import { createSelectState, duckChoices, selectOwnDuck, battleStartStatus, battlerSummary, duckSummary, selectOpponent } from "./selectState.js";
import { listOpponents, getOpponent } from "./opponentSource.js";
import { startSelectedBattle } from "./selectBattle.js";
import { createBattleId, createBattleResultStorage } from "./battleResultStorage.js";
import { createPlayerPresentationStorage } from "./playerPresentationStorage.js";
import { buildBattlePresentationSnapshot } from "./battlePresentationSnapshot.js";
import { createSelectPresentation } from "./selectPresentation.js";
let state = createSelectState(createPlayerBuildStorage().load());
const ownPresentation = createPlayerPresentationStorage().load().presentation;
const renderPresentation = createSelectPresentation();
const el = id => document.getElementById(id);
const tray = el("tray");
function renderSelf() {
  el("self-name").textContent = state.self.name;
  el("load-status").textContent = state.message || (state.build.ducks.length ? "" : "アヒル設定はまだありません。設定を編集して追加してください。");
  el("load-status").classList.toggle("error", !state.build);
  el("p1-battler-info").textContent = battlerSummary(state.build?.battler);
  const duck = state.build?.ducks.find(d => d.id === state.selectedDuckId);
  const name = duckChoices(state).find(d => d.id === duck?.id)?.name;
  el("p1-duck-info").textContent = state.build ? duckSummary(duck, name) : "保存データを読み込めないため選択できません。";
  el("duck-name").textContent = name ?? "選択する";
}
function renderScreen() {
  renderPresentation("p1", ownPresentation, state.selectedDuckId);
  renderPresentation("p2", state.opponent?.presentation, state.opponent?.publicDuckId);
  const start = battleStartStatus(state);
  el("vsButton").disabled = !start.canStart;
  el("vs-reason").textContent = start.reason;
  el("vsButton").classList.toggle("vs--disabled", !start.canStart);
  el("vsButton").setAttribute("aria-label", `戦闘開始：${start.reason}`);
  renderSelf();
  el("opponent-name").textContent = state.opponent?.name ?? "相手を選択";
  el("p2-battler-info").textContent = state.opponent ? `${state.opponent.name}\n${battlerSummary(state.opponent.build.battler)}` : "右側の2P枠から相手を選択してください。";
  const duck = state.opponent?.build.ducks.find(d => d.id === state.opponent.publicDuckId);
  const name = duck?.name || (duck ? `アヒル ${state.opponent.build.ducks.indexOf(duck) + 1}` : null);
  el("p2-duck-name").textContent = name ?? "公開Duck";
  el("p2-duck-info").textContent = duck ? duckSummary(duck, name) : state.opponent ? "この相手は現在対戦できません。" : "相手を選択してください。";
}
let requestVersion = 0, returnFocus = "p1-duck-slot";
function showMessage(message) { const p = document.createElement("p"); p.textContent = message; el("trayGrid").replaceChildren(p); }
function renderChoices(choices, selected, onPick) {
  const grid = el("trayGrid"); grid.replaceChildren();
  for (const choice of choices) {
    const card = document.createElement("article"); card.className = "trayItem";
    const button = document.createElement("button"); button.type = "button";
    button.textContent = `${choice.name} — ${choice.status}`;
    button.disabled = !choice.ready;
    button.setAttribute("aria-pressed", String(selected === choice.id)); card.append(button);
    if (choice.reasons.length) {
      const details = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = "理由を確認"; details.append(summary);
      const list = document.createElement("ul");
      for (const reason of choice.reasons) { const li = document.createElement("li"); li.textContent = reason; list.append(li); }
      details.append(list); card.append(details);
    }
    button.addEventListener("click", () => onPick(choice.id)); grid.append(card);
  }
}
function selectionChanged() { el("battle-result").textContent = ""; renderScreen(); tray.close(); }
async function openTray(kind, opener) {
  returnFocus = opener;
  const version = ++requestVersion;
  el("trayTitle").textContent = kind === "self" ? "1P：アヒルを選択" : "2P：相手を選択";
  tray.classList.toggle("tray--p2", kind !== "self");
  showMessage("読み込み中…"); tray.showModal();
  if (kind === "opponents") {
    try {
      const opponents = await listOpponents();
      if (version !== requestVersion || !tray.open) return;
      if (!opponents.length) { showMessage("選択できる相手がいません。"); return; }
      renderChoices(opponents.map(o => ({ ...o, ready:true, status:"選択", reasons:[] })), state.opponent?.id, async id => {
        const pickVersion = ++requestVersion; showMessage("相手を読み込み中…");
        try {
          const opponent = await getOpponent(id);
          if (pickVersion !== requestVersion || !tray.open) return;
          if (!opponent) { showMessage("この相手は現在対戦できません。閉じて選び直してください。"); return; }
          state = selectOpponent(state, opponent); selectionChanged();
        } catch { if (pickVersion === requestVersion && tray.open) showMessage("相手を読み込めませんでした。閉じて再試行してください。"); }
      });
    } catch { if (version === requestVersion && tray.open) showMessage("相手一覧を取得できませんでした。閉じて再試行してください。"); }
  } else {
    const choices = duckChoices(state);
    if (!choices.length) { showMessage(state.message || "アヒル設定はまだありません。設定を編集して追加してください。"); return; }
    renderChoices(choices, state.selectedDuckId, id => {
      state = selectOwnDuck(state,id); selectionChanged();
    });
  }
}
for (const [id,kind] of [["p1-duck-slot","self"],["p2-battler-slot","opponents"]])
  el(id).addEventListener("click", () => openTray(kind,id));
el("trayClose").addEventListener("click", () => tray.close());
tray.addEventListener("close", () => { requestVersion++; el(returnFocus).focus(); });
el("vsButton").addEventListener("click", () => {
  if (!battleStartStatus(state).canStart) return;
  el("vsButton").disabled = true;
  try {
    const p1Presentation = buildBattlePresentationSnapshot(
      createPlayerPresentationStorage().load().presentation, state.selectedDuckId);
    const p2Presentation = buildBattlePresentationSnapshot(state.opponent.presentation, state.opponent.publicDuckId);
    const battle = startSelectedBattle(state);
    if (!battle.ok) {
      el("battle-result").textContent = battle.message;
      renderScreen();
      return;
    }
    const battleId = createBattleId();
    const side = meta => ({ battlerId: String(meta?.battlerId ?? ""), battlerName: String(meta?.battlerName ?? ""),
      duckId: String(meta?.duckId ?? ""), duckName: String(meta?.duckName ?? "") });
    const saved = createBattleResultStorage().save({
      battleId,
      dateISO: new Date().toISOString(),
      p1: { ...side(battle.p1), presentation: p1Presentation },
      p2: { ...side(battle.p2), presentation: p2Presentation },
      result: battle.result,
      events: battle.events,
    });
    if (!saved.ok) {
      el("battle-result").textContent = "戦闘結果を保存できませんでした。空き容量やブラウザ設定を確認してください。";
      renderScreen();
      return;
    }
    location.assign(`result.html?battleId=${encodeURIComponent(battleId)}`);
  } catch {
    el("battle-result").textContent = "戦闘を開始できませんでした。設定を確認してください。";
  }
  renderScreen();
});
renderScreen();
