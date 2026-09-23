import { createPlayerBuildStorage } from "./playerBuildStorage.js";
import { createSelectState, duckChoices, selectOwnDuck, battleStartStatus, battlerSummary, duckSummary } from "./selectState.js";
let state = createSelectState(createPlayerBuildStorage().load());
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
  const start = battleStartStatus();
  el("vsButton").disabled = !start.canStart;
  el("vs-reason").textContent = start.reason;
  renderSelf();
}
function openTray() {
  const grid = el("trayGrid"); grid.replaceChildren();
  const choices = duckChoices(state);
  if (!choices.length) {
    const p = document.createElement("p");
    p.textContent = state.message || "アヒル設定はまだありません。「設定を編集」から追加してください。";
    grid.append(p);
  }
  for (const choice of choices) {
    const card = document.createElement("article"); card.className = "trayItem";
    const button = document.createElement("button"); button.type = "button";
    button.textContent = `${choice.name} — ${choice.status}`;
    button.disabled = !choice.ready;
    button.setAttribute("aria-pressed", String(state.selectedDuckId === choice.id));
    card.classList.toggle("unavailable", !choice.ready);
    card.append(button);
    if (choice.reasons.length) {
      const details = document.createElement("details"), summary = document.createElement("summary");
      summary.textContent = "理由を確認"; details.append(summary);
      const list = document.createElement("ul");
      for (const reason of choice.reasons) { const li = document.createElement("li"); li.textContent = reason; list.append(li); }
      details.append(list); card.append(details);
    }
    button.addEventListener("click", () => { state = selectOwnDuck(state, choice.id); renderSelf(); tray.close(); });
    grid.append(card);
  }
  tray.showModal();
}
el("p1-duck-slot").addEventListener("click", openTray);
el("trayClose").addEventListener("click", () => tray.close());
tray.addEventListener("close", () => el("p1-duck-slot").focus());
renderScreen();
