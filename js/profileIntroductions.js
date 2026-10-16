import { createProfileIntroductionService } from './profileIntroductionService.js';
import { createProfileIntroductionController } from './profileIntroductionController.js';
import { renderQuoteRichText } from './quoteRichText.js';
import { createQuoteToolbar } from './quoteRichTextToolbar.js';
import { createIconPicker } from './iconPicker.js';
import { createImageValidation } from './characterImageValidation.js';
import { FIXED_IMAGES, setImageFromCandidates } from './fixedImages.js';
import { THEME_KEYS } from './profileThemeController.js';
import { accountSwitchBlock } from './accountChangeGuard.js';
import { showToast } from './toast.js';

export function renderIntroduction(document, row) {
  const card = document.createElement('article'); card.className = 'profile-introduction';
  for (const key of THEME_KEYS) card.style.setProperty(`--intro-${key}`, row.author.theme[key]);
  const header = document.createElement('div'); header.className = 'introduction-author';
  const icon = document.createElement('img'); icon.alt = `${row.author.name}のアイコン`; icon.width = icon.height = 60;
  setImageFromCandidates(icon, [row.author.iconUrl, row.author.defaultIconUrl], FIXED_IMAGES.battlerIcon);
  const link = document.createElement('a'); link.href = `profile.html?eno=${encodeURIComponent(row.author.eno)}`;
  link.textContent = `ENo.${row.author.eno} / ${row.author.name}`;
  header.append(icon, link);
  const body = document.createElement('div'); body.className = 'introduction-body profile-rich-text';
  body.innerHTML = renderQuoteRichText(row.body); card.append(header, body);
  if (row.imageUrl) {
    const image = document.createElement('img'); image.className = 'introduction-image'; image.alt = '紹介文画像';
    image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.src = row.imageUrl;
    card.append(image);
  }
  return card;
}

export function mountProfileIntroductions({ document, main, profile, client,
  service = createProfileIntroductionService(client), notify = showToast }) {
  const el = (tag, cls = '', text) => {
    const n = document.createElement(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n;
  };
  const button = text => { const n = el('button', '', text); n.type = 'button'; return n; };
  const section = el('details', 'profile-card profile-introductions');
  const summary = el('summary', '', '紹介文'), status = el('p', 'introduction-status'), list = el('div', 'introduction-list');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const trigger = button('紹介文を書く'); trigger.hidden = true;
  const form = el('div', 'introduction-editor'); form.hidden = true;
  const fieldset = el('fieldset');
  const legend = el('legend', '', '紹介文の編集');
  const bodyLabel = el('label', '', '本文（最大500文字・装飾タグ込み）'); bodyLabel.htmlFor = 'introduction-body';
  const body = el('textarea'); body.id = bodyLabel.htmlFor; body.rows = 7;
  body.setAttribute('aria-describedby', 'introduction-count');
  const count = el('p'); count.id = 'introduction-count'; count.setAttribute('aria-live', 'polite');
  const toolbar = createQuoteToolbar(body, value => controller.change('body', value), document, { ariaLabel: '紹介文の文字装飾' });
  const iconButton = button('アイコンを選択'), iconPreview = el('img', 'introduction-icon-preview'); iconPreview.alt = '選択中のアイコン';
  iconPreview.width = iconPreview.height = 60;
  const imageLabel = el('label', '', '紹介文画像URL（任意・最大480×480px）'); imageLabel.htmlFor = 'introduction-image-url';
  const imageUrl = el('input'); imageUrl.id = imageLabel.htmlFor; imageUrl.type = 'url'; imageUrl.maxLength = 2048;
  imageUrl.setAttribute('aria-describedby', 'introduction-image-status');
  const imageStatus = el('p'); imageStatus.id = 'introduction-image-status'; imageStatus.setAttribute('role', 'status');
  const imagePreview = el('div', 'introduction-image-preview');
  const actions = el('div', 'introduction-actions'), cancel = button('キャンセル'), save = button('保存'); actions.append(cancel, save);
  fieldset.append(legend, bodyLabel, toolbar, body, count, iconPreview, iconButton, imageLabel, imageUrl, imageStatus, imagePreview);
  form.append(fieldset, el('p', '', '本文を空欄にして保存すると、紹介文を削除できます。'), actions);
  section.append(summary, status, list, trigger, form); main.insertBefore(section, main.querySelector('.profile-pl-name'));
  const dialog = el('dialog', 'profile-battle-editor introduction-confirm'); dialog.setAttribute('aria-labelledby', 'introduction-confirm-title');
  const confirmTitle = el('h2'); confirmTitle.id = 'introduction-confirm-title';
  const confirmActions = el('div', 'introduction-actions'), no = button('キャンセル'), yes = button('保存する');
  confirmActions.append(no, yes); dialog.append(confirmTitle, confirmActions); document.body.append(dialog);
  const iconDialog = el('dialog', 'profile-battle-editor introduction-icon-dialog'); iconDialog.setAttribute('aria-labelledby', 'introduction-icon-title');
  const iconTitle = el('h2', '', '投稿者のアイコン'); iconTitle.id = 'introduction-icon-title';
  const iconList = el('div', 'introduction-icon-list'), iconClose = button('閉じる');
  iconDialog.append(iconTitle, iconList, iconClose); document.body.append(iconDialog);
  const picker = createIconPicker({ dialog: iconDialog, list: iconList, closeButton: iconClose });
  let state, lastRecords, lastImageUrl, lastIcon, wasActive = false;
  const validate = createImageValidation('cutin', image => controller.imageChanged(image));
  function previewImage(url) {
    const request = validate(url); imagePreview.replaceChildren();
    if (!url.trim()) return;
    const img = el('img', 'introduction-image'); img.alt = '紹介文画像のプレビュー'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => request.load(img.naturalWidth, img.naturalHeight));
    img.addEventListener('error', () => request.error()); img.src = url; imagePreview.append(img);
  }
  const controller = createProfileIntroductionController({ service, targetId: profile.accountId,
    saved: deleted => notify({ kind: 'success', message: deleted ? '紹介文を削除しました。' : '紹介文を保存しました。' }),
    changed: next => {
      state = next; summary.textContent = `紹介文${next.loaded ? `（${next.records.length}件）` : ''}`;
      status.textContent = next.message;
      if (JSON.stringify([next.loaded, next.records]) !== lastRecords) {
        lastRecords = JSON.stringify([next.loaded, next.records]); list.replaceChildren(...next.records.map(row => renderIntroduction(document, row)));
        if (next.loaded && !next.records.length) list.append(el('p', 'profile-empty', 'まだ紹介文はありません。'));
      }
      trigger.hidden = !next.canWrite || next.blocked || !next.loaded;
      trigger.disabled = next.busy || next.active;
      trigger.textContent = next.hasOwn ? '紹介文を編集する' : '紹介文を書く';
      form.hidden = !next.active; fieldset.disabled = next.busy || next.blocked || !!next.confirmation;
      if (body.value !== next.draft.body) body.value = next.draft.body;
      if (imageUrl.value !== next.draft.imageUrl) imageUrl.value = next.draft.imageUrl;
      const length = [...next.draft.body].length;
      count.textContent = `${length} / 500文字${length > 500 ? ' — 500文字以内で入力してください。' : ''}`;
      body.setAttribute('aria-invalid', String(length > 500));
      imageStatus.textContent = next.image.message; imageUrl.setAttribute('aria-invalid', String(next.image.status === 'invalid'));
      save.disabled = !next.canSave; cancel.disabled = next.saving;
      if (next.active && next.icons) {
        const slot = next.draft.iconSlot, urls = next.icons;
        const selected = slot === null ? '' : urls.iconSlots[slot - 1];
        const signature = JSON.stringify([selected, urls.defaultIconUrl]);
        if (lastIcon !== signature) { lastIcon = signature; setImageFromCandidates(iconPreview, [selected?.trim() ? selected : urls.defaultIconUrl, urls.defaultIconUrl], FIXED_IMAGES.battlerIcon); }
      }
      if (next.confirmation && !dialog.open) {
        confirmTitle.textContent = next.confirmation === 'delete' ? '本文が白紙のため紹介文は削除されます。よろしいですか？' : '紹介文を保存します。よろしいですか？';
        yes.textContent = next.confirmation === 'delete' ? '削除する' : '保存する'; dialog.showModal(); no.focus();
      } else if (!next.confirmation && dialog.open) { dialog.close(); (next.active ? save : trigger).focus(); }
      no.disabled = yes.disabled = next.saving;
      if (wasActive && !next.active) { picker.close(); trigger.focus(); }
      wasActive = next.active;
      // Set the key before validation emits another state.
      if (next.active && lastImageUrl !== next.draft.imageUrl) { lastImageUrl = next.draft.imageUrl; previewImage(lastImageUrl); }
    },
  });
  trigger.addEventListener('click', () => { lastImageUrl = undefined; void controller.open().then(() => { if (!state.blocked) body.focus(); }); });
  body.addEventListener('input', () => controller.change('body', body.value));
  imageUrl.addEventListener('input', () => controller.change('imageUrl', imageUrl.value.trim()));
  iconButton.addEventListener('click', () => picker.open({ ...state.icons, selectedSlot: state.draft.iconSlot, select: slot => controller.change('iconSlot', slot) }));
  cancel.addEventListener('click', () => controller.cancel()); save.addEventListener('click', () => controller.requestSave());
  no.addEventListener('click', () => controller.cancelConfirmation()); yes.addEventListener('click', () => { void controller.confirm(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); controller.cancelConfirmation(); });
  const beforeUnload = event => { if (state?.dirty || state?.saving) { event.preventDefault(); event.returnValue = ''; } };
  document.defaultView?.addEventListener('beforeunload', beforeUnload);
  const subscription = client.auth.onAuthStateChange?.((event, session) => {
    if (!['INITIAL_SESSION', 'TOKEN_REFRESHED'].includes(event)) { picker.close(); controller.sessionChanged(session?.user?.id ?? null); }
  });
  const stopGuard = client.beforeAccountChange?.(({ action } = {}) => {
    const blocked = accountSwitchBlock(action, { busy: state.busy, dirty: state.dirty });
    if (blocked) { status.textContent = blocked.message; return blocked; }
    return !state.busy && (!state.dirty || globalThis.confirm('未保存の紹介文を破棄してアカウントを変更しますか？'));
  });
  // Keep guards installed over BFCache restoration, just like the page's fixed account client.
  const dispose = () => { stopGuard?.(); subscription?.data?.subscription?.unsubscribe(); document.defaultView?.removeEventListener('beforeunload', beforeUnload); dialog.remove(); iconDialog.remove(); };
  const ready = controller.load().catch(() => { status.textContent = '紹介文を読み込めませんでした。ページを再読み込みしてください。'; });
  return { controller, section, trigger, form, body, count, imageUrl, dialog, yes, no, ready, dispose };
}
