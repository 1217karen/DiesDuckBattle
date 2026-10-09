import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountDocumentTabs } from '../js/documentTabs.js';
import { authMarkup } from '../js/authMarkup.js';

test('legal tabs restore hashes and history and support keyboard wrapping', () => {
  for (const hash of ['', '#terms', '#privacy', '#unknown']) {
    const names = ['terms', 'privacy'], elements = new Map(), events = {};
    let focused;
    for (const name of names) for (const prefix of ['tab-', 'panel-']) {
      elements.set(prefix + name, { attrs: {}, events: {}, contains: () => false,
        setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, v) { this.events[k] = v; },
        focus() { focused = this; } });
    }
    const window = { location: { hash }, addEventListener(k, v) { events[k] = v; } };
    mountDocumentTabs({ names, document: { getElementById: id => elements.get(id) }, window });
    const active = name => {
      for (const n of names) {
        assert.equal(elements.get('tab-' + n).attrs['aria-selected'], String(n === name));
        assert.equal(elements.get('tab-' + n).tabIndex, n === name ? 0 : -1);
        assert.equal(elements.get('panel-' + n).hidden, n !== name);
      }
    };
    active(hash === '#privacy' ? 'privacy' : 'terms');
    elements.get('tab-privacy').events.click(); active('privacy');
    assert.equal(window.location.hash, '#privacy');
    window.location.hash = '#terms'; events.hashchange(); active('terms');
    elements.get('tab-terms').events.keydown({ key: 'ArrowLeft', preventDefault() {} });
    active('privacy'); assert.equal(focused, elements.get('tab-privacy'));
    elements.get('tab-privacy').events.keydown({ key: 'ArrowRight', preventDefault() {} }); active('terms');
  }
});

test('public editable document shells and registration links stay connected', async () => {
  const read = p => readFile(new URL('../' + p, import.meta.url), 'utf8');
  const [legal, rulebook, entry, index] = await Promise.all(['legal.html', 'rulebook.html', 'js/legalPage.js', 'index.html'].map(read));
  assert.equal((legal.match(/最終更新日：/g) || []).length, 2);
  assert.equal((legal.match(/role="tabpanel"/g) || []).length, 2);
  assert.doesNotMatch(entry, /requireLoginPage|getAuthRuntime/);
  for (const name of ['terms', 'privacy']) {
    assert.match(legal, new RegExp('id="panel-' + name + '"'));
    for (const html of [rulebook, authMarkup, index]) assert.ok(html.includes('legal.html#' + name));
  }
  assert.ok(authMarkup.includes('rulebook.html#guidelines'));
  const checkbox = authMarkup.match(/<input id="terms-consent"[^>]*>/)[0];
  assert.match(checkbox, /type="checkbox" required/);
  assert.doesNotMatch(checkbox, /\schecked(?:\s|=|>)/);
  for (const heading of ['アカウントについて', 'キャラクター・画像の登録について', '生成AIの使用について', '登録内容の表現について', '禁止行為について', '困ったときは']) assert.ok(rulebook.includes('<h3>' + heading + '</h3>'));
});
