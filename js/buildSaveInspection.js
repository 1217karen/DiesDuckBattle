import { resolveSelection, isDeferredSelectionIssue } from "./selectionNormalization.js";
import { clonePlayerBuild, createEmptyPlayerBuild, createEmptyDuck } from "./playerBuildModel.js";
import { createBuildRules } from "./buildRules.js";
import { calculateBuildResources } from "./buildResources.js";
import { DICE_FRAMES, getDiceFrame } from "./diceFrames.js";
import { createASkillCatalog, getATriggerOptions } from "./aSkillCatalog.js";
import { compileASkill } from "./aSkillCompiler.js";
import { createBSkillCatalog, getBSelectionDefinition } from "./bSkillCatalog.js";
import { validateBSkillSelection, compileBSkill } from "./bSkillCompiler.js";
import { createCSkillRules } from "./cSkillRules.js";
import { createCSkillCatalog } from "./cSkillCatalog.js";
import { compileCSkill } from "./cSkillCompiler.js";
import { compileDSkill } from "./dSkillCompiler.js";

const blank = value => value === null || value === undefined || value === "";
const at = (object, path) => path?.split(".").reduce((value, key) => value?.[key], object);
const text = {
  UNKNOWN_FIELD: "不要な項目が含まれています。設定を選択し直してください。",
  UNKNOWN_EFFECT: "存在しないproduction効果が指定されています。",
  UNKNOWN_OPTION: "現在の効果では使えない選択肢が指定されています。",
  UNKNOWN_CHANCE_OPTION: "使用できない成功率が指定されています。",
  INVALID_MODE: "Cの種類が不正です。", INVALID_STRUCTURE: "Cの構造が不正です。",
  UNKNOWN_STRUCTURE: "存在しない分岐方式です。", INVALID_BRANCH: "分岐の構造が壊れています。",
  INVALID_BRANCHES: "HP条件の分岐構造が壊れています。", BRANCH_COUNT: "ランダム分岐の構造・分岐数が不正です。",
  SPECIAL_FLAT_ONLY: "特殊Cでは分岐を使用できません。", MODE_UNAVAILABLE: "現在のC種類では使用できない効果です。",
  CHANCE_NOT_ALLOWED: "この効果には成功率を指定できません。", INVALID_OPTIONS: "効果の選択肢の形式が不正です。",
};

/** Current production inspection, never persisted. No input mutation or battle data. */
function inspectLegacyBuildForSave(build) {
  const invalid = [], incomplete = [];
  const result = () => ({ canSave: invalid.length === 0, complete: invalid.length === 0 && incomplete.length === 0, invalid, incomplete });
  const add = (scope, level, code, path, message) => {
    const list = level === "invalid" ? invalid : incomplete;
    if (!list.some(i => i.duckId === scope.duckId && i.section === scope.section && i.code === code && i.path === path))
      list.push({ ...scope, code, path, message });
  };
  const scope = (section, duck, index) => ({ section, duckId: duck?.id ?? null,
    ownerName: duck ? duck.name || `アヒル ${index + 1}` : "BATTLER" });
  // Validate the envelope separately so a bad selection can be attributed to its section.
  try {
    if (!build?.battler || typeof build.battler !== "object" || Array.isArray(build.battler)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(build.battler))) throw new TypeError("Invalid battler");
    clonePlayerBuild({ ...build, battler: { ...build.battler, bSelection: null, dSelection: null },
      ducks: build.ducks.map(d => ({ ...d, aSelection: null, cSelection: null })) });
  } catch {
    add({ section: "build", duckId: null, ownerName: "設定全体" }, "invalid", "INVALID_MODEL", "build", "保存データの形式が壊れています。");
    return result();
  }
  // Reuse the existing serialization boundary, with no new selection DTO.
  const selectionShape = (selection, section, owner) => {
    if (selection === null) {
      add(owner, "incomplete", "UNSET", "", `${section}スキルが未設定です。`); return false;
    }
    try {
      const shell = createEmptyPlayerBuild(); shell.schemaVersion = 1;
      if (["B", "D"].includes(section)) shell.battler[`${section.toLowerCase()}Selection`] = selection;
      else { const duck = createEmptyDuck({ idFactory: () => "inspection" }); duck[`${section.toLowerCase()}Selection`] = selection; shell.ducks.push(duck); }
      clonePlayerBuild(shell);
      return true;
    } catch {
      add(owner, "invalid", "INVALID_DTO", "", `${section}スキルに不要な項目または壊れたデータがあります。`); return false;
    }
  };
  const rules = createBuildRules(), aCatalog = createASkillCatalog(), bCatalog = createBSkillCatalog(), cRules = createCSkillRules(), cCatalog = createCSkillCatalog();

  const b = build.battler.bSelection, bOwner = scope("B");
  if (selectionShape(b, "B", bOwner)) {
    const allowed = b.type === "event" ? ["type", "triggerId", "conditionId", "effectId", "options"]
      : b.type === "trait" ? ["type", "traitId", "options"] : ["type", "triggerId", "conditionId", "effectId", "traitId", "options"];
    const extra = Object.keys(b).some(key => !allowed.includes(key));
    const ids = b.type === "event" ? ["triggerId", "conditionId", "effectId"] : b.type === "trait" ? ["traitId"] : [];
    const missingIds = ids.some(key => blank(b[key]));
    const definition = getBSelectionDefinition(b, bCatalog);
    const axes = definition?.optionAxes ?? {};
    const extraOptions = definition && Object.keys(b.options ?? {}).some(key => !Object.hasOwn(axes, key));
    const missingOptions = definition && Object.keys(axes).some(key => blank(b.options?.[key]));
    const unknownOptions = definition && Object.entries(axes).some(([key, set]) => !blank(b.options?.[key])
      && !bCatalog.optionSets[set].some(o => o.id === b.options[key]));
    for (const key of ["triggerId", "conditionId", "effectId", "traitId"]) {
      const known = key === "traitId" ? bCatalog.traits.some(e => e.id === b[key]) : bCatalog.events.some(e => e[key] === b[key]);
      if (!blank(b[key]) && !known) add(bOwner, "invalid", "UNKNOWN_ID", key, "存在しないBのproduction IDが指定されています。");
    }
    // Partial choices must still match at least one catalog row. This also finds
    // unknown IDs when another required field is blank.
    const candidates = b.type === "event" ? bCatalog.events.filter(e => ids.every(key => blank(b[key]) || e[key] === b[key]))
      : b.type === "trait" ? bCatalog.traits.filter(e => blank(b.traitId) || e.id === b.traitId)
        : blank(b.type) ? [...bCatalog.events, ...bCatalog.traits] : [];
    for (const [axis, value] of Object.entries(b.options ?? {})) {
      const sets = candidates.flatMap(e => Object.hasOwn(e.optionAxes, axis) ? [bCatalog.optionSets[e.optionAxes[axis]]] : []);
      if (candidates.length && !sets.length) add(bOwner, "invalid", "UNKNOWN_FIELD", `options.${axis}`, "現在のB候補にはない追加項目です。");
      else if (sets.length && !blank(value) && !sets.some(set => set.some(o => o.id === value)))
        add(bOwner, "invalid", "UNKNOWN_OPTION", `options.${axis}`, "存在しないBの選択肢が指定されています。");
    }
    const validation = validateBSkillSelection(b, { catalog: bCatalog });
    for (const issue of validation.errors) {
      let pending = false;
      switch (issue.code) {
        case "INVALID_SELECTION_TYPE": pending = blank(b.type); break;
        case "INVALID_SELECTION_FIELDS": pending = !extra; break;
        case "INVALID_ID": pending = missingIds; break;
        case "UNKNOWN_OR_ILLEGAL_OPTION": pending = blank(b.type) || (missingIds && candidates.length > 0); break;
        case "INVALID_OPTION_FIELDS": pending = !extraOptions; break;
        case "UNKNOWN_OPTION": pending = missingOptions && !unknownOptions; break;
      }
      add(bOwner, pending ? "incomplete" : "invalid", issue.code, "", pending
        ? "Bの種類・発動条件・効果・追加項目の選択が未完了です。"
        : "BのID・組合せ・不要な項目を確認してください。");
    }
    // The compiler stops checking option values if option keys are incomplete.
    if (unknownOptions) add(bOwner, "invalid", "UNKNOWN_OPTION", "options", "存在しないBの選択肢が指定されています。");
    if (missingOptions) add(bOwner, "incomplete", "OPTION_UNSELECTED", "options", "Bの追加項目を選択してください。");
    if (validation.complete) compileBSkill(b, { catalog: bCatalog });
    for (const issue of validation.unresolved) add(bOwner, "invalid", issue.code, "", "Bのproduction定義を確定できません。");
  }
  const d = build.battler.dSelection, dOwner = scope("D");
  if (selectionShape(d, "D", dOwner)) {
    for (const issue of compileDSkill(d).errors) {
      const pending = ["OPTION_REQUIRED", "INVALID_OPTION_ID", "UNKNOWN_OPTION_ID"].includes(issue.code) && blank(d.optionId);
      add(dOwner, pending ? "incomplete" : "invalid", issue.code, "optionId", pending ? "Dの追加ダイスを選択してください。" : "存在しないDの選択肢です。");
    }
  }
  if (!build.ducks.length) add({ section: "ducks", duckId: null, ownerName: "設定全体" }, "incomplete", "NO_DUCK", "ducks", "アヒル設定が1件もありません。");
  build.ducks.forEach((duck, index) => {
    const owner = section => scope(section, duck, index);
    const statOwner = owner("stats"), frame = getDiceFrame(duck.diceFrame), resources = calculateBuildResources(duck, rules);
    for (const key of ["AT", "DF"]) {
      const value = duck.stats[key], limit = rules.stats[key];
      if (blank(value)) add(statOwner, "incomplete", "STAT_UNSET", key, `${key}が未入力です。`);
      else if (!Number.isSafeInteger(value) || value < limit.min || value > limit.max)
        add(statOwner, "invalid", "STAT_RANGE", key, `${key}は${limit.min}～${limit.max}の整数にしてください。`);
    }
    if (blank(duck.diceFrame) || blank(duck.stats.SP)) add(statOwner, "incomplete", "SP_UNSET", "SP", "SPが未設定です。");
    if ((!blank(duck.diceFrame) && !frame) || (!blank(duck.stats.SP) && !Object.values(DICE_FRAMES).some(f => f.SP === duck.stats.SP))
      || (frame && !blank(duck.stats.SP) && frame.SP !== duck.stats.SP))
      add(statOwner, "invalid", "SP_FRAME_MISMATCH", "SP", "SPとダイス素体が矛盾しています。SPを選択し直してください。");
    if (resources.stats?.remaining < 0) add(statOwner, "invalid", "STATS_TOTAL", "stats", `能力合計が上限${rules.stats.totalMax}を超えています。`);

    const aShape = selectionShape(duck.aSelection, "A", owner("A"));
    const aResult = compileASkill(duck, aShape ? duck.aSelection : null, { catalog: aCatalog, rules });
    const diceOwner = owner("dice");
    if (!frame) add(diceOwner, "incomplete", "DICE_FRAME_UNSET", "dice", "SPを設定するとダイスの合法性を確認できます。");
    else for (const issue of aResult.errors.filter(e => e.code === "INVALID_DICE_RESOURCES"))
      add(diceOwner, "invalid", issue.code, "dice", "使用可能な出目・同じ出目の個数・ダイス資源を確認してください。");
    if (aShape) {
      const a = duck.aSelection;
      // Resources stops at an unselected effect. Still reject independently known
      // bad IDs, rather than allowing a blank effect to hide them.
      for (const [i, leaf] of (a.effects ?? []).entries()) {
        if (!blank(leaf?.effectId)) continue;
        if (!blank(leaf?.amountOptionId) && !aCatalog.effects.some(e => e.amountOptions.some(o => o.id === leaf.amountOptionId)))
          add(owner("A"), "invalid", "UNKNOWN_AMOUNT_OPTION", `effects.${i}.amountOptionId`, "存在しないAの効果量です。");
        if (!blank(leaf?.chanceOptionId) && !aCatalog.chanceOptions.some(o => o.id === leaf.chanceOptionId))
          add(owner("A"), "invalid", "UNKNOWN_CHANCE_OPTION", `effects.${i}.chanceOptionId`, "存在しないAの成功率です。");
      }
      for (const issue of [...aResult.errors, ...aResult.unresolved]) {
        if (issue.code === "INVALID_DICE_RESOURCES") continue; // Report once, in DICE.
        const value = at(a, issue.path);
        let pending = false;
        switch (issue.code) {
          case "INVALID_TRIGGER": pending = blank(a.triggerId) || (!frame && Object.keys(DICE_FRAMES).some(id => getATriggerOptions(id, aCatalog).some(t => t.id === a.triggerId))); break;
          case "INVALID_EFFECTS": pending = blank(a.effects); break;
          case "INVALID_EFFECT": pending = value === null; break;
          case "UNKNOWN_EFFECT": pending = blank(value?.effectId); break;
          case "EFFECT_COUNT": pending = aResult.resources.effectCount === 0; break;
          case "AMOUNT_UNSELECTED": pending = true; break;
          case "UNKNOWN_AMOUNT_OPTION": case "UNKNOWN_CHANCE_OPTION": case "DRAWBACK_CHANCE": pending = blank(value); break;
        }
        const message = issue.code === "INSUFFICIENT_A_POINTS" ? `Aポイントが${-aResult.resources.remaining}pt不足しています。`
          : pending ? "Aの発動条件・効果・効果量などの選択が未完了です。" : issue.message ?? text[issue.code] ?? "Aの設定がproductionルールに適合しません。";
        add(owner("A"), pending ? "incomplete" : "invalid", issue.code, issue.path, message);
      }
    }
    if (selectionShape(duck.cSelection, "C", owner("C"))) {
      const c = duck.cSelection, compilation = compileCSkill(c);
      const structure = c.structure;
      if (!blank(structure?.thresholdOptionId) && !cCatalog.optionSets.hpThreshold.some(o => o.id === structure.thresholdOptionId))
        add(owner("C"), "invalid", "UNKNOWN_OPTION", "structure.thresholdOptionId", "存在しないHP条件です。");
      const branches = structure?.kind === "flat" ? [structure]
        : Array.isArray(structure?.branches) ? structure.branches : Object.values(structure?.branches ?? {});
      for (const [bi, branch] of branches.entries()) for (const [i, leaf] of (branch?.effects ?? []).entries()) {
        if (!blank(leaf?.effectId)) continue;
        for (const [axis, value] of Object.entries(leaf?.options ?? {})) {
          const sets = cCatalog.effects.flatMap(e => Object.hasOwn(e.optionAxes, axis) ? [cCatalog.optionSets[e.optionAxes[axis]]] : []);
          if (!sets.length || (!blank(value) && !sets.some(set => set.some(o => o.id === value))))
            add(owner("C"), "invalid", "UNKNOWN_OPTION", `branch.${bi}.effects.${i}.options.${axis}`, "存在しないCの追加項目です。");
        }
        if (!blank(leaf?.chanceOptionId) && !cCatalog.chanceOptions.some(o => o.id === leaf.chanceOptionId))
          add(owner("C"), "invalid", "UNKNOWN_CHANCE_OPTION", `branch.${bi}.effects.${i}.chanceOptionId`, "存在しないCの成功率です。");
      }
      for (const issue of [...compilation.errors, ...compilation.unresolved]) {
        const value = at(c, issue.path);
        let pending = false;
        switch (issue.code) {
          case "INVALID_MODE": case "MODE_UNAVAILABLE": pending = blank(c.mode); break;
          case "INVALID_STRUCTURE": pending = blank(c.structure); break;
          case "UNKNOWN_STRUCTURE": pending = blank(c.structure?.kind); break;
          case "INVALID_EFFECTS": pending = blank(value); break;
          case "EMPTY_BRANCH": case "OPTION_UNSELECTED": pending = true; break;
          case "EFFECT_COUNT": pending = compilation.resources.effectCount < cRules.minEffects; break;
          case "INVALID_EFFECT": pending = value === null; break;
          case "UNKNOWN_EFFECT": case "UNKNOWN_OPTION": case "UNKNOWN_CHANCE_OPTION": pending = blank(value); break;
          case "INVALID_OPTIONS": pending = blank(value); break;
        }
        add(owner("C"), pending ? "incomplete" : "invalid", issue.code, issue.path, pending
          ? "Cの効果・分岐・追加項目の選択が未完了です。"
          : text[issue.code] ?? (issue.code === "EFFECT_COUNT" ? `Cの効果数が上限${cRules.maxEffects}件を超えています。` : "Cの設定がproductionルールに適合しません。"));
      }
    }
  });
  return result();
}

export function saveSectionSummary(inspection, section, duckId = null) {
  const invalid = inspection.invalid.filter(i => i.section === section && i.duckId === duckId);
  const incomplete = inspection.incomplete.filter(i => i.section === section && i.duckId === duckId);
  return { label: invalid.length ? "不正" : incomplete.length ? "未完成" : "完成",
    invalid, incomplete, messages: [...new Set([...invalid, ...incomplete].map(i => i.message))] };
}

/** Testable save gate. Approval never bypasses invalid data; inspect again on save. */
export function saveInspectedBuild(state, repository, { approveIncomplete = false } = {}) {
  const inspection = inspectBuildForSave(state.build);
  if (!inspection.canSave) return { state, inspection, status: "invalid" };
  if (!inspection.complete && !approveIncomplete) return { state, inspection, status: "confirmation-required" };
  const saved = repository.save(state.build);
  return { state: saved.ok ? { ...state, dirty: false } : state, inspection, status: saved.status };
}

/** v2 axes are resolved before reusing legacy production inspection and costs. */
export function inspectBuildForSave(build) {
  if (build?.schemaVersion !== 2) return inspectLegacyBuildForSave(build);
  let legacy;
  try { legacy = clonePlayerBuild(build); }
  catch { return {canSave:false,complete:false,incomplete:[],invalid:[{section:"build",duckId:null,ownerName:"設定全体",code:"INVALID_MODEL",path:"build",message:"保存形式が不正です。"}]}; }
  const invalid=[],incomplete=[],deferred=[];
  function convert(category, value, catalog, duck=null, index=0) {
    const resolved=resolveSelection(category,value,catalog,{force:true});
    const owner={section:category,duckId:duck?.id??null,ownerName:duck?(duck.name||`アヒル ${index+1}`):"BATTLER"};
    deferred.push({owner,resolved});
    invalid.push(...resolved.errors.map(i=>({...owner,...i})));
    incomplete.push(...resolved.incomplete.map(i=>({...owner,...i})));
    return resolved.selection;
  }
  legacy.schemaVersion=1;
  legacy.battler.bSelection=convert("B",legacy.battler.bSelection,createBSkillCatalog());
  legacy.ducks.forEach((duck,i)=>{
    duck.aSelection=convert("A",duck.aSelection,createASkillCatalog(),duck,i);
    duck.cSelection=convert("C",duck.cSelection,createCSkillCatalog(),duck,i);
  });
  const result=inspectLegacyBuildForSave(legacy);
  invalid.push(...result.invalid.filter(issue=>!deferred.some(({owner,resolved})=>issue.section===owner.section && issue.duckId===owner.duckId && isDeferredSelectionIssue(issue,resolved)))); incomplete.push(...result.incomplete);
  return {canSave:!invalid.length,complete:!invalid.length&&!incomplete.length,invalid,incomplete};
}
