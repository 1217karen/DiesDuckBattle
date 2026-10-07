import { createEmptyBattlerProfile, createEmptyDuckProfile } from '../js/playerPresentationModel.js';
import { a, da } from './onlineSelectFixture.mjs';
// Known saved selections, including retained clear-scope and legacy exact-face options.
export const profileOptionSelections = [
  ['A', 'direction', { triggerId: 'exact:1', effects: [{ effectId: 'change-ap', targetId: 'self', options: { direction: 'increase', amount: 'amount-1' } }] }],
  ['B', 'activation', { type: 'event', triggerId: 'after-hit', conditionId: 'always', effectId: 'grant-status', targetId: 'enemy', statusId: 'crack', options: { activation: 'guaranteed' } }],
  ['C', 'direction', { mode: 'normal', structure: { kind: 'flat', effects: [{ effectId: 'change-at', targetId: 'self', options: { direction: 'increase', amount: 'turnATAmount-2', duration: 'turnCount-2' } }] } }],
  ['C', 'scope', { mode: 'normal', structure: { kind: 'flat', effects: [{ effectId: 'clear-status', targetId: 'self', statusId: '@debuff', options: { scope: 'group' } }] } }],
  ['B', 'preset', { type: 'event', triggerId: 'phase-end', conditionId: 'always', effectId: 'ap-with-hp', targetId: 'self', options: { preset: 'ap-up-cost-5' } }],
  ['A', 'diceAction', { triggerId: 'exact:1', effects: [{ effectId: 'cancel-dice-effect', targetId: 'self', options: { diceAction: '1' } }] }],
];
export function profileFixture() {
  const { text, theme, message, messageTail } = createEmptyBattlerProfile();
  const skill = () => ({ selection: null, label: { name: '', ruby: '' } });
  const side = () => ({ eno: '1', battlerName: 'Battler', duckName: 'Duck', battlerDefaultIconUrl: '', duckIconUrl: '' });
  return { profileVersion: 2, accountId: a, eno: '1', isOwner: false,
    battler: { name: 'Name', standingImageUrl: '', defaultIconUrl: '', profileIcons: [{ slot: 1, url: '' }, { slot: 3, url: 'three.png' }],
      profile: { text, theme, message, messageTail }, skills: { B: skill(), D: skill() } },
    duck: { id: da, name: 'Duck', iconUrl: '', profile: createEmptyDuckProfile(), stats: { AT: 0, DF: 5, SP: null }, skills: { A: skill(), C: skill() } },
    featuredBattle: { battleId: a, battleNo: '9007199254740993', dateISO: '2026-10-05T00:00:00+00:00', result: 'draw', p1: side(), p2: side() } };
}
