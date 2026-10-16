import { accountSwitchBlock } from "./accountChangeGuard.js";
import { showToast } from "./toast.js";
import { createIndexMessageService, HOME_MESSAGE_MAX, codePointLength, normalizeHomeMessage } from './indexMessageService.js';
import { FIXED_IMAGES, setImageFromCandidates } from './fixedImages.js';
import { createIconPicker } from './iconPicker.js';
import { menuModel } from './commonMenuModel.js';

export function mountIndexMessages(document, getClient, notify = showToast, onOwnIconSlot = () => {}) {
  const el = id => document.getElementById(id);
  const text = el('home-message'), edit = el('home-message-edit'), form = el('home-message-form');
  const input = el('home-message-input'), count = el('home-message-count'), save = el('home-message-save');
  const cancel = el('home-message-cancel'), status = el('home-message-status'), list = el('home-messages');
  const iconButton = el('home-message-icon-button'), iconPreview = el('home-message-icon-preview');
  const picker = createIconPicker({dialog:el('home-icon-picker'),list:el('home-picker-list'),
    closeButton:el('home-picker-close'),document});
  let eno = null, revision = 0, service, current = '', saving = false, loading = false, accountVersion;
  let currentSlot = null, draftSlot = null, ownDefaultIconUrl = '', ownIconSlots = [];
  const availableSlot = slot => slot === null || (Number.isInteger(slot) && slot >= 1 && slot <= 10
    && typeof ownIconSlots[slot - 1] === 'string' && !!ownIconSlots[slot - 1].trim());
  const selectedUrl = slot => slot !== null && availableSlot(slot) ? ownIconSlots[slot - 1] : '';
  // Empty slots are not candidates: otherwise the shared image helper picks its fixed fallback first.
  const availableImageUrls = urls => urls.filter(url => typeof url === 'string' && !!url.trim());
  function previewIcon() {
    setImageFromCandidates(iconPreview,availableImageUrls([selectedUrl(draftSlot),ownDefaultIconUrl]),FIXED_IMAGES.battlerIcon);
  }
  function renderOwnMessage() {
    text.textContent = current || '右のペンマークからひとことを編集できます。';
    text.classList.toggle('is-placeholder', !current);
  }
  function validate() {
    const length = codePointLength(normalizeHomeMessage(input.value));
    count.textContent = String(length) + ' / ' + HOME_MESSAGE_MAX;
    input.setAttribute('aria-invalid', String(length > HOME_MESSAGE_MAX));
    save.disabled = saving || length > HOME_MESSAGE_MAX;
  }
  function close() {
    picker.close(); form.hidden = true; text.hidden = false; edit.hidden = false;
    input.value = current; draftSlot = currentSlot; status.textContent = '';
  }
  edit.addEventListener('click', () => {
    if (edit.disabled) return;
    input.value = current; draftSlot = currentSlot; previewIcon();
    form.hidden = false; text.hidden = true; edit.hidden = true;
    status.textContent = ''; validate(); input.focus();
  });
  iconButton.addEventListener('click', () => {
    if (iconButton.disabled || form.hidden || !service) return;
    picker.open({defaultIconUrl:ownDefaultIconUrl,iconSlots:ownIconSlots,selectedSlot:draftSlot,
      select:slot => { draftSlot = slot; previewIcon(); }});
  });
  input.addEventListener('input', validate);
  cancel.addEventListener('click', () => { if (!saving) { close(); edit.focus(); } });
  form.addEventListener('submit', async event => {
    event.preventDefault(); validate(); if (save.disabled || !service) return;
    if (!availableSlot(draftSlot)) { status.textContent = '選択したアイコンを使用できません。選び直してください。'; return; }
    const version = revision; saving = true; validate();
    input.disabled = true; iconButton.disabled = true; cancel.disabled = true; status.textContent = '保存中…';
    const result = await service.save(input.value, draftSlot);
    if (version !== revision) return;
    saving = false; input.disabled = false; iconButton.disabled = false; cancel.disabled = false; validate();
    if (!result.ok) { status.textContent = result.message; return; }
    current = result.message; currentSlot = result.iconSlot;
    onOwnIconSlot(currentSlot);
    renderOwnMessage(); close(); edit.focus();
    notify({ message: "ひとことを保存しました。", kind: "success" });
  });
  function renderOthers(rows) {
    list.replaceChildren(...rows.map(row => {
      const li = document.createElement('li'); li.className = 'home__voice-row';
      const iconLink = document.createElement('a'); iconLink.href = 'profile.html?eno=' + encodeURIComponent(row.eno);
      iconLink.setAttribute('aria-label', row.battlerName + 'のプロフィール');
      const img = document.createElement('img'); img.className = 'home__avatar'; img.alt = ''; img.width = 60; img.height = 60;
      setImageFromCandidates(img,availableImageUrls([row.iconUrl,row.defaultIconUrl]),FIXED_IMAGES.battlerIcon); iconLink.append(img);
      const body = document.createElement('div'); body.className = 'home__voice-body';
      const identity = document.createElement('a'); identity.className = 'home__identity'; identity.href = iconLink.href;
      identity.textContent = 'ENo.' + row.eno + '｜' + row.battlerName;
      const message = document.createElement('p'); message.textContent = row.message;
      body.append(identity,message); li.append(iconLink,body); return li;
    }));
    el('home-messages-status').textContent = rows.length ? '' : 'ひとことはまだありません。';
  }
  return { canLeave({ action } = {}) {
    const dirty = !form.hidden && (input.value !== current || draftSlot !== currentSlot);
    const blocked = accountSwitchBlock(action, { busy: saving, dirty });
    if (blocked) { status.textContent = blocked.message; return blocked; }
    return !saving && (!dirty || globalThis.confirm("未保存のひとことを破棄してアカウントを変更しますか？"));
  }, update(state) {
    // Preserve drafts across same-owner revalidation; stale requests remain rejected.
    if (!state.sessionKnown) {
      if (loading) { revision++; service?.invalidate(); service = null; eno = null; loading = false; }
      return;
    }
    const next = state.ready ? menuModel(state).currentAccount?.eno ?? null : null;
    if (next === eno && state.accountVersion === accountVersion) return;
    accountVersion = state.accountVersion;
    eno = next; const version = ++revision; service?.invalidate(); service = null;
    current = ''; currentSlot = null; draftSlot = null; ownDefaultIconUrl = ''; ownIconSlots = [];
    picker.close(); saving = false; input.disabled = false; iconButton.disabled = false; cancel.disabled = false;
    close(); edit.disabled = true; onOwnIconSlot(null);
    list.replaceChildren(); text.classList.remove('is-placeholder'); text.textContent = next ? '読み込み中…' : '';
    el('home-messages-status').textContent = text.textContent;
    if (!next) return;
    loading = true;
    void (async () => {
      try {
        const client = await getClient(); if (version !== revision) return;
        service = createIndexMessageService(client,next);
        const result = await service.load(); if (version !== revision) return;
        if (!result.ok) throw new Error('Load failed');
        ownDefaultIconUrl = result.ownDefaultIconUrl;
        ownIconSlots = result.ownIconSlots;
        currentSlot = availableSlot(result.ownIconSlot) ? result.ownIconSlot : null;
        draftSlot = currentSlot; onOwnIconSlot(currentSlot);
        current = result.ownMessage; renderOwnMessage(); edit.disabled = false;
        renderOthers(result.others);
      } catch {
        if (version !== revision) return;
        text.textContent = 'ひとことを読み込めませんでした。'; el('home-messages-status').textContent = text.textContent;
      } finally { if (version === revision) loading = false; }
    })();
  }};
}
