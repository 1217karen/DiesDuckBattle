// Normalized selection catalog derived from trusted legacy definitions. No prices here.
import { statusLabel } from "./statusMetadata.js";
export const TARGET_OPTIONS = [{id:"self",label:"自分"},{id:"enemy",label:"相手"},{id:"both",label:"両者"},{id:"healTarget",label:"回復対象"}];
export const AXIS_LABELS = { amount:"効果量", direction:"増減", duration:"継続ターン", scope:"解除範囲", activation:"発動方式", preset:"方式", diceAction:"出目効果", amountPct:"HP割合", maxHpPct:"復活HP割合", multiplier:"倍率", baseAmount:"基礎効果量", everyTurns:"周期", stepAmount:"増加量" };
const option = (id, label = id) => ({ id, label });
const direction = sign => sign < 0 ? "decrease" : "increase";
const optionLabel = (axis,id) => ({increase:"増加",decrease:"減少",single:"指定状態",group:"状態グループ",guaranteed:"確定",chance:"確率発動"})[id] ?? id;
function groupRows(rows) {
  return [...new Set(rows.map(r=>r.effectId))].map(id => ({ id, label:rows.find(r=>r.effectId===id).label, variants:rows.filter(r=>r.effectId===id) }));
}
export function normalizedACatalog(catalog) {
  const rows = catalog.effects.map(d => {
    const s=d.semantics, fixed={}, axes={}; let id,label,statusId;
    if(s.type==="fixedDamage") {id="damage";label="固定ダメージ";}
    else if(s.type==="heal") {id="heal";label="HPを回復";}
    else if(s.type==="changeStatus") {id=s.value===-1?"remove-status":"grant-status";label=s.value===-1?"状態を解除":"状態を付与";statusId=s.status;}
    else if(s.type==="addBuff") {id=`change-${s.stat.toLowerCase()}`;label=`${s.stat}を変更`;fixed.direction=direction(s.sign);}
    else {
      const definitions={ ap:["change-ap","APを変更"], nextAttackATPlus:["change-next-at","次回攻撃ATを変更"], attackTimesOverride:["cancel-attack","通常攻撃を中止"], attackTimesAdd:["change-attacks","攻撃回数を変更"], additionalRecoil:["add-recoil","追加反動"], recoilMinus:["reduce-recoil","反動を軽減"] };
      [id,label]=definitions[s.key] ?? ["cancel-dice-effect","出目効果を無効化"];
      if(["ap","nextAttackATPlus"].includes(s.key)) fixed.direction=direction(s.sign);
      if(d.exactFace!=null) fixed.diceAction=String(d.exactFace);
      if(s.key==="attackTimesAdd" && s.value===-1) {id="reduce-dice-attacks";label="出目の攻撃回数を減少";}
    }
    if(d.requiresAmount) axes.amount=d.amountOptions;
    return {effectId:id,label,targetId:s.target,...(statusId?{statusId}:{}),fixedOptions:fixed,optionAxes:axes,legacyId:d.id,definition:d,
      chanceEnabled:d.polarity==="benefit"};
  });
  return groupRows(rows);
}
export function normalizedCCatalog(catalog) {
  const rows=[];
  for(const d of catalog.effects) {
    const s=d.semantics, fixed={}, axes={}; let id,label;
    if(s.type==="fixedDamage") [id,label]=s.amountPctAxis?["hp-damage","HP割合ダメージ"]:s.statusMultiplierAxis?["status-damage","状態数ダメージ"]:s.everyTurnsAxis?["turn-damage","経過ターンダメージ"]:["damage","固定ダメージ"];
    else if(s.type==="heal") [id,label]=["heal","HPを回復"];
    else if(s.type==="changeStatus") [id,label]=["grant-status","状態を付与"];
    else if(s.type==="clearStatus") { [id,label]=["clear-status","状態を解除"];fixed.scope=s.scope; }
    else if(s.type==="addTimedHitRule") [id,label]=["grant-on-hit","攻撃命中時に状態を付与"];
    else if(s.type==="revive") [id,label]=["revive","復活"];
    else {id=`change-${s.stat.toLowerCase()}`;label=`${s.stat}を変更`;fixed.direction=direction(s.amountSign);}
    for(const [axis,set] of Object.entries(d.optionAxes)) if(axis!=="status" && !(axis==="scope" && s.scope==="group")) axes[axis]=catalog.optionSets[set];
    const statuses=d.optionAxes.status?catalog.optionSets[d.optionAxes.status].map(o=>({id:o.id,value:o.value})):s.scope==="group"?[{id:`@${s.group}`,value:s.group}]:[null];
    for(const status of statuses) rows.push({effectId:id,label,targetId:s.statusTarget??s.target,...(status?{statusId:status.id}:{}),fixedOptions:fixed,optionAxes:axes,legacyId:d.id,definition:d,
      legacyStatus:status?.id,groupScope:s.scope==="group"?catalog.optionSets[d.optionAxes.scope][0].id:undefined,chanceEnabled:d.polarity==="benefit"&&d.chanceEnabled===true});
  }
  return groupRows(rows);
}
export function normalizedBCatalog(catalog) {
  const rows=[];
  for(const d of catalog.events) {
    const raw=d.semantics.rules[0].effect, list=Array.isArray(raw)?raw:[raw], s=list[0], fixed={};
    let id,label, statusIds=[undefined], targetId=[...new Set(list.map(e=>e.target))].length===1?s.target:"both";
    if(list.every(e=>e.type==="changeStatus")) {
      [id,label]=["grant-status","状態を付与"];
      const status=list.length>1?(new Set(list.map(e=>e.status)).size===1?s.status:"@mixed"):s.status;
      statusIds=typeof status==="string"?[status]:catalog.optionSets[status.statusOption].map(o=>o.id);
      if(s.chance) fixed.activation="chance"; else fixed.activation="guaranteed";
    } else if(list.length>1) {
      [id,label]=list.some(e=>e.type==="fixedDamage")?["ap-with-hp","HP消費でAPを変更"]:list.some(e=>e.key==="ap")?["heal-with-ap","AP消費でHPを回復"]:["status-emergency","状態を解除して付与"];
      if(d.optionAxes.statusId) statusIds=catalog.optionSets[d.optionAxes.statusId].map(o=>o.id);
      // Existing fixed packages remain packages; tuning values are never editable.
      if(id==="ap-with-hp") fixed.preset=d.effectId;
    } else if(s.type==="removeRandomStatusStack") { [id,label]=["remove-random-status","状態をランダム解除"];statusIds=[`@${s.group}`]; }
    else if(s.type==="heal") [id,label]=s.byStatusCount?["heal-by-status","状態数に応じてHPを回復"]:s.amount?.read?["heal-by-ap","APに応じてHPを回復"]:["heal","HPを回復"];
    else if(s.type==="fixedDamage") [id,label]=["damage-by-ap","APに応じた固定ダメージ"];
    else { [id,label]=s.key==="ap"?["change-ap","APを変更"]:s.value?.read?["change-at-by-status","状態数に応じて次回攻撃ATを変更"]:["change-next-at","次回攻撃ATを変更"]; fixed.direction=s.value?.negate?"decrease":"increase"; }
    for(const statusId of statusIds) rows.push({effectId:id,label,targetId,...(statusId?{statusId}:{}),fixedOptions:fixed,optionAxes:{},legacyId:d.effectId,definition:d,chanceEnabled:false});
  }
  return groupRows(rows);
}
/** UI axes come entirely from the legal catalog rows. Never a cross-product rule. */
export function effectSelectionFields(definitions, chosen={}) {
  const definition=definitions.find(d=>d.id===chosen.effectId);
  if(!definition) return {definition:null, fields:[], variants:[]};
  const rows=definition.variants;
  const unique=items=>[...new Map(items.map(o=>[o.id,o])).values()];
  const matching=rows.filter(r=>(!chosen.targetId||r.targetId===chosen.targetId));
  const statusRows=matching.filter(r=>!chosen.statusId||r.statusId===chosen.statusId);
  const fields=[{key:"targetId",label:"対象",options:unique(rows.map(r=>option(r.targetId,TARGET_OPTIONS.find(t=>t.id===r.targetId)?.label)))}];
  if(matching.some(r=>r.statusId)) fields.push({key:"statusId",label:"状態の種類",options:unique(matching.filter(r=>r.statusId).map(r=>option(r.statusId,r.groupScope!==undefined?(r.statusId==="@buff"?"強化状態全体":"状態異常全体"):statusLabel(r.statusId))))});
  const axes=unique(statusRows.flatMap(r=>Object.keys({...r.fixedOptions,...r.optionAxes}).map(id=>option(id)))).map(o=>o.id);
  for(const axis of axes) fields.push({key:`options.${axis}`,label:AXIS_LABELS[axis]??axis,options:unique(statusRows.flatMap(r=>r.optionAxes[axis]??(r.fixedOptions[axis]!=null?[option(r.fixedOptions[axis],axis==="preset"?`方式 ${r.fixedOptions[axis].split("-").at(-1)}`:optionLabel(axis,r.fixedOptions[axis]))]:[])))});
  const candidates=statusRows.filter(r=>Object.entries(r.fixedOptions).every(([k,v])=>!chosen.options?.[k]||chosen.options[k]===v));
  return {definition,fields,variants:candidates,chanceEnabled:candidates.some(r=>r.chanceEnabled)};
}
