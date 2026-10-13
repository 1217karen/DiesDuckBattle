// Only featuredBattleId is edited. Favorites and battle records are read-only here.
export function createProfileBattleController({ storage, battles, service, profile, changed = () => {}, updated = () => {} }) {
  let generation = 0, identity = null;
  const state = { active: false, busy: false, saving: false, blocked: true, unavailable: false,
    original: null, selected: null, records: [], page: 1, totalPages: 0, message: '' };
  const emit = () => changed({ ...structuredClone(state),
    canSave: state.active && !state.busy && !state.blocked && state.selected !== state.original });
  const fail = result => {
    state.message = result.status === 'conflict' ? '他の画面で更新されました。もう一度保存してください。'
      : result.status === 'save-unknown' ? '保存結果を確認できませんでした。ページを再読み込みしてください。'
      : result.message || '処理に失敗しました。';
    if (['session-changed', 'forbidden', 'not-signed-in', 'no-access', 'save-unknown'].includes(result.status)) state.blocked = true;
  };
  async function list(page, token) {
    let result;
    try { result = await battles.list({ page, pageSize: 30, order: 'desc', favoritesOnly: true, gameAccountId: profile.accountId }); }
    catch { result = { ok: false }; }
    if (token !== generation) return;
    state.busy = false;
    if (result.ok) {
      state.records = result.records; state.page = result.page; state.totalPages = result.totalPages;
      state.blocked = false; state.message = result.total === 0 ? 'お気に入り登録した戦闘がありません。' : '';
    } else {
      state.records = []; state.blocked = true;
      state.message = 'お気に入り一覧を取得できませんでした。閉じてから再度お試しください。';
    }
    emit();
  }
  return {
    async open() {
      if (profile.isOwner !== true || state.active || state.unavailable) return;
      const token = ++generation;
      Object.assign(state, { active: true, busy: true, blocked: true, original: null, selected: null,
        records: [], page: 1, totalPages: 0, message: '読み込み中…' });
      emit();
      let result;
      try { result = await storage.load({ gameAccountId: profile.accountId }); }
      catch { result = { ok: false, message: '設定を読み込めませんでした。' }; }
      if (token !== generation) return;
      if (!result.ok) { state.busy = false; fail(result); emit(); return; }
      identity = result.authUserId;
      state.original = state.selected = result.data.presentation.battler.profile.featuredBattleId;
      await list(1, token);
    },
    async page(page) {
      if (!state.active || state.busy || state.blocked || page < 1 || page > state.totalPages) return;
      const token = ++generation;
      state.busy = true; state.message = '読み込み中…'; emit();
      await list(page, token);
    },
    select(id) {
      if (!state.active || state.busy || state.blocked || !state.records.some(r => r.battleId === id)) return;
      state.selected = id; state.message = ''; emit();
    },
    cancel() {
      if (state.saving) return;
      ++generation; state.active = false; state.busy = false; emit();
    },
    sessionChanged(userId) {
      if (identity !== null && identity === userId) return;
      ++generation;
      Object.assign(state, { busy: false, saving: false, blocked: true, unavailable: true,
        records: [], message: 'ログイン状態が変わりました。ページを再読み込みしてください。' }); emit();
    },
    async clear() {
      if (!state.active || state.busy || state.blocked || state.original === null) return;
      state.selected = null; emit(); await this.save();
    },
    async save() {
      if (!state.active || state.busy || state.blocked || state.selected === state.original) return;
      const token = ++generation, selected = state.selected;
      state.busy = state.saving = true; state.message = '保存中…'; emit();
      let result;
      try {
        const latest = await storage.load({ gameAccountId: profile.accountId });
        if (token !== generation) return;
        if (!latest.ok) result = latest;
        else if (latest.authUserId !== identity) result = { ok: false, status: 'session-changed', message: 'ログイン状態が変わりました。ページを再読み込みしてください。' };
        else {
          const data = structuredClone(latest.data);
          data.presentation.battler.profile.featuredBattleId = selected;
          result = await storage.save(latest, data, { gameAccountId: profile.accountId });
        }
      } catch { result = { ok: false, status: 'save-unknown' }; }
      if (token !== generation) return;
      if (!result.ok) { state.busy = state.saving = false; fail(result); emit(); return; }
      state.original = selected;
      let refreshed;
      try { refreshed = await service.getProfile(profile.eno); } catch { refreshed = { ok: false }; }
      if (token !== generation) return;
      state.busy = state.saving = false;
      if (refreshed.ok && refreshed.profile.isOwner === true && refreshed.profile.accountId === profile.accountId) {
        updated(refreshed.profile); state.active = false; state.message = '保存しました。';
      } else {
        state.blocked = true;
        state.message = '保存しましたが表示を更新できませんでした。ページを再読み込みしてください。';
      }
      emit();
    },
  };
}
