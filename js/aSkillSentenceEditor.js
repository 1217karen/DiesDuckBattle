import { getAEffectOptions, getATriggerOptions } from "./aSkillCatalog.js";
import { effectSelectionFields } from "./effectSelectionCatalog.js";
import { migrateSelection, resolveSelection } from "./selectionNormalization.js";

// Reading never replaces saved data. Unknown legacy leaves remain visible for reselection.
export function aEditorLeaf(leaf, catalog) {
  if (!leaf || Object.hasOwn(leaf, "targetId") || catalog.selectionEffects.some(d => d.id === leaf.effectId)) return leaf ?? {};
  try {
    const next = migrateSelection("A", { effects: [leaf] }, catalog).effects[0];
    const d = catalog.effects.find(d => d.id === leaf.effectId);
    return d?.exactFace != null ? { ...next, options: { ...next.options, diceAction: String(d.exactFace) } } : next;
  }
  catch { return leaf; }
}
export function aCancelRow(catalog) {
  return catalog.selectionEffects.flatMap(d => d.variants).find(r => r.definition.cancelsNormalAttack);
}
export function isACancel(leaf, catalog) {
  const row = aCancelRow(catalog);
  return leaf?.effectId === row.legacyId || leaf?.effectId === row.effectId;
}
export function aNormalSlots(selection, catalog) {
  return (selection.effects ?? []).flatMap((leaf, index) => isACancel(leaf, catalog) ? [] : [{ leaf, index }]);
}
export function aEditorCatalog(duck, selection, catalog, index = -1) {
  const others = (selection.effects ?? []).filter((_, i) => i !== index);
  // A blank trigger can be edited after an ordinary effect. Use only variants
  // offered by the trusted triggers, without choosing a trigger on the user's behalf.
  const triggers = selection.triggerId ? [selection.triggerId] : getATriggerOptions(duck, catalog).map(t => t.id);
  const available = new Set(triggers.flatMap(trigger => getAEffectOptions(duck, trigger, catalog, others)
    .flatMap(g => g.effects).filter(e => e.selectable && (selection.triggerId || e.exactFace == null)).map(e => e.id)));
  const resolved = resolveSelection("A", { ...selection, effects: others }, catalog).selection.effects;
  return catalog.selectionEffects.map(d => ({ ...d, variants: d.variants.filter(r =>
    !r.definition.cancelsNormalAttack && available.has(r.legacyId) &&
    (r.definition.allowDuplicate || !resolved.some(e => e?.effectId === r.legacyId))) })).filter(d => d.variants.length);
}
export function aCancelAvailable(duck, selection, catalog) {
  return getAEffectOptions(duck, selection.triggerId, catalog, selection.effects ?? []).flatMap(g => g.effects)
    .find(d => d.cancelsNormalAttack)?.selectable ?? false;
}
const fromRow = row => ({ effectId: row.effectId, targetId: row.targetId,
  ...(row.statusId ? { statusId: row.statusId } : {}), options: { ...row.fixedOptions } });
export function setAAttackCancel(selection, enabled, duck, catalog) {
  const effects = selection.effects ?? [];
  if (!enabled) return { ...selection, effects: effects.filter(e => !isACancel(e, catalog)) };
  if (effects.some(e => isACancel(e, catalog)) || !aCancelAvailable(duck, selection, catalog)) return selection;
  return { ...selection, effects: [...effects, fromRow(aCancelRow(catalog))] };
}
export function addANormalEffect(selection, catalog) {
  if (aNormalSlots(selection, catalog).length >= catalog.maxEffects) return selection;
  return { ...selection, effects: [...(selection.effects ?? []), { effectId: "", targetId: "", options: {} }] };
}
export function removeANormalEffect(selection, index, catalog) {
  if (isACancel(selection.effects?.[index], catalog)) return selection;
  return { ...selection, effects: selection.effects.filter((_, i) => i !== index) };
}
export function changeATrigger(selection, triggerId, duck, catalog) {
  if (triggerId && !getATriggerOptions(duck, catalog).some(t => t.id === triggerId)) return selection;
  // Existing v2 diceAction compatibility retains the identity of a selected skip
  // when several exact-face variants share one normalized effectId.
  const effects = (selection.effects ?? []).map(leaf => {
    if (!leaf || !Object.hasOwn(leaf, "targetId") || Object.hasOwn(leaf.options ?? {}, "diceAction")) return leaf;
    const resolved = resolveSelection("A", { ...selection, effects: [leaf] }, catalog);
    if (resolved.errors.length || resolved.incomplete.length) return leaf;
    const d = catalog.effects.find(d => d.id === resolved.selection.effects[0]?.effectId);
    return d?.exactFace != null ? { ...leaf, options: { ...leaf.options, diceAction: String(d.exactFace) } } : leaf;
  });
  return { ...selection, triggerId, effects };
}
// Only an explicitly edited leaf can have downstream fields cleared.
export function changeAClause(selection, index, key, value, duck, catalog) {
  const definitions = aEditorCatalog(duck, selection, catalog, index);
  const old = aEditorLeaf(selection.effects[index], catalog);
  let next = { ...old, options: { ...old.options } };
  if (key === "targetId") {
    if (!definitions.some(d => d.id === old.effectId && d.variants.some(r => r.targetId === value))) return selection;
    next = { effectId: old.effectId, targetId: value, options: {} };
  } else if (key === "effectId") {
    if (!definitions.some(d => d.id === value)) return selection;
    next = { effectId: value, targetId: "", options: {} };
  } else {
    const fields = effectSelectionFields(definitions, old).fields;
    if (!fields.find(f => f.key === key)?.options.some(o => o.id === value)) return selection;
    if (key === "statusId") { next.statusId = value; next.options = {}; }
    else if (key.startsWith("options.")) next.options[key.slice(8)] = value;
    else return selection;
  }
  // A uniquely determined clause is fixed text; all other clauses require a choice.
  for (let pass = 0; pass < 2; pass++) {
    for (const f of effectSelectionFields(definitions, next).fields) {
      const axis = f.key.startsWith("options.") ? f.key.slice(8) : null;
      const current = axis ? next.options[axis] : next[f.key];
      if (!current && f.options.length === 1) {
        if (axis) next.options[axis] = f.options[0].id;
        else next[f.key] = f.options[0].id;
      }
    }
  }
  return { ...selection, effects: selection.effects.map((leaf, i) => i === index ? next : leaf) };
}
