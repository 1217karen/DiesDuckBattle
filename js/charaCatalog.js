// charaCatalog.js
import { BATTLERS, DUCKS } from "./data.js?v=20260224";
// トレイに通常表示しないID
const HIDDEN_IN_TRAY = new Set([
  "B06-2",
  "B14-2",
  "B25-2",
  "B26-2",
]);

import { calcMaxHPFromStats } from "./statsUtil.js";

// トレイ表示用：id / name / icon（バトラーはneutral、アヒルはicon）
export function listForTray(kind) {
  if (kind === "battler") {
    return BATTLERS
      .filter(b => !HIDDEN_IN_TRAY.has(b.id))
      .map(b => ({
        kind: "battler",
        id: b.id,
        name: b.name,
        icon: b.icons?.neutral ?? null,
      }));
  }
  if (kind === "duck") {
    return DUCKS.map(d => ({
      kind: "duck",
      id: d.id,
      name: d.name,
      icon: d.icons?.icon ?? null,
    }));
  }
  return [];
}

export function getById(kind, id) {
  if (!id) return null;

  switch (kind) {
    case "battler":
      return BATTLERS.find(b => b.id === id) ?? null;
    case "duck":
      return DUCKS.find(d => d.id === id) ?? null;
    default:
      console.warn("[getById] unknown kind:", kind);
      return null;
  }
}


// 表示用テキスト
export function formatBattlerInfo(b) {
  if (!b) return "---";

  const lines = [];

  // 名前を一番上に
  lines.push(`【${b.name}】`);

  if (b.dSkill) {
    lines.push(
      `Ｄ：${b.dSkill.description}`
    );
  }

  if (b.bSkill) {
    lines.push(
      `Ｂ：${b.bSkill.description}`
    );
  }

  return lines.join("\n");
}

function getDisplayMaxHP(stats) {
  const manual = Number(stats?.maxHP ?? 0);

  // 手動HPが設定されている場合は優先
  if (manual > 0) return Math.trunc(manual);

  // なければ計算
  return calcMaxHPFromStats(stats);
}

export function formatDuckInfo(d) {
  if (!d) return "---";

  const lines = [];

  // 名前を一番上に
  lines.push(`【${d.name}】`);

  if (d.stats) {
    lines.push(
      `◆HP ${getDisplayMaxHP(d.stats)}   ◆SP ${d.stats.SP}\n◆AT ${d.stats.AT} 　  ◆DF ${d.stats.DF}`
    );
  }


  if (Array.isArray(d.dice)) {
    lines.push(
      `🎲：[${d.dice.join(",")}]`
    );
  }

  if (d.aSkill) {
    lines.push(
      `Ａ：${d.aSkill.description}`
    );
  }

  if (d.cSkill) {
    const cost = d.cSkill.costAP != null ? `（AP${d.cSkill.costAP}）` : "";
    lines.push(
      `Ｃ：${d.cSkill.description}${cost}`
    );
  }

  return lines.join("\n");
}


