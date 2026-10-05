export const THEME_KEYS = ['background', 'panel', 'text', 'accent'];
export const THEME_PRESETS = Object.freeze({
  light: Object.freeze({ background: '#DCEEF3', panel: '#FFFFFF', text: '#20282C', accent: '#4F91B3' }),
  dark: Object.freeze({ background: '#10161A', panel: '#182126', text: '#EDF2F4', accent: '#E0C45A' }),
});
export const isThemeColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function applyProfileTheme(document, theme) {
  for (const key of THEME_KEYS) if (isThemeColor(theme[key]))
    document.body.style.setProperty(`--profile-${key === 'background' ? 'bg' : key}`, theme[key]);
}

// This editor owns only four colors. Every save patches a fresh, authorized snapshot.
export function createProfileThemeController({ storage, gameAccountId, preview, changed = () => {}, saved = () => {} }) {
  let generation = 0, identity = null;
  const state = { active: false, busy: false, saving: false, blocked: true, original: null, draft: {}, message: '' };
  const valid = () => THEME_KEYS.every(key => isThemeColor(state.draft[key]));
  const dirty = () => state.original && THEME_KEYS.some(key => state.original[key].toLowerCase() !== state.draft[key]?.toLowerCase());
  const emit = () => changed({ ...structuredClone(state), canSave: !state.busy && !state.blocked && valid() && !!dirty() });
  const fail = result => {
    state.message = result.status === 'conflict' ? '他の画面で更新されました。もう一度保存してください。'
      : result.status === 'save-unknown' ? '保存結果を確認できませんでした。ページを再読み込みして確認してください。'
      : result.message || '処理に失敗しました。';
    if (['session-changed', 'forbidden', 'not-signed-in', 'no-access', 'save-unknown'].includes(result.status)) state.blocked = true;
  };
  return {
    async open() {
      if (state.active) return;
      const token = ++generation;
      Object.assign(state, { active: true, busy: true, blocked: true, original: null, draft: {}, message: '読み込み中…' });
      identity = null; emit();
      let result;
      try { result = await storage.load({ gameAccountId }); } catch { result = { ok: false, message: '読み込めませんでした。' }; }
      if (token !== generation) return;
      state.busy = false;
      if (result.ok) {
        identity = result.authUserId;
        state.original = structuredClone(result.data.presentation.battler.profile.theme);
        state.draft = { ...state.original }; state.blocked = false; state.message = ''; preview(state.draft);
      } else fail(result);
      emit();
    },
    change(key, value) {
      if (!state.active || state.busy || state.blocked || !THEME_KEYS.includes(key)) return;
      state.draft[key] = value;
      state.message = valid() ? '' : '色は #RRGGBB の形式で入力してください。';
      preview(state.draft); emit();
    },
    preset(name) {
      if (!state.active || state.busy || state.blocked || !THEME_PRESETS[name]) return;
      state.draft = { ...THEME_PRESETS[name] }; state.message = ''; preview(state.draft); emit();
    },
    cancel() {
      // A submitted write cannot be cancelled. Keep its outcome visible.
      if (state.saving) return;
      ++generation;
      if (state.original) preview(state.original);
      state.active = false; state.busy = false; emit();
    },
    sessionChanged(userId) {
      if (!state.active || (identity !== null && userId === identity)) return;
      ++generation; state.busy = false; state.saving = false; state.blocked = true;
      fail({ status: 'session-changed', message: 'ログイン状態が変わりました。ページを再読み込みしてください。' }); emit();
    },
    async save() {
      if (!state.active || state.busy || state.blocked || !valid() || !dirty()) return;
      const token = ++generation, theme = { ...state.draft };
      state.busy = true; state.saving = true; state.message = '保存中…'; emit();
      let result;
      try {
        const latest = await storage.load({ gameAccountId });
        if (token !== generation) return;
        if (!latest.ok) result = latest;
        else if (latest.authUserId !== identity) result = { ok: false, status: 'session-changed', message: 'ログイン状態が変わりました。ページを再読み込みしてください。' };
        else {
          const data = structuredClone(latest.data);
          data.presentation.battler.profile.theme = theme;
          result = await storage.save(latest, data, { gameAccountId });
        }
      } catch { result = { ok: false, status: 'save-unknown' }; }
      if (token !== generation) return;
      state.busy = false; state.saving = false;
      if (result.ok) {
        state.original = { ...theme }; state.active = false; state.message = '保存しました。';
        preview(theme); emit(); saved();
      } else { fail(result); emit(); }
    },
  };
}
