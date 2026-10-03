import test from 'node:test';
import assert from 'node:assert/strict';
import { battlerSummary, duckSummary } from '../js/selectState.js';
import { presentASkill } from '../js/aSkillPresentation.js';
import { presentCSkill } from '../js/cSkillPresentation.js';
import { bSentence } from '../js/bSkillPresentation.js';
import { createBSkillCatalog, getBSelectionDefinition } from '../js/bSkillCatalog.js';
import { migrateSelection } from '../js/selectionNormalization.js';
import { D_SKILL_OPTIONS } from '../js/dSkillCatalog.js';
import { listOpponents, getOpponent } from '../js/opponentSource.js';

test('SELECT A/C text matches the shared presenters and never includes the duck name', async () => {
  for (const ref of await listOpponents()) {
    const { build } = await getOpponent(ref.id);
    for (const duck of build.ducks) {
      const a = presentASkill(duck, duck.aSelection), c = presentCSkill(duck.cSelection);
      assert.equal(a.complete, true); assert.equal(c.complete, true);
      const before = structuredClone(duck), text = duckSummary(duck);
      assert.ok(text.includes(`A：${a.text}`)); assert.ok(text.includes(`C：${c.text}`));
      assert.ok(text.startsWith('AT ')); assert.deepEqual(duck, before);
      for (const selection of [null, {}, {effects: 'broken'}, {mode: 'unknown'}]) {
        const expected = selection === null ? '未設定' : '未完成・設定を確認してください';
        const invalid = duckSummary({...duck, aSelection: selection, cSelection: selection});
        assert.ok(invalid.includes(`A：${expected}`)); assert.ok(invalid.includes(`C：${expected}`));
      }
    }
  }
});

test('all B traits/events including each saved status use the shared sentence', () => {
  const catalog = createBSkillCatalog();
  const selections = catalog.traits.map(d => ({type:'trait', traitId:d.id, options:{}}));
  for (const d of catalog.events) {
    const statuses = d.optionAxes.statusId ? catalog.optionSets[d.optionAxes.statusId].map(o=>o.id) : [undefined];
    for (const statusId of statuses) selections.push({type:'event', triggerId:d.triggerId, conditionId:d.conditionId, effectId:d.effectId, options:statusId ? {statusId} : {}});
  }
  for (const selection of selections) {
    const expected = bSentence(getBSelectionDefinition(selection, catalog), selection.options.statusId);
    assert.ok(expected);
    for (const saved of [selection, migrateSelection('B', selection, catalog)]) {
      assert.equal(battlerSummary({bSelection:saved}).split('\n')[0], `B：${expected}`);
    }
  }
  for (const selection of [{}, {type:'event',triggerId:'bad'}, {...selections.find(s=>s.options.statusId),options:{statusId:'bad'}}])
    assert.match(battlerSummary({bSelection:selection}), /^B：未完成・設定を確認してください/);
});

test('SELECT D text uses the exact catalog label for all eight choices', () => {
  for (const d of D_SKILL_OPTIONS) assert.ok(battlerSummary({dSelection:{optionId:d.id}}).endsWith(`D：${d.label}`));
});

