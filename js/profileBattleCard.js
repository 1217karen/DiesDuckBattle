import { FIXED_IMAGES, setImageWithFallback } from './fixedImages.js';

// Display only. History summaries nest icons in presentation; public profiles flatten them.
export function renderProfileBattleCard(document, battle, { history = false, current = false, compact = false } = {}) {
  const el = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const card = el('span', 'profile-battle-card');
  // Keep battle number/date in the selection dialog, not on the published profile card.
  if (!compact) {
    const meta = el('span', 'profile-battle-meta');
    meta.append(el('span', '', `Battle No.${battle.battleNo}`), el('span', '', new Date(battle.dateISO).toLocaleString('ja-JP')));
    if (current) meta.append(el('strong', 'profile-battle-current', '現在掲載中'));
    card.append(meta);
  }
  const row = el('span', 'profile-battle-match');
  const side = key => {
    const player = battle[key.toLowerCase()], icons = history ? player.presentation : player;
    const group = el('span', `profile-battle-side profile-battle-${key.toLowerCase()}`);
    group.append(el('strong', 'profile-battle-eno', `${key} / ENo.${player.eno}`));
    const people = el('span', 'profile-battle-people');
    for (const [name, url, fallback, kind] of [
      [player.battlerName, icons?.battlerDefaultIconUrl, FIXED_IMAGES.battlerIcon, 'バトラー'],
      [player.duckName, icons?.duckIconUrl, FIXED_IMAGES.duckIcon, 'アヒル'],
    ]) {
      const person = el('span', 'profile-battle-person'), img = el('img', 'profile-battle-icon');
      img.alt = `${key} ${kind}: ${name ?? ''}`;
      setImageWithFallback(img, url, fallback);
      person.append(img, el('span', 'profile-battle-name', name ?? '')); people.append(person);
    }
    group.append(people); return group;
  };
  const mid = el('span', 'profile-battle-mid');
  for (const key of ['P1', 'P2']) {
    const outcome = battle.result === 'draw' ? 'DRAW' : battle.result === `${key}_win` ? 'WIN' : 'LOSE';
    const badge = el('span', `profile-battle-badge profile-battle-${outcome.toLowerCase()} profile-battle-badge-${key.toLowerCase()}`, outcome);
    badge.setAttribute('aria-label', `${key} ${outcome}`); mid.append(badge);
    if (key === 'P1') mid.append(el('span', 'profile-battle-vs', 'VS'));
  }
  row.append(side('P1'), mid, side('P2')); card.append(row); return card;
}
