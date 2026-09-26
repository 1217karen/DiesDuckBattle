import { resolveSelection, migrateSelection } from "./selectionNormalization.js";

// The editor reads both supported representations and writes existing selection v2.
// Invalid saved selections stay invalid until an explicit edit; never guess a replacement.
export function bEventEditorSelection(selection, catalog) {
  const result = resolveSelection("B", selection, catalog);
  if (result.errors.length || result.incomplete.some(issue => issue.path !== "statusId")) return {
    type: "event", triggerId: selection.triggerId ?? "", conditionId: selection.conditionId ?? "", effectId: "", options: {},
  };
  return result.selection;
}

export function changeBEvent(selection, key, value, catalog) {
  const next = { ...bEventEditorSelection(selection, catalog) };
  if (key === "statusId") next.options = { statusId: value };
  else next[key] = value;
  let rows = catalog.events.filter(d => d.triggerId === next.triggerId);
  if (!rows.some(d => d.conditionId === next.conditionId)) next.conditionId = "";
  // A single possible next clause is fixed text and can be filled without guessing.
  const conditions = [...new Set(rows.map(d => d.conditionId))];
  if (!next.conditionId && conditions.length === 1) next.conditionId = conditions[0];
  rows = rows.filter(d => d.conditionId === next.conditionId);
  if (!rows.some(d => d.effectId === next.effectId)) { next.effectId = ""; next.options = {}; }
  if (!next.effectId && rows.length === 1) next.effectId = rows[0].effectId;
  const definition = rows.find(d => d.effectId === next.effectId);
  if (!definition) return { ...next, options: {} };
  next.options = Object.fromEntries(Object.entries(definition.optionAxes).map(([axis, group]) =>
    [axis, catalog.optionSets[group].some(o => o.id === next.options?.[axis]) ? next.options[axis] : ""]));
  return migrateSelection("B", next, catalog);
}

export function bEventEditorDefinition(selection, catalog) {
  return catalog.events.find(d => d.triggerId === selection.triggerId && d.conditionId === selection.conditionId && d.effectId === selection.effectId);
}
