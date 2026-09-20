import { createBuildRules } from "./buildRules.js";
import { getDiceFrame } from "./diceFrames.js";
import { calculateBuildResources } from "./buildResources.js";
import { createSkillCatalog, getCatalogChoice } from "./skillCatalog.js";

const CATEGORIES = ["A", "B", "C", "D"];
const STATS = ["AT", "DF"];
const isRecord = value => value !== null && typeof value === "object"
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * ユーザー作成DTO v1（戦闘用データではない）:
 * { schemaVersion: 1, diceFrame: "light"|"basic"|"heavy", stats: { AT, DF }, dice: number[6],
 *   skills: [{ category: "A"|"B"|"C"|"D", triggerId: string, effectIds: string[] }] }
 * 未知キー・生effect・コスト申告は拒否。入力の補正/変更/コンパイルは行わない。
 * rules/catalogは運営側の信頼済み設定であり、ユーザーから受け取らない。
 * valid: 確定済み検査に違反なし。complete: 未確定検査なし。
 * ready: valid && complete。将来の登録/コンパイルではreadyを必須にする。
 */
export function validateBuild(build, {
  rules = createBuildRules(), catalog = createSkillCatalog(),
} = {}) {
  const errors = [];
  const pending = [];
  const resources = calculateBuildResources(build, rules);
  const issue = (code, path, message) => errors.push({ code, path, message });
  const unresolved = path => {
    if (!pending.some(item => item.path === path)) {
      pending.push({ code: "RULE_UNRESOLVED", path, message: "作成ルールが未確定です。" });
    }
  };
  const result = () => ({
    valid: errors.length === 0, complete: pending.length === 0,
    ready: errors.length === 0 && pending.length === 0, errors, pending, resources,
  });
  const keys = (value, allowed, path) => {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) issue("UNKNOWN_FIELD", `${path}.${key}`, "未対応の項目です。");
    }
  };
  const bound = (value, limit, path, upper = true) => {
    if (limit == null) { unresolved(path); return; }
    if (!Number.isFinite(limit)) throw new TypeError(`Invalid build rule: ${path}`);
    if (Number.isFinite(value) && (upper ? value > limit : value < limit)) {
      issue("LIMIT_EXCEEDED", path, `制限値 ${limit} に違反しています。`);
    }
  };

  if (!isRecord(build)) {
    issue("INVALID_BUILD", "build", "作成データはオブジェクトが必要です。");
    return result();
  }
  keys(build, ["schemaVersion", "diceFrame", "stats", "dice", "skills"], "build");
  if (build.schemaVersion !== 1) issue("INVALID_VERSION", "schemaVersion", "未対応の形式です。");
  const frame = getDiceFrame(build.diceFrame);
  if (!frame) issue("INVALID_DICE_FRAME", "diceFrame", "定義済みのダイス素体を指定してください。");

  if (!isRecord(build.stats)) {
    issue("INVALID_STATS", "stats", "AT/DFが必要です。");
  } else {
    keys(build.stats, STATS, "stats");
    for (const stat of STATS) {
      const value = build.stats[stat];
      if (!Number.isSafeInteger(value)) issue("INVALID_STAT", `stats.${stat}`, "安全な整数が必要です。");
      bound(value, rules.stats[stat].min, `stats.${stat}.min`, false);
      bound(value, rules.stats[stat].max, `stats.${stat}.max`);
    }
    bound(resources.stats?.used, rules.stats.totalMax, "stats.totalMax");
  }

  if (!Array.isArray(build.dice)) {
    issue("INVALID_DICE", "dice", "ダイス配列が必要です。");
  } else {
    if (build.dice.length !== rules.dice.slots) issue("DICE_SLOTS", "dice", `${rules.dice.slots}枠が必要です。`);
    const maxSameFace = build.dice.includes(0)
      ? rules.dice.maxSameFaceWithEmpty : rules.dice.maxSameFace;
    const counts = new Map();
    // entries()で疎配列の穴も検査する。
    for (const [index, face] of build.dice.entries()) {
      if (!Number.isSafeInteger(face)) {
        issue("INVALID_FACE", `dice.${index}`, "安全な整数が必要です。");
        continue;
      }
      // 空き枠は全素体で使用でき、同一出目数にも数えない。
      if (face === 0) continue;
      if (frame && !frame.faces.includes(face)) issue("FACE_NOT_ALLOWED", `dice.${index}`, "この素体では選択できません。");
      counts.set(face, (counts.get(face) ?? 0) + 1);
    }
    for (const [face, count] of counts) bound(count, maxSameFace, `dice.count.${face}`);
    if (resources.dice === null) {
      issue("INVALID_DICE_RESOURCES", "dice", "ダイス資源を安全に計算できません。");
    } else if (resources.dice.remaining < 0) {
      issue("INSUFFICIENT_DICE_POINTS", "dice", "3個積みに必要なダイス由来ポイントが不足しています。");
    }
  }

  const counts = Object.fromEntries(CATEGORIES.map(category => [category, 0]));
  const costs = Object.fromEntries(CATEGORIES.map(category => [category, 0]));
  const choice = (kind, id, category, path) => {
    const entry = getCatalogChoice(catalog, kind, id);
    if (!entry || !Array.isArray(entry.categories) || !entry.categories.includes(category)) {
      issue("CHOICE_NOT_ALLOWED", path, "未公開またはこのカテゴリでは選択できない項目です。");
    }
  };
  if (!Array.isArray(build.skills)) {
    issue("INVALID_SKILLS", "skills", "スキル配列が必要です。");
  } else {
    for (const [index, skill] of build.skills.entries()) {
      const path = `skills.${index}`;
      const before = errors.length;
      if (!isRecord(skill)) { issue("INVALID_SKILL", path, "スキルの選択情報が必要です。"); continue; }
      keys(skill, ["category", "triggerId", "effectIds"], path);
      if (!CATEGORIES.includes(skill.category)) { issue("INVALID_CATEGORY", path, "A/B/C/Dを指定してください。"); continue; }
      const category = skill.category;
      counts[category]++;
      choice("triggers", skill.triggerId, category, `${path}.triggerId`);
      if (!Array.isArray(skill.effectIds) || skill.effectIds.length === 0) {
        issue("INVALID_EFFECT_IDS", `${path}.effectIds`, "選択IDの配列が必要です。");
      } else {
        for (const [i, id] of skill.effectIds.entries()) choice("effects", id, category, `${path}.effectIds.${i}`);
      }
      // 型/公開範囲に違反したデータを運営側のコールバックへ渡さない。
      if (errors.length !== before) continue;
      const rule = rules.skills[category];
      if (typeof rule.costOf === "function") {
        const cost = rule.costOf(skill, build);
        if (!Number.isFinite(cost) || cost < 0) throw new TypeError(`Invalid skill cost: ${category}`);
        costs[category] += cost;
        if (!Number.isFinite(costs[category])) throw new TypeError(`Skill cost overflow: ${category}`);
      }
      if (typeof rule.validate === "function") {
        const messages = rule.validate(skill, build);
        if (!Array.isArray(messages) || messages.some(message => typeof message !== "string")) {
          throw new TypeError(`Invalid skill validation result: ${category}`);
        }
        for (const message of messages) issue("SKILL_RESTRICTION", path, message);
      }
    }
  }
  for (const category of CATEGORIES) {
    const rule = rules.skills[category];
    bound(counts[category], rule.maxCount, `skills.${category}.maxCount`);
    bound(costs[category], rule.budget, `skills.${category}.budget`);
    if (rule.costOf == null) unresolved(`skills.${category}.costOf`);
    else if (typeof rule.costOf !== "function") throw new TypeError(`Invalid costOf: ${category}`);
    if (rule.validate == null) unresolved(`skills.${category}.validate`);
    else if (typeof rule.validate !== "function") throw new TypeError(`Invalid validate: ${category}`);
  }
  return result();
}
