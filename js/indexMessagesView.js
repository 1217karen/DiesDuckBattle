import { createIndexMessageService, HOME_MESSAGE_MAX, codePointLength, normalizeHomeMessage } from './indexMessageService.js';
import { FIXED_IMAGES, setImageFromCandidates } from './fixedImages.js';
import { menuModel } from './commonMenuModel.js';

export function mountIndexMessages(document, getClient) {
  const el = id => document.getElementById(id);
  const text = el('home-message'), edit = el('home-message-edit'), form = el('home-message-form');
  const input = el('home-message-input'), count = el('home-message-count'), save = el('home-message-save');
  const cancel = el('home-message-cancel'), status = el('home-message-status'), list = el('home-messages');
  let eno = null, revision = 0, service, current = '', saving = false;
  function validate() {
    const length = codePointLength(normalizeHomeMessage(input.value));
    count.textContent = `${length} / ${HOME_MESSAGE_MAX}`;
    input.setAttribute('aria-invalid', String(length > HOME_MESSAGE_MAX));
    save.disabled = saving || length > HOME_MESSAGE_MAX;
  }
  function close() { form.hidden = true; text.hidden = false; edit.hidden = false; input.value = current; status.textContent = ''; }
  edit.addEventListener('click', () => {
    if (edit.disabled) return;
    input.value = current; form.hidden = false; text.hidden = true; edit.hidden = true;
    status.textContent = ''; validate(); input.focus();
  });
  input.addEventListener('input', validate);
  cancel.addEventListener('click', () => { if (!saving) { close(); edit.focus(); } });
  form.addEventListener('submit', async event => {
    event.preventDefault(); validate(); if (save.disabled || !service) return;
    const version = revision; saving = true; validate(); input.disabled = true; cancel.disabled = true; status.textContent = '保存中…';
    const result = await service.save(input.value);
    if (version !== revision) return;
    saving = false; input.disabled = false; cancel.disabled = false; validate();
    if (!result.ok) { status.textContent = result.message; return; }
    current = result.message; text.textContent = current || 'ひとことはまだありません。'; close(); edit.focus();
  });
  function renderOthers(rows) {
    list.replaceChildren(...rows.map(row => {
      const li = document.createElement('li'); li.className = 'home__voice-row';
      const iconLink = document.createElement('a'); iconLink.href = `profile.html?eno=${encodeURIComponent(row.eno)}`;
      iconLink.setAttribute('aria-label', `${row.battlerName}のプロフィール`);
      const img = document.createElement('img'); img.className = 'home__avatar'; img.alt = ''; img.width = 60; img.height = 60;
      setImageFromCandidates(img,[row.defaultIconUrl],FIXED_IMAGES.battlerIcon); iconLink.append(img);
      const body = document.createElement('div'); body.className = 'home__voice-body';
      const identity = document.createElement('a'); identity.className = 'home__identity'; identity.href = iconLink.href;
      identity.textContent = `ENo.${row.eno}｜${row.battlerName}`;
      const message = document.createElement('p'); message.textContent = row.message;
      body.append(identity,message); li.append(iconLink,body); return li;
    }));
    el('home-messages-status').textContent = rows.length ? '' : 'ひとことはまだありません。';
  }
  return { update(state) {
    const next = state.ready ? menuModel(state).currentAccount?.eno ?? null : null;
    if (next === eno) return;
    eno = next; const version = ++revision; service?.invalidate(); service = null;
    current = ''; saving = false; input.disabled = false; cancel.disabled = false; close(); edit.disabled = true;
    list.replaceChildren(); text.textContent = next ? '読み込み中…' : '';
    el('home-messages-status').textContent = text.textContent;
    if (!next) return;
    void (async () => {
      try {
        const client = await getClient(); if (version !== revision) return;
        service = createIndexMessageService(client,next);
        const result = await service.load(); if (version !== revision) return;
        if (!result.ok) throw new Error('Load failed');
        current = result.ownMessage; text.textContent = current || 'ひとことはまだありません。'; edit.disabled = false;
        renderOthers(result.others);
      } catch {
        if (version !== revision) return;
        text.textContent = 'ひとことを読み込めませんでした。'; el('home-messages-status').textContent = text.textContent;
      }
    })();
  }};
}
