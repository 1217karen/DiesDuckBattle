import { createOnlinePlayerStorage } from './onlinePlayerStorage.js';
import { createProfileThemeController, THEME_KEYS, isThemeColor, applyProfileTheme } from './profileThemeController.js';
import { showToast } from './toast.js';

export function mountProfileThemeEditor({ document, header, profile, client, storage = createOnlinePlayerStorage(client), notify = showToast }) {
  if (profile.isOwner !== true) return null;
  const element = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
  const button = text => { const node = element('button', text); node.type = 'button'; return node; };
  const trigger = button('🎨'); trigger.className = 'profile-theme-trigger'; trigger.setAttribute('aria-label', 'プロフィールカラーを編集');
  const dialog = element('dialog'); dialog.className = 'profile-theme-editor'; dialog.setAttribute('aria-labelledby', 'profile-theme-title');
  const heading = element('h2', 'プロフィールカラー'); heading.id = 'profile-theme-title';
  const status = element('p'); status.id = 'profile-theme-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const fields = {};
  dialog.append(heading);
  THEME_KEYS.forEach((key, index) => {
    const row = element('div'); row.className = 'profile-theme-field';
    const label = element('label', ['背景', 'パネル', '文字', 'アクセント'][index]); label.htmlFor = `profile-theme-${key}`;
    const picker = element('input'); picker.type = 'color'; picker.setAttribute('aria-label', `${label.textContent}のカラーピッカー`);
    const hex = element('input'); hex.type = 'text'; hex.id = label.htmlFor; hex.spellcheck = false; hex.setAttribute('aria-describedby', status.id);
    picker.addEventListener('input', () => controller.change(key, picker.value));
    hex.addEventListener('input', () => controller.change(key, hex.value));
    row.append(label, picker, hex); dialog.append(row); fields[key] = { picker, hex };
  });
  const presets = element('div'); presets.className = 'profile-theme-actions';
  const light = button('ライト'), dark = button('ダーク'); presets.append(light, dark);
  const actions = element('div'); actions.className = 'profile-theme-actions';
  const cancel = button('キャンセル'), save = button('保存'); actions.append(cancel, save);
  dialog.append(presets, status, actions); header.append(trigger); document.body.append(dialog);
  const controller = createProfileThemeController({ storage, gameAccountId: profile.accountId,
    preview: theme => applyProfileTheme(document, theme),
    changed: state => {
      for (const key of THEME_KEYS) {
        const { picker, hex } = fields[key], value = state.draft[key] ?? '';
        hex.value = value; hex.setAttribute('aria-invalid', String(!!state.original && !isThemeColor(value)));
        if (isThemeColor(value)) picker.value = value;
        picker.disabled = hex.disabled = state.busy || state.blocked;
      }
      light.disabled = dark.disabled = state.busy || state.blocked; save.disabled = !state.canSave;
      cancel.disabled = state.saving; status.textContent = state.message;
      if (!state.active && dialog.open) { dialog.close(); trigger.focus(); }
    }, saved: () => notify({ kind: 'success', message: '保存しました。' }),
  });
  trigger.addEventListener('click', () => { dialog.showModal(); void controller.open(); });
  light.addEventListener('click', () => controller.preset('light'));
  dark.addEventListener('click', () => controller.preset('dark'));
  cancel.addEventListener('click', () => controller.cancel());
  dialog.addEventListener('cancel', event => { event.preventDefault(); controller.cancel(); });
  save.addEventListener('click', () => { void controller.save(); });
  const subscription = client.auth.onAuthStateChange?.((event, session) => {
    if (event !== 'INITIAL_SESSION' && event !== 'TOKEN_REFRESHED') controller.sessionChanged(session?.user?.id ?? null);
  });
  const dispose = () => subscription?.data?.subscription?.unsubscribe();
  document.defaultView?.addEventListener('pagehide', dispose, { once: true });
  return { controller, trigger, dialog, fields, light, dark, cancel, save, status, dispose };
}
