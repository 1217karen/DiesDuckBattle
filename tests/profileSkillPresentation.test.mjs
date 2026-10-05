import test from 'node:test';
import assert from 'node:assert/strict';
import { presentProfileSkill } from '../js/profileSkillPresentation.js';
import { createASkillCatalog } from '../js/aSkillCatalog.js';
import { createBSkillCatalog } from '../js/bSkillCatalog.js';
import { createCSkillCatalog } from '../js/cSkillCatalog.js';
import { migrateSelection } from '../js/selectionNormalization.js';
import { presentCSkill } from '../js/cSkillPresentation.js';
import { D_SKILL_OPTIONS } from '../js/dSkillCatalog.js';

const ac = createASkillCatalog(), cc = createCSkillCatalog(), bc = createBSkillCatalog();
const a = (id, amount, triggerId='exact:1') => migrateSelection('A', {triggerId,effects:[{effectId:id,...(amount==null?{}:{amountOptionId:`amount-${amount}`})}]},ac);
const cLeaf = id => {const d=cc.effects.find(e=>e.id===id);return {effectId:id,options:Object.fromEntries(Object.entries(d.optionAxes).map(([k,set])=>[k,cc.optionSets[set][0].id]))};};
const flat = (id,mode='normal') => ({mode,structure:{kind:'flat',effects:[cLeaf(id)]}});
for(const category of ['A','B','C','D'])test(`${category} null and incomplete fallback`,()=>{
  assert.equal(presentProfileSkill(category,null),'未設定');
  for(const selection of [{},{optionId:'<script>bad</script>'},undefined])assert.equal(presentProfileSkill(category,selection),'設定未完了');
});
for(const trigger of ['exact:0','exact:1','gte:3','lte:4','all'])test(`A ${trigger} uses selection only, without dice/resources`,()=>{
  const s=a('ap-self-increase',1,trigger),before=structuredClone(s),text=presentProfileSkill('A',s);
  assert.match(text,/自分のAPを1増加する/);assert.doesNotMatch(text,/コスト|必要|〈AP|pt/);assert.deepEqual(s,before);
  assert.match(text,trigger==='all'?/全ての出目/:new RegExp(trigger.startsWith('gte')?'以上':trigger.startsWith('lte')?'以下':'出目'));
});
test('A direction and status are trusted metadata',()=>{
  assert.match(presentProfileSkill('A',a('ap-enemy-decrease',2)),/相手のAPを2減少する/);
  assert.match(presentProfileSkill('A',a('grant-crack-enemy',2)),/亀裂を2付与する/);
});
for(const [face,id,amount] of [[1,'cancel-dice1-ap'],[3,'cancel-dice3-heal'],[6,'reduce-dice6-recoil',3]])test(`A exact dice effect ${face} needs no actual dice`,()=>{
  assert.match(presentProfileSkill('A',a(id,amount,`exact:${face}`)),/ダイス効果/);
  assert.equal(presentProfileSkill('A',a(id,amount,'all')),'設定未完了');
});
test('A incomplete/unknown fields and IDs never become prose',()=>{
  for(const s of [a('ap-self-increase',1,'exact:99'),{triggerId:'all',effects:[]},
    {triggerId:'all',effects:[{effectId:'<img onerror=alert(1)>'}]},
    {triggerId:'all',effects:[{effectId:'change-ap',targetId:'self',options:{direction:'increase',amount:'bad'}}]},
    {triggerId:'all',effects:[{effectId:'change-ap',targetId:'self',options:{amount:'amount-1'}}]}])assert.equal(presentProfileSkill('A',s),'設定未完了');
});
test('B event, status and trait use validated catalog prose',()=>{
  const event=migrateSelection('B',{type:'event',triggerId:'after-hit',conditionId:'always',effectId:'enemy-debuff',options:{statusId:'crack'}},bc);
  assert.match(presentProfileSkill('B',event),/亀裂/);
  assert.notEqual(presentProfileSkill('B',{type:'trait',traitId:bc.traits[0].id,options:{}}),'設定未完了');
  event.statusId='unknown';assert.equal(presentProfileSkill('B',event),'設定未完了');
});
const cCases = [flat('damage-enemy'), flat('revive-self','special'),
  {mode:'normal',structure:{kind:'random',branches:[{effects:[cLeaf('damage-enemy')]},{effects:[cLeaf('heal-self')]}]}},
  {mode:'normal',structure:{kind:'hpCondition',thresholdOptionId:cc.optionSets.hpThreshold[0].id,branches:{met:{effects:[cLeaf('damage-enemy')]},unmet:{effects:[cLeaf('heal-self')]}}}}];
for(const s of cCases)test(`C ${s.mode}/${s.structure.kind} excludes cost without changing default output`,()=>{
  const p=presentCSkill(s),profile=presentProfileSkill('C',s);
  assert.equal(p.complete,true,JSON.stringify(p));assert.match(p.text,/^〈AP/);assert.doesNotMatch(profile,/〈AP|コスト|pt/);
  assert.equal(p.text,`〈AP${p.requiredAP}〉${profile}`);
  assert.equal(presentProfileSkill('C',migrateSelection('C',s,cc)),profile);
});
for(const option of D_SKILL_OPTIONS)test(`D ${option.id} trusted label`,()=>assert.equal(presentProfileSkill('D',{optionId:option.id}),option.label));
