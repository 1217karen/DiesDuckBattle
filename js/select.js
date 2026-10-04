import { finishPageLoad } from "./pageLoad.js";
import { duckChoices, battleStartStatus, battlerSummary, duckSummary, createSelectState } from "./selectState.js";
import { getSupabaseClient } from "./authRuntime.js";
import { createOnlineSelectService } from "./onlineSelectService.js";
import { createOnlineSelectController } from "./onlineSelectController.js";
import { createSelectPresentation } from "./selectPresentation.js";
import { requireLoginPage } from "./authPageGuard.js";
import { renderChoices } from "./selectTray.js";
import { FIXED_IMAGES } from "./fixedImages.js";

await requireLoginPage();

let state = createSelectState({ ok: false, status: "loading" });
let ownPresentation, online;
let current = { busy: "load", message: "オンライン設定を読み込み中…", canStart: false };
const renderPresentation = createSelectPresentation();
const el = id => document.getElementById(id);
const tray = el("tray");
function renderSelf() {
  el("p1-battler-name").textContent = state.build ? state.self.name : "";
  el("load-status").textContent = current.message || (state.build?.ducks.length ? "" : "アヒル設定はまだありません。設定を編集して追加してください。");
  el("load-status").classList.toggle("error", !state.build);
  el("p1-battler-info").textContent = battlerSummary(state.build?.battler);
  const duck = state.build?.ducks.find(d => d.id === state.selectedDuckId);
  const name = duckChoices(state).find(d => d.id === duck?.id)?.name;
  el("self-name").textContent = (current.eno ? `ENo.${current.eno}｜${state.self.name}` : "自分") + (duck ? ` ＋ ${name}` : "");
  el("p1-duck-name").textContent = name ?? "";
  el("p1-duck-info").textContent = state.build ? duckSummary(duck) : "保存データを読み込めないため選択できません。";
}
function renderScreen() {
  renderPresentation("p1", ownPresentation, state.selectedDuckId);
  const masked = current.selectionMode === "random" && state.opponent;
  const opponentPresentation = masked ? {
    battler: { standingImageUrl: FIXED_IMAGES.battlerRandomStanding },
    ducks: { [state.opponent.publicDuckId]: { iconUrl: FIXED_IMAGES.duckRandomIcon } },
  } : state.opponent?.presentation;
  renderPresentation("p2", opponentPresentation, state.opponent?.publicDuckId);
  const start = { canStart: current.canStart, reason: current.busy ? "オンラインデータを確認中…" : current.message || battleStartStatus(state).reason };
  el("random-opponent").disabled = !!current.busy || !state.build;
  el("random-win-streak").hidden = !(current.randomWinStreak > 0);
  el("random-win-streak").textContent = current.randomWinStreak > 0 ? `${current.randomWinStreak}連勝中！` : "";
  el("p1-duck-slot").disabled = !!current.busy || !state.build;
  el("p2-battler-slot").disabled = !!current.busy || !state.build;
  el("vsButton").disabled = !start.canStart;
  el("vs-reason").textContent = start.reason;
  el("vsButton").classList.toggle("vs--disabled", !start.canStart);
  el("vsButton").setAttribute("aria-label", `戦闘開始：${start.reason}`);
  renderSelf();
  el("p2-battler-name").textContent = state.opponent?.name ?? "";
  el("p2-battler-info").textContent = state.opponent ? battlerSummary(state.opponent.build.battler) : "右側の2P枠から相手を選択してください。";
  const duck = state.opponent?.build.ducks.find(d => d.id === state.opponent.publicDuckId);
  const name = duck?.name || (duck ? `アヒル ${state.opponent.build.ducks.indexOf(duck) + 1}` : null);
  el("opponent-name").textContent = state.opponent ? `ENo.${state.opponent.eno}｜${state.opponent.name}` + (duck ? ` ＋ ${name}` : "") : "相手を選択";
  el("p2-duck-name").textContent = name ?? "";
  el("p2-duck-info").textContent = duck ? duckSummary(duck) : state.opponent ? "この相手は現在対戦できません。" : "相手を選択してください。";
  if (masked) for (const id of ["opponent-name", "p2-battler-name", "p2-battler-info", "p2-duck-name", "p2-duck-info"])
    el(id).textContent = "？？？";
}
let requestVersion = 0, returnFocus = "p1-duck-slot";
function showMessage(message) { const p = document.createElement("p"); p.textContent = message; el("trayGrid").replaceChildren(p); }
function selectionChanged() { el("battle-result").textContent = ""; renderScreen(); tray.close(); }
async function openTray(kind, opener) {
  if (!online || current.busy || !state.build) return;
  returnFocus = opener;
  const version = ++requestVersion;
  el("trayTitle").textContent = kind === "self" ? "1P：アヒルを選択" : "2P：相手を選択";
  tray.classList.toggle("tray--p2", kind !== "self");
  showMessage("読み込み中…"); tray.showModal();
  if (kind === "opponents") {
    try {
      const result = await online.listOpponents();
      const opponents = result.opponents ?? [];
      if (version !== requestVersion || !tray.open) return;
      if (!result.ok) { showMessage(result.message ?? "相手一覧を読み込めませんでした。"); return; }
      if (!opponents.length) { showMessage("選択できる相手がいません。"); return; }
      renderChoices(el("trayGrid"), opponents.map(o => ({ ...o, ready:true, reasons:[] })), state.opponent?.id, async id => {
        const pickVersion = ++requestVersion; showMessage("相手を読み込み中…");
        try {
          const picked = await online.chooseOpponent(id);
          if (pickVersion !== requestVersion || !tray.open) return;
          if (!picked.ok) { showMessage(picked.message ?? "この相手は現在対戦できません。閉じて選び直してください。"); return; }
          selectionChanged();
        } catch { if (pickVersion === requestVersion && tray.open) showMessage("相手を読み込めませんでした。閉じて再試行してください。"); }
      }, { kind: "opponents" });
    } catch { if (version === requestVersion && tray.open) showMessage("相手一覧を取得できませんでした。閉じて再試行してください。"); }
  } else {
    const choices = duckChoices(state);
    if (!choices.length) { showMessage(state.message || "アヒル設定はまだありません。設定を編集して追加してください。"); return; }
    renderChoices(el("trayGrid"), choices, state.selectedDuckId, id => {
      online.chooseOwn(id); selectionChanged();
    }, { kind: "self", presentation: ownPresentation });
  }
}
for (const [id,kind] of [["p1-duck-slot","self"],["p2-battler-slot","opponents"]])
  el(id).addEventListener("click", () => openTray(kind,id));
el("trayClose").addEventListener("click", () => tray.close());
tray.addEventListener("close", () => { requestVersion++; online?.cancelSelection(); el(returnFocus).focus(); });
el("vsButton").addEventListener("click", async () => {
  const result = await online?.start();
  if (result?.ok) location.assign(`result.html?battleId=${encodeURIComponent(result.battleId)}`);
});
el("random-opponent").addEventListener("click", async () => {
  const result = await online?.chooseRandomOpponent();
  if (result?.ok) el("battle-result").textContent = "";
});
renderScreen();

async function initialize() {
  try {
    const client = await getSupabaseClient();
    online = createOnlineSelectController({ service: createOnlineSelectService(client) });
    online.subscribe(next => {
      current = next; state = next.state; ownPresentation = next.ownPresentation;
      if (!state.build) { requestVersion++; el("trayGrid").replaceChildren(); if (tray.open) tray.close(); }
      renderScreen();
    });
    let knownUser;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      const userId = session?.user?.id ?? null;
      if (event === "SIGNED_OUT" || (knownUser !== undefined && knownUser !== userId)
          || (current.authUserId && current.authUserId !== userId)) online.invalidate();
      knownUser = userId;
    });
    const recheck = () => { if (document.visibilityState !== "hidden") void online.checkScope(); };
    window.addEventListener("focus", recheck);
    window.addEventListener("pageshow", recheck);
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("pagehide", event => {
      if (event.persisted) return;
      subscription.unsubscribe(); online.invalidate();
      window.removeEventListener("focus", recheck); window.removeEventListener("pageshow", recheck); document.removeEventListener("visibilitychange", recheck);
    });
    await online.load();
    renderScreen();
  } catch {
    current = { busy: "", message: "オンライン対戦を準備できませんでした。通信状況を確認し、ページを再読み込みしてください。", canStart: false };
    renderScreen();
  }
}
await initialize();
finishPageLoad();
