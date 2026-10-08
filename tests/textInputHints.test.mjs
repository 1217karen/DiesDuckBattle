import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { BATTLER_NAME_MAX, codePointLength } from '../js/nameValidation.js';
import { PROFILE_MESSAGE_MAX, BATTLER_PROFILE_MAX, DUCK_PROFILE_MAX, profileTextError } from '../js/profileTextValidation.js';
import { authMarkup } from '../js/authMarkup.js';

const source = await readFile(new URL('../js/characterPage.js', import.meta.url), 'utf8');
const editorSource = source.slice(source.indexOf('function profileTextEditor('), source.indexOf('function renderBattlerProfile('));
function editor({ value = '', limit, label, singleLine = false }) {
  const make = tag => ({ tag, children: [], attributes: {}, handlers: {}, value: '',
    append(...items) { this.children.push(...items); },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.handlers[name] = callback; } });
  const document = { createElement: make, createTextNode: text => ({ text }) };
  let saved = value, dirty = 0, validations = 0, toolbarChange;
  const context = { document, profileTextError, codePointLength,
    setDirty() { dirty++; }, updateValidation() { validations++; },
    createQuoteToolbar(input, change) { toolbarChange = change; return make('toolbar'); } };
  vm.createContext(context);
  vm.runInContext(editorSource, context);
  const root = context.profileTextEditor(label, value, text => { saved = text; }, limit, label + 'を入力', singleLine);
  const input = root.children[0].children[1], count = root.children.find(el => el.className === 'profile-text-count');
  return { root, input, count, saved: () => saved, dirty: () => dirty, validations: () => validations,
    type(text) { input.value = text; input.handlers.input(); },
    decorate(text) { input.value = text; toolbarChange(text); } };
}

for (const [label, limit] of [['バトラープロフィール', BATTLER_PROFILE_MAX], ['アヒルプロフィール', DUCK_PROFILE_MAX]]) {
  test(label + ': counter uses code points on load, input, toolbar and clearing without changing validation', () => {
    const view = editor({ label, limit, value: 'あ😀\n' });
    assert.equal(view.input.placeholder, `${label}を入力（最大${limit}文字）`);
    assert.equal(view.count.textContent, `3 / ${limit}`);
    assert.equal(view.dirty(), 0); assert.equal(view.validations(), 0);
    view.type('😀'.repeat(limit));
    assert.equal(view.count.textContent, `${limit} / ${limit}`);
    assert.equal(view.input.attributes['aria-invalid'], 'false');
    view.type('😀'.repeat(limit + 1));
    assert.equal(view.count.textContent, `${limit + 1} / ${limit}`);
    assert.equal(view.input.attributes['aria-invalid'], 'true');
    assert.equal(view.saved(), '😀'.repeat(limit + 1));
    view.decorate('<b>😀</b>');
    assert.equal(view.count.textContent, `${codePointLength('<b>😀</b>')} / ${limit}`);
    view.type(''); assert.equal(view.count.textContent, `0 / ${limit}`);
    assert.equal(view.input.attributes['aria-invalid'], 'false');
    assert.equal(view.input.maxLength, undefined);
  });
}

test('profile message has only a limit placeholder; Battler name hints share the validation constant', () => {
  const view = editor({ label: 'プロフィールメッセージ', limit: PROFILE_MESSAGE_MAX, singleLine: true });
  assert.equal(view.input.placeholder, `プロフィールメッセージを入力（最大${PROFILE_MESSAGE_MAX}文字）`);
  assert.equal(view.count, undefined);
  assert.ok(authMarkup.includes(`placeholder="バトラー名を入力（最大${BATTLER_NAME_MAX}文字）"`));
  assert.match(source, /battlerNameInput\.placeholder = `バトラー名を入力（最大\$\{BATTLER_NAME_MAX\}文字）`/);
});
