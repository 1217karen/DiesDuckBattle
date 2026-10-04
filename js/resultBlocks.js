import { validSkillLabel } from "./skillLabels.js";
import { FIXED_IMAGES } from "./fixedImages.js";
import { createQuotePresenter, snapshotIconHTML, makeCSkillCutinLines } from "./resultPresentation.js";

export function buildBlocks(events, result, context) {
  const blocks = [];
  const quoteLines = createQuotePresenter(context.presentations, context.maxHP);
  let current = null;
  let firstPhaseStarted = false;
  let deferredPassives = [];
  let tail = null;
  let atTurnTail = false;
  let field = context.start?.meta?.field;
  const groups = new WeakMap();
  const spacer = block => {
    if (block.lines.at(-1)?.kind !== "spacer") block.lines.push({ kind: "spacer", text: "" });
  };
  const finishGroup = block => {
    if (block && groups.get(block) != null) spacer(block);
    if (block) groups.delete(block);
  };
  let state = { hp: { ...context.maxHP }, ap: { P1: 0, P2: 0 }, status: { P1: {}, P2: {} } };
  const closeCurrent = nextState => {
    if (!current) return;
    if (nextState) current.stateAfter = cloneState(nextState);
    finishGroup(current);
    blocks.push(current);
    current = null;
  };
  const addLines = (event, lines, target = current ?? blocks.at(-1)) => {
    if (!lines.length) return;
    if (!target) return;
    const group = logGroup(event);
    if (groups.get(target) != null && groups.get(target) !== group) finishGroup(target);
    if (event.type === "roll") spacer(target);
    target.lines.push(...(group == null ? lines : lines.map(line => ({ ...line, kind: line.kind.startsWith("c-cutin") ? line.kind : `${line.kind} skill` }))));
    groups.set(target, group);
  };
  const flushTail = event => {
    if (!tail) return;
    finishGroup(tail);
    tail.stateAfter = cloneState(state);
    tail.turn = event?.turn ?? tail.turn;
    tail.phase = event?.phase ?? tail.phase;
    blocks.push(tail);
    tail = null;
  };
  const render = event => {
    const lines = eventToLines(event, context).map(line => isDiceEvent(event)
      ? { ...line, text: `🎲 ${line.text}` } : line);
    return [...lines, ...quoteLines(event), ...makeCSkillCutinLines(event, context.presentations)];
  };

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== "object") continue;

    if (event.type === "battleStart") {
      field = event.meta?.field;
      blocks.push({
        side: "system", turn: 0, phase: 0, headerText: "🐤 BATTLE START 🐤",
        lines: [
          ...(field ? [{ kind: "note", text: `⚠フィールド効果：${escapeHTML(field.name ?? field.id)}発動中！⚠` }] : []),
          ...(FIELD_DESCRIPTIONS[field?.id] ? [{ kind: "meta", text: FIELD_DESCRIPTIONS[field.id] }] : []),
          { kind: "note", text: `先攻：${escapeHTML(event.meta?.first ?? "-")}` },
          ...quoteLines(event),
        ],
        stateAfter: cloneState(state),
      });
      continue;
    }

    if (event.type === "turnStart") {
      const next = cloneState(event.state ?? state);
      const prior = cloneState(next);
      const apPlus = numberOr(event.apPlus, 0);
      prior.ap.P1 -= apPlus;
      prior.ap.P2 -= apPlus;
      if (current) {
        closeCurrent(prior);
      } else if (!tail && blocks.at(-1)?.phase > 0) {
        blocks.at(-1).stateAfter = prior;
      }
      flushTail();
      finishGroup(blocks.at(-1));
      atTurnTail = false;
      state = next;
      const block = makeTurnBlock(event, state, context);
      const fieldId = event.field ?? field?.id;
      if ((fieldId === "electricBath" && event.apPlus === 2) || fieldId === "iceBath") {
        addLines({ type: "fieldTriggered" }, [
          { kind: "note", text: `🛁${fieldId === "iceBath" ? "氷風呂" : "電気風呂"}のフィールド効果！` },
          { kind: "soft", text: fieldId === "iceBath" ? "通常攻撃のダメージが 2倍！" : "ターン開始時のAP増加量が +2！" },
        ], block);
        finishGroup(block);
      }
      block.lines.push(...quoteLines({ ...event, state }));
      blocks.push(block);
      continue;
    }

    if (event.type === "phaseStart") {
      const next = cloneState(event.state ?? state);
      closeCurrent(next);
      finishGroup(blocks.at(-1));
      state = next;
      current = {
        side: event.actor === "P2" ? "P2" : "P1",
        turn: event.turn,
        phase: event.phase,
        headerText: `${escapeHTML(context.names[event.actor]?.battler ?? event.actor)} × ${escapeHTML(context.names[event.actor]?.duck ?? "")}の攻撃！`,
        lines: [],
        stateAfter: cloneState(state),
      };
      if (!firstPhaseStarted) {
        firstPhaseStarted = true;
        for (const passive of deferredPassives) addLines(passive, render(passive));
        deferredPassives = [];
        finishGroup(current);
      }
      current.lines.push(...quoteLines(event));
      continue;
    }

    if (event.type === "turnEnd") {
      closeCurrent();
      applyEventToState(state, event);
      flushTail(event);
      atTurnTail = false;
      continue;
    }

    if (event.type === "battleEnd") {
      closeCurrent(event.state ?? state);
      state = cloneState(event.state ?? state);
      if (!tail && blocks.at(-1)) blocks.at(-1).stateAfter = cloneState(state);
      flushTail(event);
      for (const passive of deferredPassives) addLines(passive, render(passive));
      deferredPassives = [];
      finishGroup(blocks.at(-1));
      const block = makeResultBlock(event, result, state, context);
      block.lines.unshift(...quoteLines({ ...event, result: event.result ?? result }));
      blocks.push(block);
      continue;
    }

    // Placement changes only display order. State always follows engine event order.
    if ((["beforeTurnEnd", "turnEnd"].includes(event.trigger)
      && ["cSkillActivated", "skillTriggered"].includes(event.type))
      || (event.type === "cSkillActivated" && event.mode === "special")) {
      closeCurrent();
      atTurnTail = true;
    }
    applyEventToState(state, event);
    if (!firstPhaseStarted && ["passiveSkillStateChanged", "passiveModifierChanged", "passiveBonusTotalChanged"].includes(event.type)) {
      deferredPassives.push(event);
      continue;
    }
    const lines = render(event);
    if (atTurnTail || event.type === "buffTick" || event.type === "buffExpired") {
      if (lines.length) {
        tail ??= { side: "system", turn: event.turn, phase: event.phase, headerText: "", lines: [], stateAfter: cloneState(state) };
        addLines(event, lines, tail);
      }
    } else {
      addLines(event, lines);
      if (current) current.stateAfter = cloneState(state);
    }
  }
  closeCurrent(state);
  flushTail();
  for (const passive of deferredPassives) addLines(passive, render(passive));
  finishGroup(blocks.at(-1));
  return blocks;
}

const FIELD_DESCRIPTIONS = {
  hotBath: "フェイズ開始時、固定1～5ダメージ！", foamBath: "フェイズ開始時、HPが1～5回復！",
  iceBath: "通常攻撃のダメージが常に×2！", electricBath: "ターン開始時のAP増加量が2に変化！",
};

function logGroup(event) {
  if (event.groupId != null) return `skill:${event.groupId}`;
  if (event.type === "fieldTriggered" || String(event.source ?? "").startsWith("field:")) return "field";
  if (["skillTriggered", "cSkillActivated", "passiveSkillStateChanged", "passiveModifierChanged"].includes(event.type)) return event;
  return null;
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
  const heading = status => ({ kind: "note status", text: `${target}の${escapeHTML(statusName(status))}！` });

  // Current engine codes identify status-specific effects; never infer from text.
  switch (event.code) {
    case "STATUS_CONSUMED_ON_TRIGGER": return []; // Stock is shown by the corresponding result event.
    case "STATUS_CRACK_DAMAGE": return [heading("crack")]; // Damage comes from statusDamage.
    case "STATUS_CLEAN_CONSUMED": return [heading("clean"), { kind: "soft",
      text: `${target}は清潔で異常付与を防いだ！ <span class="miniHint">（${escapeHTML(statusName(event.blockedStatus))} -${escapeHTML(event.blockedAmount)}）</span>${hint(event.before, event.after, "清潔 ")}` }];
    case "STATUS_FOCUS_CONSUMED": return [heading("focus"), { kind: "soft",
      text: `${target}は集中して攻撃力を${formatMul(event.mul)}にした！${hint(event.before, event.after, "集中 ")}` }];
    case "ATTACK_DAMAGE_MUL_FOCUS": return [];
    case "ACTION_CANCELED_ROUGH_WAVE": return [{ kind: "soft", text: `<i>${target}は荒波のせいで行動できない！</i>` }];
    case "ACTION_CANCELED_HEADWIND": return [{ kind: "soft", text: `<i>${target}は逆風に煽られてスキルを発動できない！</i>` }];
    case "ATTACK_MISSED_BY_EFFECT": return [{ kind: "soft", text: `<i>${actor}は攻撃できない！</i>` }];
    case "ATTACK_AVOIDED_BY_TAILWIND": return [heading("tailwind"), { kind: "soft",
      text: `${target}は💨追風で攻撃を回避した！${hint(event.tailwindBefore, event.tailwindAfter, "追風 ")}` }];
    case "NEXT_ATTACK_ATPLUS_CONSUMED": return [{ kind: "meta", text: `${actor}は AT${signed(event.value)} を消費した！` }];
  }

  switch (event.type) {
    case "skillTriggered": {
      const category = String(event.skill?.category ?? "");
      const label = { A: "アヒルスキル", B: "バトラースキル", C: "チャージスキル", D: "ダイススキル" }[category] ?? "スキル";
      const owner = category === "B" || category === "D" ? context.names[event.actor]?.battler : context.names[event.actor]?.duck;
      return [{ kind: `note ${event.actor?.toLowerCase() ?? ""}`, text: `${escapeHTML(owner ?? actor)}の${label}！${renderSkillDisplayName(event.skill?.skillName, event.skill?.skillRuby)}` }];
    }
    case "cSkillActivated":
      return [{ kind: "note", text: `APチャージ完了！<br>${actor}のチャージスキル！${renderSkillDisplayName(event.skill?.skillName, event.skill?.skillRuby)}` }];
    case "timedRuleTriggered": return [{ kind: "note", text: `${actor}の持続スキル効果！` }];
    case "roll": {
      const summaries = { 1: "自分のAP+1", 2: "通常攻撃2回", 3: "自分のHP3回復", 4: "自分に反撃+1", 5: "相手のAP-1", 6: "DF無視攻撃＋反動3ダメージ" };
      const icon = snapshotIconHTML(context.presentations?.[event.actor]?.duckIconUrl, "logDuckIcon", FIXED_IMAGES.duckIcon);
      return [{ kind: "soft rollLine", text: `${icon}<span><span class="rollMain">ダイス結果 → ${amount("buff", event.diceValue)}！</span><br><span class="rollSub">${summaries[event.diceValue] ?? "特殊効果なし"}</span></span>` }];
    }
    case "normalDamage":
      return [{ kind: "soft", text: `${target}に ${amount("damage", event.value)} ダメージ！` }];

    case "fixedDamage":
      return [{ kind: "soft", text: `${target}に固定 ${amount("damage", event.value)} ダメージ！` }];

    case "statusDamage":
      return [{
        kind: "soft",
        text: `${target}は${escapeHTML(statusName(event.status))}の効果で ${amount("damage", event.value)} ダメージ！`
      }];

    case "recoil":
      return [{ kind: "soft", text: `${target}は反動で ${amount("damage", event.value)} ダメージ！` }];
    case "counterDamage": return [{ kind: "soft", text: `${target}に🛡️反撃で ${amount("damage", event.value)} ダメージを返した！${hint(event.counterBefore, event.counterAfter, "反撃 ")}` }];
    case "heal": return [{ kind: "soft", text: `${target}のHPが ${amount("heal", event.value)} 回復！` }];
    case "attackChanged": {
      const text = { miss: "攻撃は失敗した！", mulDamage: `ダメージ倍率 ${formatMul(event.value)}！`,
        addDamage: `ダメージが変化（${escapeHTML(event.value ?? "")}）`,
        setDamage: `ダメージが固定化（${escapeHTML(event.value ?? "")}）` }[event.op] ?? "攻撃内容が変化！";
      return [{ kind: "meta", text }];
    }
    case "valueChanged": {
      if (event.key === "attackTimesOverride") {
        if (event.before === event.after) return [];
        return [{ kind: "soft", text: `${target}の攻撃回数が ${escapeHTML(event.before === null ? "通常" : event.before)} → ${escapeHTML(event.after === null ? "通常" : event.after)} に変更！` }];
      }
      const delta = Number(event.delta ?? Number(event.after) - Number(event.before));
      if (!Number.isFinite(delta) || delta === 0) return [];
      if (event.key === "ap") return [{ kind: "soft", text: `${target}のAPが ${amount(delta > 0 ? "buff" : "debuff", `${delta > 0 ? "+" : ""}${delta}`)}！` }];
      if (event.key === "hp") return [{ kind: "soft", text: `${target}のHPが ${amount(delta > 0 ? "heal" : "damage", Math.abs(delta))} ${delta > 0 ? "回復" : "減少"}！` }];
      const label = { tempDfPlus: "DFがターン中", nextAttackATPlus: "次の攻撃にAT", attackTimesAdd: "攻撃回数が" }[event.key];
      if (label) return [{ kind: "soft", text: `${target}の${label} ${signed(delta)}！` }];
      if (event.key === "recoilMinus") return [{ kind: "soft", text: `${target}の反動ダメージが ${amount(delta < 0 ? "damage" : "buff", signed(-delta))}！` }];
      return [{ kind: "meta", text: `${target}の${escapeHTML(event.tag ?? event.key)}が${delta > 0 ? "+" : ""}${escapeHTML(delta)}変化` }];
    }
    case "statusChange": {
      const before = Number(event.before ?? 0), after = Number(event.after ?? 0), delta = after - before;
      const kind = event.code === "STATUS_DECAY" ? "meta" : "soft";
      if (delta > 0) return [{ kind, text: `${target}に${escapeHTML(statusName(event.status))}を ${amount("buff", delta)} 付与！${hint(before, after)}` }];
      if (delta < 0) return [{ kind, text: `${target}の${escapeHTML(statusName(event.status))}を ${amount("debuff", Math.abs(delta))} 解除！${hint(before, after)}` }];
      return [{ kind, text: `${target}の${escapeHTML(statusName(event.status))}は変化しなかった……${hint(before, after)}` }];
    }
    case "randomStatusGrantFailed": {
      const label = { buff: "強化", debuff: "異常" }[event.group];
      return label ? [{ kind: "soft", text: `${target}に${label}の付与を失敗した……` }] : [];
    }
    case "statusEffect": return [{ kind: "note status", text: `${target}の${escapeHTML(statusName(event.status ?? event.statusKey))}の効果！` }];
    case "attackMissed": return [{ kind: "soft", text: `<i>${actor}は攻撃を外した！</i>` }];
    case "attackAvoided": return [{ kind: "soft", text: `<i>${target}は攻撃を回避した！</i>` }];
    case "counterTriggered": return [{ kind: "note status", text: `${actor}の🛡️反撃！` }];
    case "actionCanceled": return [{ kind: "soft", text: `<i>${target}は行動できない！</i>` }];
    case "fieldTriggered": return [{ kind: "note", text: `🛁${escapeHTML(event.field?.name ?? "フィールド")}のフィールド効果！` }];
    case "buffApplied": {
      const duration = event.duration?.kind === "phase" ? "この行動中" : `${escapeHTML(event.duration?.remainingTurns ?? event.turns)}T`;
      return [{ kind: "soft", text: `${target}に${event.duration?.kind === "phase" ? "行動中" : "ターン"}効果（${escapeHTML(event.stat)}${signed(event.amount)} / ${duration}）を追加！` }];
    }
    case "buffTick": return [{ kind: "meta center", text: `${target}のターン効果（${escapeHTML(event.stat)}${signed(event.amount)}／残り${escapeHTML(event.after)}T）` }];
    case "buffExpired": return [{ kind: "meta", text: `${target}の${event.duration?.kind === "phase" ? "行動中" : "ターン"}効果が終了（${escapeHTML(event.stat ?? "")}${signed(event.amount ?? 0)}）` }];
    case "chanceRoll": return [{ kind: "meta", text: `確率判定 ${event.success ? "成功" : "失敗"}！（${Math.round(Number(event.probability ?? 0) * 100)}%）` }];
    case "diceAdded": return [{ kind: "soft", text: `${target}にダイス追加：${escapeHTML((event.values ?? []).join("、"))}` }];
    case "revived": return [{ kind: "note", text: `${target}がHP ${amount("heal", event.hpAfter)}で復活した！` }];
    case "headwindResult": case "roughWaveResult": case "steamResult": {
      const [status, label, message] = {
        headwindResult: ["Headwind", "逆風", `${target}に逆風が吹き荒れる…… ${event.success ? "耐えきれなかった" : "耐えた"}！`],
        roughWaveResult: ["roughWave", "荒波", `${target}に荒波が襲いかかる…… ${event.success ? "命中" : "回避"}！`],
        steamResult: ["steam", "湯気", `${target}は湯気に包まれている…… ${event.success ? "脱出失敗" : "脱出"}！`],
      }[event.type];
      return [heading(status), { kind: "meta", text: message + hint(event.stacks, event.after ?? 0, `${label} `) }];
    }
    case "phaseBonus": return [{ kind: "meta", text: "初回行動ボーナス！出目威力×2！" }];
    case "passiveSkillStateChanged": {
      const values = [event.bonus?.AT && `AT${event.bonus.AT > 0 ? "+" : ""}${event.bonus.AT}`, event.bonus?.DF && `DF${event.bonus.DF > 0 ? "+" : ""}${event.bonus.DF}`].filter(Boolean).join(" ");
      const owner = escapeHTML(context.names[event.actor]?.battler ?? event.actor ?? "-");
      const hpHint = Number.isFinite(event.hpPct) ? ` <span class="miniHint">（現HP${Math.round(event.hpPct * 100)}%）</span>` : "";
      if (event.active === false) return [{ kind: "meta", text: `${actor}の${escapeHTML(values || "効果なし")}が解除された！${hpHint}` }];
      return [{ kind: `note ${event.actor?.toLowerCase() ?? ""}`, text: `${owner}のバトラースキル！${renderSkillDisplayName(event.skill?.skillName, event.skill?.skillRuby)}` },
        { kind: "soft", text: `${actor}の${escapeHTML(values || "効果なし")}！${hpHint}` }];
    }
    case "passiveModifierChanged": {
      const customName = renderSkillDisplayName(event.skill?.skillName, event.skill?.skillRuby);
      const owner = escapeHTML(context.names[event.actor]?.battler ?? event.actor ?? "-");
      return [...(customName ? [{ kind: `note ${event.actor?.toLowerCase() ?? ""}`, text: `${owner}のバトラースキル！${customName}` }] : []),
        { kind: "meta", text: `${actor}の常時効果が変化` }];
    }
    case "note": return event.code ? [{ kind: "meta", text: event.code === "EFFECT_TYPE_UNSUPPORTED"
      ? `未対応effect.type: ${escapeHTML(event.effectType ?? "")}` : escapeHTML(event.code) }] : [];
    default: return [];
  }
}

function isDiceEvent(event) {
  return event.type === "roll" || event.type === "normalDamage"
    || (event.type === "valueChanged" && event.key === "ap" && ["dice1", "dice5"].includes(event.source))
    || (event.type === "heal" && event.source === "dice3")
    || (event.type === "statusChange" && event.source === "dice4")
    || (event.type === "recoil" && event.source === "dice6");
}

function signed(value) {
  return `${Number(value) > 0 ? "+" : ""}${escapeHTML(value)}`;
}

function formatMul(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `×${Number(number.toFixed(2))}` : "×?";
}

function applyEventToState(state, event) {
  if (event.state) Object.assign(state, cloneState(event.state));
  const side = event.target;
if (["normalDamage", "fixedDamage", "statusDamage", "counterDamage", "recoil", "heal", "revived"].includes(event.type)
  && (side === "P1" || side === "P2") && Number.isFinite(Number(event.hpAfter))) {
  state.hp[side] = Number(event.hpAfter);
}
  if (event.type === "valueChanged" && (side === "P1" || side === "P2")) {
    if (event.key === "hp" && Number.isFinite(Number(event.after))) state.hp[side] = Number(event.after);
    if (event.key === "ap" && Number.isFinite(Number(event.after))) state.ap[side] = Number(event.after);
  }
  if (event.type === "cSkillActivated" && (event.actor === "P1" || event.actor === "P2") && Number.isFinite(Number(event.apAfter))) state.ap[event.actor] = Number(event.apAfter);
  if (event.type === "statusChange" && (side === "P1" || side === "P2") && event.status) state.status[side][event.status] = Number(event.after ?? 0);
  if (event.type === "attackAvoided" && event.code === "ATTACK_AVOIDED_BY_TAILWIND" && state.status[side]) state.status[side].tailwind = Number(event.tailwindAfter ?? 0);
  if (event.type === "counterDamage" && state.status[event.actor] && Number.isFinite(event.counterAfter)) state.status[event.actor].counter = event.counterAfter;
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

export function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function escapeHTML(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// Plain structured labels only. Ruby markup is created here, never stored.
export function renderSkillDisplayName(name, ruby = "") {
  if (!name || !validSkillLabel({ name, ruby })) return "";
  const text = ruby ? `<ruby>${escapeHTML(name)}<rt>${escapeHTML(ruby)}</rt></ruby>` : escapeHTML(name);
  return `<br><span class="skill-display-name">${text}</span>`;
}
