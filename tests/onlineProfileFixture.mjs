import { createEmptyBattlerProfile, createEmptyDuckProfile } from '../js/playerPresentationModel.js';
import { a, da } from './onlineSelectFixture.mjs';
export function profileFixture() {
  const { text, theme } = createEmptyBattlerProfile();
  const skill = () => ({ selection: null, label: { name: '', ruby: '' } });
  const side = () => ({ eno: '1', battlerName: 'Battler', duckName: 'Duck', battlerDefaultIconUrl: '', duckIconUrl: '' });
  return { profileVersion: 1, accountId: a, eno: '1', isOwner: false,
    battler: { name: 'Name', standingImageUrl: '', defaultIconUrl: '', profileIcons: [{ slot: 1, url: '' }, { slot: 3, url: 'three.png' }],
      profile: { text, theme }, skills: { B: skill(), D: skill() } },
    duck: { id: da, name: 'Duck', iconUrl: '', profile: createEmptyDuckProfile(), stats: { AT: 0, DF: 5, SP: null }, skills: { A: skill(), C: skill() } },
    featuredBattle: { battleId: a, battleNo: '9007199254740993', dateISO: '2026-10-05T00:00:00+00:00', result: 'draw', p1: side(), p2: side() } };
}
