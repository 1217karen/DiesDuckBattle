import { introductionIsBlank, introductionImageUrlValid } from './profileIntroductionService.js';

export function createProfileIntroductionController({ service, targetId, changed = () => {}, saved = () => {} }) {
  let generation = 0, writer = null;
  const empty = () => ({ body: '', iconSlot: null, imageUrl: '' });
  const state = { records: [], loaded: false, busy: false, saving: false, active: false, blocked: false,
    canWrite: false, original: null, draft: empty(), icons: null, confirmation: '', message: '', image: { status: 'valid', message: '' } };
  const dirty = () => state.active && JSON.stringify(state.draft) !== JSON.stringify(state.original
    ? { body: state.original.body, iconSlot: state.original.iconSlot, imageUrl: state.original.imageUrl } : empty());
  const canSave = () => state.active && state.canWrite && !state.blocked && !state.busy && [...state.draft.body].length <= 500
    && (introductionIsBlank(state.draft.body) ? !!state.original : introductionImageUrlValid(state.draft.imageUrl)
      && ['valid', 'warning'].includes(state.image.status));
  const emit = () => changed({ ...structuredClone(state), dirty: dirty(), hasOwn: !!own(), canSave: canSave() });
  const own = () => state.records.find(r => r.author.accountId === writer?.account.id) ?? null;
  function fail(result) {
    state.message = result.message || '紹介文を読み込めませんでした。';
    if (['session-changed', 'not-signed-in', 'no-access', 'forbidden', 'save-unknown', 'conflict'].includes(result.status)) {
      state.blocked = true; state.confirmation = '';
    }
  }
  const controller = {
    snapshot: () => ({ ...structuredClone(state), dirty: dirty(), hasOwn: !!own(), canSave: canSave() }),
    async load() {
      const token = ++generation; state.busy = true; state.message = '紹介文を読み込み中…'; emit();
      const [list, scope] = await Promise.all([service.list(targetId), service.resolveWriter()]);
      if (token !== generation) return;
      state.busy = false;
      if (!list.ok) { fail(list); emit(); return; }
      state.records = list.records; state.loaded = true; state.message = '';
      writer = scope.ok ? scope : null;
      state.canWrite = !!writer && writer.account.id !== targetId;
      emit();
    },
    async open() {
      if (!state.canWrite || state.blocked || state.busy || state.active) return;
      const token = ++generation; state.active = true; state.busy = true; state.message = '投稿者設定を読み込み中…';
      state.original = own(); state.draft = state.original
        ? { body: state.original.body, iconSlot: state.original.iconSlot, imageUrl: state.original.imageUrl } : empty(); emit();
      const result = await service.loadWriter(writer.account.id);
      if (token !== generation) return;
      state.busy = false;
      if (!result.ok) { fail(result); state.blocked = true; emit(); return; }
      if (result.authUserId !== writer.authUserId || result.account.id !== writer.account.id) { controller.sessionChanged(); return; }
      const b = result.data.presentation.battler;
      state.icons = { defaultIconUrl: b.defaultIconUrl, iconSlots: b.iconSlots };
      state.message = ''; emit();
    },
    change(key, value) {
      if (!state.active || state.busy || state.blocked || state.confirmation || !['body', 'iconSlot', 'imageUrl'].includes(key)) return;
      state.draft[key] = value; state.message = ''; emit();
    },
    imageChanged(image) { state.image = image; emit(); },
    requestSave() {
      if (!canSave()) return;
      state.confirmation = introductionIsBlank(state.draft.body) ? 'delete' : 'save'; emit();
    },
    cancelConfirmation() { if (!state.saving) { state.confirmation = ''; emit(); } },
    cancel() {
      if (state.saving) return;
      ++generation; state.active = false; state.busy = false; state.confirmation = ''; state.draft = empty(); emit();
    },
    sessionChanged(userId) {
      if (writer && userId === writer.authUserId) return;
      ++generation; state.busy = state.saving = false; state.canWrite = false;
      fail({ status: 'session-changed', message: 'ログイン状態が変わりました。ページを再読み込みしてください。' }); emit();
    },
    async confirm() {
      if (!state.confirmation || !canSave()) return;
      const token = ++generation; state.busy = state.saving = true; state.message = '保存中…'; emit();
      const result = await service.save(writer, targetId, state.original, structuredClone(state.draft));
      if (token !== generation) return;
      state.confirmation = ''; state.saving = false;
      if (!result.ok) { state.busy = false; fail(result); emit(); return; }
      state.active = false; state.draft = empty();
      const list = await service.list(targetId);
      if (token !== generation) return;
      state.busy = false;
      if (list.ok) { state.records = list.records; state.message = ''; }
      else { state.blocked = true; state.message = '保存しましたが表示を更新できませんでした。ページを再読み込みしてください。'; }
      emit(); saved(result.deleted);
    },
  };
  emit(); return controller;
}
