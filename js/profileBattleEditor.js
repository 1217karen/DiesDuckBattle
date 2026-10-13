import { renderProfileBattleCard } from './profileBattleCard.js';
import { createOnlinePlayerStorage } from './onlinePlayerStorage.js';
import { createBattleResultStorage } from './battleResultStorage.js';
import { createOnlineProfileService } from './onlineProfileService.js';
import { createProfileBattleController } from './profileBattleController.js';
import { renderFeaturedBattle } from './profileView.js';

export function mountProfileBattleEditor({ document, container, profile, client,
  storage = createOnlinePlayerStorage(client), battles = createBattleResultStorage(client), service = createOnlineProfileService(client) }) {
  if (profile.isOwner !== true) return null;
  const el = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  const button = text => { const n = el('button', text); n.type = 'button'; return n; };
  const trigger = button('設定'); trigger.className = 'profile-battle-trigger'; trigger.setAttribute('aria-label', 'お気に入りバトルの掲載設定');
  const dialog = el('dialog'); dialog.className = 'profile-battle-editor'; dialog.setAttribute('aria-labelledby', 'profile-battle-title');
  const title = el('h2', '掲載するお気に入りバトル'); title.id = 'profile-battle-title';
  const status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const list = el('div'); list.className = 'profile-battle-list';
  const pager = el('div'); pager.className = 'profile-battle-actions';
  const prev = button('前の30件'), next = button('次の30件'), pageInfo = el('span'); pager.append(prev, pageInfo, next);
  const actions = el('div'); actions.className = 'profile-battle-actions';
  const cancel = button('キャンセル'), clear = button('掲載解除'), save = button('保存'); actions.append(cancel, clear, save);
  dialog.append(title, status, list, pager, actions); container.children[0].append(trigger); document.body.append(dialog);
  let currentPage = 1;
  const controller = createProfileBattleController({ storage, battles, service, profile,
    changed: state => {
      currentPage = state.page;
      trigger.hidden = state.unavailable;
      list.replaceChildren();
      for (const record of state.records) {
        const label = el('label'); label.className = 'profile-battle-option';
        const input = el('input'); input.type = 'radio'; input.name = 'profile-featured-battle'; input.value = record.battleId;
        input.checked = state.selected === record.battleId; input.disabled = state.busy || state.blocked;
        input.addEventListener('change', () => {
          controller.select(record.battleId);
          Array.from(list.children).find(row => row.children[0].value === record.battleId)?.children[0].focus();
        });
        label.append(input, renderProfileBattleCard(document, record, { history: true, current: state.original === record.battleId })); list.append(label);
      }
      status.textContent = state.message;
      pageInfo.textContent = `${state.page} / ${Math.max(1, state.totalPages)}`;
      prev.disabled = state.busy || state.blocked || state.page <= 1;
      next.disabled = state.busy || state.blocked || state.page >= state.totalPages;
      save.disabled = !state.canSave; clear.disabled = state.busy || state.blocked || state.original === null;
      cancel.disabled = state.saving;
      if (!state.active && dialog.open) { dialog.close(); trigger.focus(); }
    },
    updated: refreshed => {
      const card = renderFeaturedBattle(document, refreshed);
      container.replaceChildren(...card.children); container.children[0].append(trigger);
    },
  });
  trigger.addEventListener('click', () => { dialog.showModal(); void controller.open(); });
  prev.addEventListener('click', () => { void controller.page(currentPage - 1); });
  next.addEventListener('click', () => { void controller.page(currentPage + 1); });
  cancel.addEventListener('click', () => controller.cancel());
  dialog.addEventListener('cancel', event => { event.preventDefault(); controller.cancel(); });
  save.addEventListener('click', () => { void controller.save(); });
  clear.addEventListener('click', () => { void controller.clear(); });
  const subscription = client.auth.onAuthStateChange?.((event, session) => {
    if (!['INITIAL_SESSION', 'TOKEN_REFRESHED'].includes(event)) controller.sessionChanged(session?.user?.id ?? null);
  });
  const dispose = () => subscription?.data?.subscription?.unsubscribe();
  document.defaultView?.addEventListener('pagehide', dispose, { once: true });
  return { controller, trigger, dialog, status, list, prev, next, pageInfo, cancel, clear, save, dispose };
}
