import { inspectBuildForSave } from "./buildSaveInspection.js";
import { clonePlayerBuild } from "./playerBuildModel.js";
import { compileASkill } from "./aSkillCompiler.js";
import { compileBSkill } from "./bSkillCompiler.js";
import { compileCSkill } from "./cSkillCompiler.js";
import { compileDSkill } from "./dSkillCompiler.js";

const failure = (code, message, duckId = null, section = "build") => ({
  ready: false, incomplete: [],
  invalid: [{ code, message, duckId, section, ownerName: "戦闘設定", path: "" }],
});

/** Inspect shared Battler and only the selected Duck, using current production rules. */
export function inspectBattleLoadout(build, duckId) {
  if (!build || !Array.isArray(build.ducks))
    return failure("INVALID_MODEL", "保存モデルの形式が不正です。");
  const matches = build.ducks.filter(duck => duck && duck.id === duckId);
  if (typeof duckId !== "string" || !duckId.trim() || matches.length === 0)
    return failure("DUCK_NOT_FOUND", "指定されたアヒル設定が見つかりません。", duckId);
  if (matches.length !== 1)
    return failure("AMBIGUOUS_DUCK_ID", "同じIDのアヒル設定が複数あります。", duckId);
  // Project before inspection: unrelated Ducks must not block this loadout.
  const inspected = inspectBuildForSave({ ...build, ducks: [matches[0]] });
  const ownerName = matches[0].name || `アヒル ${build.ducks.indexOf(matches[0]) + 1}`;
  const withOwner = issues => issues.map(issue => issue.duckId === duckId
    ? { ...issue, ownerName } : issue);
  return { ready: inspected.complete, invalid: withOwner(inspected.invalid),
    incomplete: withOwner(inspected.incomplete) };
}

/** Compile trusted engine input without changing or persisting the saved selections. */
export function compileBattleLoadout(build, { duckId, battlerId, battlerName } = {}) {
  const inspection = inspectBattleLoadout(build, duckId);
  if (!inspection.ready) return { ok: false, inspection };
  if (typeof battlerId !== "string" || !battlerId.trim() || typeof battlerName !== "string")
    return { ok: false, inspection: failure("INVALID_BATTLER_METADATA",
      "BattlerのID（空でない文字列）と名前（文字列）を指定してください。", null, "Battler") };

  // Compilers receive an isolated snapshot, never the caller's editable state.
  const snapshot = clonePlayerBuild({ ...build, ducks: [build.ducks.find(d => d?.id === duckId)] });
  const source = snapshot.ducks[0];
  const b = compileBSkill(snapshot.battler.bSelection);
  const d = compileDSkill(snapshot.battler.dSelection);
  const a = compileASkill(source, source.aSelection);
  const c = compileCSkill(source.cSelection);
  // Keep the boundary closed if compiler and inspection contracts later diverge.
  const rejected = Object.entries({ B: b, D: d, A: a, C: c }).filter(([, result]) => !result.ok);
  if (rejected.length) return { ok: false, inspection: {
    ready: false, incomplete: [], invalid: rejected.map(([section]) => ({
      section, duckId: ["A", "C"].includes(section) ? duckId : null,
      ownerName: ["A", "C"].includes(section) ? source.name : "BATTLER",
      code: "COMPILATION_FAILED", path: "", message: `${section}スキルを生成できませんでした。`,
    })),
  } };
  return {
    ok: true,
    battler: { id: battlerId, name: battlerName, bSkills: b.bSkills, dSkill: d.skill },
    duck: {
      id: source.id, name: source.name,
      stats: { AT: source.stats.AT, DF: source.stats.DF, SP: source.stats.SP },
      dice: [...source.dice],
      aSkill: { id: "A_PLAYER", name: "Aスキル", ...a.skill },
      cSkill: { id: "C_PLAYER", name: "Cスキル", ...c.skill },
    },
  };
}
