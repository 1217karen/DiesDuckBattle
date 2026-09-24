// Resolve normalized axes to one existing trusted variant; never synthesize semantics/prices.
const blank = v => v == null || v === "";
const record = v => v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v));
export function selectionRows(category, catalog, context = {}) {
  return catalog.selectionEffects.map(d => ({ ...d, variants: d.variants.filter(r => category !== "B" ||
    (blank(context.triggerId) || r.definition.triggerId === context.triggerId) && (blank(context.conditionId) || r.definition.conditionId === context.conditionId)) })).filter(d => d.variants.length);
}
export function mapSelectionEffects(category, selection, map) {
  if (!record(selection)) return selection;
  if (category === "B") return selection.type === "event" ? map(selection, "") : selection;
  if (category === "A") return { ...selection, ...(Array.isArray(selection.effects) ? { effects: selection.effects.map((leaf,i)=>map(leaf,`effects.${i}`)) } : {}) };
  const s=selection.structure;
  if(!record(s)) return selection;
  const branch=(b,path)=>record(b)&&Array.isArray(b.effects)?{...b,effects:b.effects.map((leaf,i)=>map(leaf,`${path}.effects.${i}`))}:b;
  const next={...branch(s,"structure")};
  if(Array.isArray(s.branches)) next.branches=s.branches.map((b,i)=>branch(b,`structure.branches.${i}`));
  else if(record(s.branches)) next.branches=Object.fromEntries(Object.entries(s.branches).map(([k,b])=>[k,branch(b,`structure.branches.${k}`)]));
  return {...selection,structure:next};
}
export function resolveSelection(category, selection, catalog, { force = false } = {}) {
  const errors=[], incomplete=[], deferred=[];
  const converted=mapSelectionEffects(category, selection, (leaf,path)=>{
    if(!record(leaf)) return leaf;
    const definitions=selectionRows(category,catalog,selection);
    const normalized=force || Object.hasOwn(leaf,"targetId") || Object.hasOwn(leaf,"statusId") || (catalog.selectionEffects.some(d=>d.id===leaf.effectId) && !(category==="B"?catalog.events:catalog.effects).some(d=>(category==="B"?d.effectId:d.id)===leaf.effectId));
    if(!normalized) return leaf; // Explicit v1 compatibility for dev pages and opponent source.
    const add=(pending,code,key,message)=>(pending?incomplete:errors).push({code,path:[path,key].filter(Boolean).join("."),message});
    const allowed=["effectId","targetId","statusId","options","chanceOptionId",...(category==="B"?["type","triggerId","conditionId"]:[])];
    for(const key of Object.keys(leaf)) if(!allowed.includes(key)) add(false,"UNKNOWN_FIELD",key,"不要な項目があります。");
    if(!blank(leaf.chanceOptionId) && !catalog.chanceOptions?.some(o=>o.id===leaf.chanceOptionId))
      add(false,"UNKNOWN_CHANCE_OPTION","chanceOptionId","存在しない成功率です。");
    if(blank(leaf.effectId)) {
      const all=catalog.selectionEffects.flatMap(d=>d.variants);
      for(const key of ["targetId","statusId"]) if(!blank(leaf[key]) && !all.some(r=>r[key]===leaf[key])) add(false,"ILLEGAL_COMBINATION",key,"存在しない対象・状態です。");
      for(const [key,value] of Object.entries(leaf.options??{})) if(!all.some(r=>Object.hasOwn(r.fixedOptions,key) && (blank(value)||r.fixedOptions[key]===value) || Object.hasOwn(r.optionAxes,key) && (blank(value)||r.optionAxes[key].some(o=>o.id===value)))) add(false,"UNKNOWN_OPTION",`options.${key}`,"存在しない追加項目です。");
    }
    const definition=definitions.find(d=>d.id===leaf.effectId);
    if(!definition) { add(blank(leaf.effectId),blank(leaf.effectId)?"SELECTION_UNSELECTED":"UNKNOWN_EFFECT","effectId","効果が未選択、または現在の条件では使えません。"); return category==="B" ? {type:leaf.type,triggerId:leaf.triggerId??"",conditionId:leaf.conditionId??"",effectId:"",options:{}} : category==="A" ? {effectId:""} : {effectId:"",options:{}}; }
    const pendingStart=incomplete.length;
    let candidates=definition.variants;
    const choose=(key,value,read,required=true)=>{
      if(blank(value)) {if(required) add(true,"SELECTION_UNSELECTED",key,`${key==="targetId"?"対象":key==="statusId"?"状態の種類":"追加項目"}を選択してください。`); return;}
      const matches=candidates.filter(r=>read(r)===value);
      if(!matches.length) add(false,"ILLEGAL_COMBINATION",key,"この効果では使えない対象・状態・追加項目です。");
      else candidates=matches;
    };
    choose("targetId",leaf.targetId,r=>r.targetId);
    const needsStatus=candidates.some(r=>r.statusId!==undefined);
    if(needsStatus) choose("statusId",leaf.statusId,r=>r.statusId);
    else if(Object.hasOwn(leaf,"statusId")) add(false,"UNKNOWN_FIELD","statusId","この効果には状態を指定できません。");
    const options=leaf.options??{};
    if(!record(options)) add(false,"INVALID_OPTIONS","options","追加項目の形式が不正です。");
    const axes=[...new Set(candidates.flatMap(r=>Object.keys(r.fixedOptions)))];
    for(const axis of axes) choose(`options.${axis}`,options[axis],r=>r.fixedOptions[axis]);
    if(incomplete.length>pendingStart && candidates.length>1) {
      deferred.push({code:"INSUFFICIENT_A_POINTS",path:""},{code:"DUPLICATE_EFFECT",path});
      if(candidates.some(r=>r.chanceEnabled)) deferred.push({code:"DRAWBACK_CHANCE",path},{code:"CHANCE_NOT_ALLOWED",path});
      if(candidates.some(r=>r.definition.exactFace==null || selection.triggerId===`exact:${r.definition.exactFace}`)) deferred.push({code:"EXACT_FACE_REQUIRED",path});
    }
    const row=candidates[0];
    const allowedOptions=new Set(candidates.flatMap(r=>[...Object.keys(r.fixedOptions),...Object.keys(r.optionAxes)]));
    for(const axis of Object.keys(options)) if(!allowedOptions.has(axis)) add(false,"UNKNOWN_FIELD",`options.${axis}`,"この効果には不要な追加項目です。");
    const next={ ...leaf, effectId:row.legacyId };
    delete next.targetId; delete next.statusId;
    next.options=Object.fromEntries(Object.entries(options).filter(([key])=>Object.hasOwn(row.optionAxes,key)));
    if(category==="A") {
      if(Object.hasOwn(next.options,"amount")) next.amountOptionId=next.options.amount;
      delete next.options;
    } else if(category==="C") {
      if(row.definition.optionAxes.status) next.options.status=leaf.statusId??"";
      if(row.groupScope!==undefined) next.options.scope=row.groupScope;
    } else {
      if(row.definition.optionAxes.statusId) next.options.statusId=leaf.statusId??"";
      // B probability/amount tuning remains catalog-owned, never user input.
    }
    return next;
  });
  return {selection:converted,errors,incomplete,deferred};
}
export function migrateSelection(category, selection, catalog) {
  return mapSelectionEffects(category,selection,(leaf)=>{
    if(leaf===null) return null;
    if(!record(leaf)) throw new TypeError("Invalid legacy effect");
    if(blank(leaf.effectId)) {
      const next={...leaf,options:{...(leaf.options??{})}};
      if(category==="A") {if(Object.hasOwn(next,"amountOptionId")) next.options.amount=next.amountOptionId; delete next.amountOptionId;}
      return next;
    }
    const rows=selectionRows(category,catalog,selection).flatMap(d=>d.variants).filter(r=>r.legacyId===leaf.effectId);
    const row=rows.find(r=>category==="A" || (category==="B" ? !r.definition.optionAxes.statusId || r.statusId===leaf.options?.statusId : !r.definition.optionAxes.status || r.statusId===leaf.options?.status)) ?? rows[0];
    if(!row) throw new TypeError(`Unmappable ${category} effect: ${leaf.effectId}`);
    if(category==="B" && !record(leaf.options)) throw new TypeError("Unmappable B options");
    for(const key of Object.keys(row.fixedOptions)) {
      if(Object.hasOwn(leaf.options??{},key) && !(category==="C" && key==="scope" && row.groupScope!==undefined))
        throw new TypeError("Unexpected legacy option conflicts with a normalized axis");
    }
    const options={...(leaf.options??{}),...row.fixedOptions};
    const next={...leaf,effectId:row.effectId,targetId:row.targetId,options};
    if(category==="A") { if(Object.hasOwn(leaf,"amountOptionId")) options.amount=leaf.amountOptionId; delete next.amountOptionId; }
    if(row.statusId!==undefined) next.statusId=row.statusId;
    if(category==="B"&&row.definition.optionAxes.statusId) {next.statusId=leaf.options?.statusId??"";delete options.statusId;}
    if(category==="C") {
      if(row.definition.optionAxes.status) {next.statusId=leaf.options?.status??"";delete options.status;}
      if(row.groupScope!==undefined) {
        if(Object.hasOwn(leaf.options??{},"scope") && leaf.options.scope!==row.groupScope) throw new TypeError("Unmappable clear scope");
        options.scope=Object.hasOwn(leaf.options??{},"scope")?"group":"";
      }
    }
    return next;
  });
}
export const isDeferredSelectionIssue = (issue, resolved) => (resolved.deferred??[]).some(d=>d.code===issue.code && (!d.path || issue.path?.startsWith(d.path)));

/** Merge normalization failures into the existing resource/validation result contract. */
export function withSelectionIssues(result, resolved) {
  if(!resolved.errors.length&&!resolved.incomplete.length) return result;
  const unknownPrices=Object.fromEntries(["netCost","grossCost","remaining","requiredAP","rawAP"].filter(k=>Object.hasOwn(result,k)).map(k=>[k,null]));
  return {...result,...unknownPrices,ok:false,valid:false,complete:false,ready:false,
    errors:[...(result.errors??[]).filter(i=>!isDeferredSelectionIssue(i,resolved)),...resolved.errors],unresolved:[...(result.unresolved??[]),...resolved.incomplete]};
}
