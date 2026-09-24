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

  const context = { names, maxHP, start };
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

function buildBlocks(events, result, context) {
  const blocks = [];
  let current = null;
  let state = { hp: { ...context.maxHP }, ap: { P1: 0, P2: 0 }, status: { P1: {}, P2: {} } };
  const closeCurrent = nextState => {
    if (!current) return;
    if (nextState) current.stateAfter = cloneState(nextState);
    blocks.push(current);
    current = null;
  };
  const addLines = (event, lines) => {
    if (!lines.length) return;
    const target = current ?? blocks.at(-1);
    if (target) target.lines.push(...decorateSkillLines(event, lines));
  };

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== "object") continue;

    if (event.type === "battleStart") {
      const field = event.meta?.field;
      blocks.push({
        side: "system", turn: 0, phase: 0, headerText: "🐤 BATTLE START 🐤",
        lines: [
          ...(field ? [{ kind: "note", text: `⚠フィールド効果：${escapeHTML(field.name ?? field.id)}発動中！⚠` }] : []),
          { kind: "note", text: `先攻：${escapeHTML(event.meta?.first ?? "-")}` },
        ],
        stateAfter: cloneState(state),
      });
      continue;
    }

    if (event.type === "turnStart") {
      const next = cloneState(event.state ?? state);
      if (current) {
        const prior = cloneState(next);
        const apPlus = numberOr(event.apPlus, 0);
        prior.ap.P1 -= apPlus;
        prior.ap.P2 -= apPlus;
        closeCurrent(prior);
      }
      state = next;
      blocks.push(makeTurnBlock(event, state, context));
      continue;
    }

    if (event.type === "phaseStart") {
      const next = cloneState(event.state ?? state);
      closeCurrent(next);
      state = next;
      current = {
        side: event.actor === "P2" ? "P2" : "P1",
        turn: event.turn,
        phase: event.phase,
        headerText: `${escapeHTML(context.names[event.actor]?.battler ?? event.actor)} × ${escapeHTML(context.names[event.actor]?.duck ?? "")}の攻撃！`,
        lines: [],
        stateAfter: cloneState(state),
      };
      continue;
    }

    if (event.type === "battleEnd") {
      state = cloneState(event.state ?? state);
      closeCurrent(state);
      blocks.push(makeResultBlock(event, result, state, context));
      continue;
    }

    applyEventToState(state, event);
    addLines(event, eventToLines(event, context));
    if (current) current.stateAfter = cloneState(state);
  }
  closeCurrent(state);
  return blocks;
}

function makeTurnBlock(event, state, context) {
  const panel = side => {
    const hp = state.hp[side];
    const max = context.maxHP[side];
    const pct = max > 0 ? Math.max(0, Math.min(100, Math.round(hp / max * 100))) : 0;
    return `<div class="miniPanel"><span class="miniTag ${side.toLowerCase()}">${side === "P1" ? "1P" : "2P"}</span>`
      + `<span>HP ${escapeHTML(hp)}/${escapeHTML(max)}</span><div class="hpBar"><div class="hpFill ${side.toLowerCase()}" style="width:${pct}%"></div></div>`
      + `<span>AP ${escapeHTML(state.ap[side])}</span></div>`;
  };
  const status = side => {
    const entries = Object.entries(state.status?.[side] ?? {}).filter(([, value]) => Number(value) > 0);
    return `<div class="statusLine">${entries.length ? entries.map(([key, value]) => `${escapeHTML(statusName(key))}${escapeHTML(value)}`).join("　") : "状態変化なし"}</div>`;
  };
  return {
    side: "system", turn: event.turn, phase: 0, headerText: "🌊 NEXT TURN 🌊",
    lines: [{ kind: "soft", text: `<div class="turnTitle">TURN ${escapeHTML(event.turn)}</div><div class="turnRow">${panel("P1")}${panel("P2")}${status("P1")}${status("P2")}</div>` }],
    stateAfter: cloneState(state),
  };
}

function makeResultBlock(event, fallbackResult, state, context) {
  const outcome = event.result ?? fallbackResult;
  let text;
  if (outcome === "draw") text = `<div class="victoryWrap"><div class="victoryTop">DRAW</div><div class="victoryMain">引き分け……</div></div>`;
  else {
    const side = outcome === "P2_win" ? "P2" : "P1";
    text = `<div class="victoryWrap"><div class="victoryTop">🏆 WINNER 🏆</div><div class="victoryMain">${escapeHTML(context.names[side].battler)}</div><div class="victoryMain">${escapeHTML(context.names[side].duck)}</div></div>`;
  }
  return { side: "system", turn: event.turn, phase: event.phase, headerText: "🐣 BATTLE FINISH 🐣", lines: [{ kind: "victoryLine", text }], stateAfter: cloneState(state) };
}

function eventToLines(event, context) {
  const duck = side => escapeHTML(context.names[side]?.duck ?? side ?? "-");
  const target = duck(event.target);
  const actor = duck(event.actor);
  const amount = (kind, value) => `<span class="num ${kind}">${escapeHTML(value ?? 0)}</span>`;
  const hint = (before, after, label = "") => Number.isFinite(Number(before)) && Number.isFinite(Number(after))
    ? ` <span class="miniHint">（${escapeHTML(label)}${escapeHTML(before)}→${escapeHTML(after)}）</span>` : "";

  switch (event.type) {
    case "skillTriggered": {
      const category = String(event.skill?.category ?? "");
      const label = { A: "アヒルスキル", B: "バトラースキル", C: "チャージスキル", D: "ダイススキル" }[category] ?? "スキル";
      const owner = category === "B" || category === "D" ? context.names[event.actor]?.battler : context.names[event.actor]?.duck;
      return [{ kind: `note ${event.actor?.toLowerCase() ?? ""}`, text: `${escapeHTML(owner ?? actor)}の${label}！${event.skill?.skillName ? `<br>${escapeHTML(event.skill.skillName)}` : ""}` }];
    }
    case "cSkillActivated":
      return [{ kind: "note", text: `APチャージ完了！<br>${actor}のチャージスキル！${event.skill?.skillName ? `<br>${escapeHTML(event.skill.skillName)}` : ""}` }];
    case "timedRuleTriggered": return [{ kind: "note", text: `${actor}の持続スキル効果！` }];
    case "roll": {
      const summaries = { 1: "自分のAP+1", 2: "通常攻撃2回", 3: "自分のHP3回復", 4: "自分に反撃+1", 5: "相手のAP-1", 6: "DF無視攻撃＋反動3ダメージ" };
      return [{ kind: "soft rollLine", text: `<span class="logDuckIcon" aria-hidden="true">🦆</span><span><span class="rollMain">ダイス結果 → ${amount("buff", event.diceValue)}！</span><br><span class="rollSub">${summaries[event.diceValue] ?? "特殊効果なし"}</span></span>` }];
    }
    case "normalDamage": return [{ kind: "soft", text: `${target}に ${amount("damage", event.value)} ダメージ！` }];
    case "fixedDamage": return [{ kind: "soft", text: `${target}に固定 ${amount("damage", event.value)} ダメージ！` }];
    case "recoil": return [{ kind: "soft", text: `${target}は反動で ${amount("damage", event.value)} ダメージ！` }];
    case "counterDamage": return [{ kind: "soft", text: `${target}に🛡️反撃で ${amount("damage", event.value)} ダメージ！${hint(event.counterBefore, event.counterAfter, "反撃 ")}` }];
    case "heal": return event.value ? [{ kind: "soft", text: `${target}のHPが ${amount("heal", event.value)} 回復！` }] : [];
    case "valueChanged": {
      const delta = Number(event.delta ?? Number(event.after) - Number(event.before));
      if (!Number.isFinite(delta) || delta === 0) return [];
      if (event.key === "ap") return [{ kind: "soft", text: `${target}のAPが ${amount(delta > 0 ? "buff" : "debuff", `${delta > 0 ? "+" : ""}${delta}`)}！` }];
      if (event.key === "hp") return [{ kind: "soft", text: `${target}のHPが ${amount(delta > 0 ? "heal" : "damage", Math.abs(delta))} ${delta > 0 ? "回復" : "減少"}！` }];
      return [{ kind: "meta", text: `${target}の${escapeHTML(event.tag ?? event.key)}が${delta > 0 ? "+" : ""}${escapeHTML(delta)}変化` }];
    }
    case "statusChange": {
      const before = Number(event.before ?? 0), after = Number(event.after ?? 0), delta = after - before;
      if (delta > 0) return [{ kind: "soft", text: `${target}に${escapeHTML(statusName(event.status))}を ${amount("buff", delta)} 付与！${hint(before, after)}` }];
      if (delta < 0) return [{ kind: "soft", text: `${target}の${escapeHTML(statusName(event.status))}を ${amount("debuff", Math.abs(delta))} 解除！${hint(before, after)}` }];
      return [];
    }
    case "statusEffect": return [{ kind: "note status", text: `${target}の${escapeHTML(statusName(event.status ?? event.statusKey))}の効果！` }];
    case "attackMissed": return [{ kind: "soft", text: `<i>${actor}は攻撃を外した！</i>` }];
    case "attackAvoided": return [{ kind: "soft", text: `<i>${target}は攻撃を回避した！</i>` }];
    case "counterTriggered": return [{ kind: "note status", text: `${actor}の🛡️反撃！` }];
    case "actionCanceled": return [{ kind: "soft", text: `<i>${target}は行動できない！</i>` }];
    case "fieldTriggered": return [{ kind: "note", text: `🛁${escapeHTML(event.field?.name ?? "フィールド")}のフィールド効果！` }];
    case "buffApplied": return [{ kind: "soft", text: `${target}に${escapeHTML(event.stat)}${Number(event.amount) > 0 ? "+" : ""}${escapeHTML(event.amount)}の効果を付与！` }];
    case "buffTick": return [{ kind: "meta", text: `${target}のターン効果（${escapeHTML(event.stat)}${Number(event.amount) > 0 ? "+" : ""}${escapeHTML(event.amount)}／残り${escapeHTML(event.after)}T）` }];
    case "buffExpired": return [{ kind: "meta", text: `${target}のターン効果が終了（${escapeHTML(event.stat ?? "")}${Number(event.amount) > 0 ? "+" : ""}${escapeHTML(event.amount ?? "")}）` }];
    case "chanceRoll": return [{ kind: "meta", text: `確率判定 ${event.success ? "成功" : "失敗"}！（${Math.round(Number(event.probability ?? 0) * 100)}%）` }];
    case "diceAdded": return [{ kind: "soft", text: `${target}にダイス追加：${escapeHTML((event.values ?? []).join("、"))}` }];
    case "revived": return [{ kind: "note", text: `${target}がHP ${amount("heal", event.hpAfter)}で復活した！` }];
    case "headwindResult": case "roughWaveResult": case "steamResult":
      return [{ kind: "meta", text: `${target}の${escapeHTML(statusName(event.status ?? event.type.replace("Result", "")))}判定：${event.success ? "成功" : "失敗"}` }];
    case "phaseBonus": return [{ kind: "meta", text: "初回行動ボーナス！出目威力×2！" }];
    case "passiveSkillStateChanged": {
      const values = [event.bonus?.AT && `AT${event.bonus.AT > 0 ? "+" : ""}${event.bonus.AT}`, event.bonus?.DF && `DF${event.bonus.DF > 0 ? "+" : ""}${event.bonus.DF}`].filter(Boolean).join(" ");
      return [{ kind: `note ${event.actor?.toLowerCase() ?? ""}`, text: `${actor}の常時スキル！${values ? `<br>${escapeHTML(values)}` : ""}` }];
    }
    case "passiveModifierChanged": return [{ kind: "meta", text: `${actor}の常時効果が変化` }];
    default: return [];
  }
}

function decorateSkillLines(event, lines) {
  return event.groupId == null ? lines : lines.map(line => ({ ...line, kind: `${line.kind ?? ""} skill`.trim() }));
}

function applyEventToState(state, event) {
  if (event.state) Object.assign(state, cloneState(event.state));
  const side = event.target;
  if (["normalDamage", "fixedDamage", "counterDamage", "recoil", "heal", "revived"].includes(event.type)
    && (side === "P1" || side === "P2") && Number.isFinite(Number(event.hpAfter))) state.hp[side] = Number(event.hpAfter);
  if (event.type === "valueChanged" && (side === "P1" || side === "P2")) {
    if (event.key === "hp" && Number.isFinite(Number(event.after))) state.hp[side] = Number(event.after);
    if (event.key === "ap" && Number.isFinite(Number(event.after))) state.ap[side] = Number(event.after);
  }
  if (event.type === "cSkillActivated" && (event.actor === "P1" || event.actor === "P2") && Number.isFinite(Number(event.apAfter))) state.ap[event.actor] = Number(event.apAfter);
  if (event.type === "statusChange" && (side === "P1" || side === "P2") && event.status) state.status[side][event.status] = Number(event.after ?? 0);
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

function cloneState(state) {
  return {
    hp: { P1: numberOr(state?.hp?.P1, 0), P2: numberOr(state?.hp?.P2, 0) },
    ap: { P1: numberOr(state?.ap?.P1, 0), P2: numberOr(state?.ap?.P2, 0) },
    status: { P1: { ...(state?.status?.P1 ?? {}) }, P2: { ...(state?.status?.P2 ?? {}) } },
  };
}

function statusName(key) {
  return ({ crack: "⚡亀裂", Headwind: "🌪️逆風", headwind: "🌪️逆風", roughWave: "🌊荒波", tailwind: "💨追風", focus: "🎯集中", counter: "🛡️反撃", clean: "🧼清潔", steam: "🌫️湯気" })[key] ?? String(key ?? "状態");
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function escapeHTML(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
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
