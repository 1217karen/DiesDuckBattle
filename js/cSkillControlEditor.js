import { selectionRows } from "./selectionNormalization.js";
import { effectSelectionFields } from "./effectSelectionCatalog.js";
import { getCEffectAvailability } from "./cSkillCatalog.js";

export function cControlDefinitions(catalog, context) {
  return selectionRows("C", catalog, context).map(d => ({ ...d, variants: d.variants.filter(r =>
    getCEffectAvailability(r.legacyId, context.mode, catalog).selectable) })).filter(d => d.variants.length);
}

// Only called by explicit edits, never while rendering or loading saved data.
export function changeCControl(chosen, key, value, catalog, context) {
  const definitions = cControlDefinitions(catalog, context);
  const next = key === "effectId" ? { effectId: value, options: {} } : { ...chosen, options: { ...chosen.options } };
  const read = key => key.startsWith("options.") ? next.options[key.slice(8)] : next[key];
  const put = (key, value) => {
    if (key.startsWith("options.")) next.options[key.slice(8)] = value;
    else next[key] = value;
  };
  put(key, value);
  const originalFields = effectSelectionFields(definitions, next).fields;
  const parentIndex = key === "effectId" ? -1 : originalFields.findIndex(f => f.key === key);
  if (key !== "chanceOptionId") {
    // Re-evaluate after each parent clause, so status/scope options stay correlated.
    let index = 0;
    while (index < effectSelectionFields(definitions, next).fields.length) {
      const f = effectSelectionFields(definitions, next).fields[index++];
      if (index - 1 <= parentIndex) continue;
      if (!f.options.some(o => o.id === read(f.key))) put(f.key, f.options.length === 1 ? f.options[0].id : "");
    }
    const view = effectSelectionFields(definitions, next);
    const axes = new Set(view.fields.filter(f => f.key.startsWith("options.")).map(f => f.key.slice(8)));
    next.options = Object.fromEntries(Object.entries(next.options).filter(([axis]) => axes.has(axis)));
    if (!view.fields.some(f => f.key === "statusId")) delete next.statusId;
    if (!view.chanceEnabled) delete next.chanceOptionId;
    else if (!catalog.chanceOptions.some(o => o.id === next.chanceOptionId)) {
      if (catalog.chanceOptions.length === 1) next.chanceOptionId = catalog.chanceOptions[0].id;
      else delete next.chanceOptionId; // Existing omitted-chance semantics remain unchanged.
    }
  } else if (!value) delete next.chanceOptionId;
  return next;
}
