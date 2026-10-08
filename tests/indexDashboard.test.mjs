import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { menuModel } from '../js/commonMenuModel.js';
import { FIXED_IMAGES, setImageFromCandidates } from '../js/fixedImages.js';
const source = (await readFile(new URL('../js/indexPage.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const signedOut = { ready: true, sessionKnown: true, signedIn: false, accountsResolved: true, accounts: [], enos: [] };
const signedIn = eno => ({ ...signedOut, signedIn: true, accounts: [{ eno, name: 'バトラー'+eno }], enos: [eno] });
async function screen() {
  const nodes = new Map(), pending = [];
  const get = id => { if (!nodes.has(id)) nodes.set(id, { handlers: {}, addEventListener(k,f) { this.handlers[k]=f; }, focus() {} }); return nodes.get(id); };
  let render, logouts=0;
  await vm.runInNewContext('(async()=>{'+source+'})()', {
    document: { getElementById: get, querySelectorAll: () => [] },
    consumeIndexNotice() {}, mountIndexMessages: () => ({update() {}}), finishPageLoad() {}, menuModel, FIXED_IMAGES, setImageFromCandidates,
    mountAuthView: () => ({}), getAuthRuntime: async () => ({ subscribe(fn) { render=fn; fn({ ...signedOut, ready:false }); }, logout() { logouts++; render(signedOut); } }),
    getSupabaseClient: async () => ({}), createOnlinePlayerStorage: () => ({ load: () => new Promise(resolve => pending.push(resolve)) }),
  });
  return { get, render: state => render(state), pending, logouts: () => logouts };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const result = (eno, url) => ({ ok:true, account:{eno}, data:{presentation:{battler:{standingImageUrl:url,defaultIconUrl:url+'-icon'}}} });
test('INDEX only reveals confirmed auth layout, loads own images, and delegates logout', async () => {
  const s=await screen();
  assert.equal(s.get('home-game').hidden,true); assert.equal(s.get('home-guest').hidden,true);
  s.render(signedOut); assert.equal(s.get('home-guest').hidden,false);
  s.render(signedIn('77')); await tick();
  assert.equal(s.get('home-guest').hidden,true); assert.equal(s.get('home-game').hidden,false);
  assert.equal(s.get('home-identity').textContent,'ENo.77｜バトラー77');
  s.pending.shift()(result('77','/own.png')); await tick();
  assert.equal(s.get('home-standing').src,'/own.png'); assert.equal(s.get('home-icon').src,'/own.png-icon');
  s.get('home-standing').onerror(); assert.equal(s.get('home-standing').src,FIXED_IMAGES.battlerStanding);
  s.render({...signedIn('77'),busy:'logout'}); assert.equal(s.get('home-logout').disabled,true);
  s.get('home-logout').handlers.click(); assert.equal(s.logouts(),1);
  assert.equal(s.get('home-game').hidden,true); assert.equal(s.get('home-standing').src,FIXED_IMAGES.battlerStanding);
});
test('INDEX discards late images after logout/account switch and keeps fallback on failure', async () => {
  const s=await screen(); s.render(signedIn('77')); await tick(); const old=s.pending.shift();
  s.render(signedOut); s.render(signedIn('88')); await tick();
  old(result('77','/old.png')); await tick(); assert.equal(s.get('home-standing').src,FIXED_IMAGES.battlerStanding);
  s.pending.shift()({ok:false}); await tick(); assert.equal(s.get('home-icon').src,FIXED_IMAGES.battlerIcon);
  s.render(signedOut); s.render(signedIn('99')); await tick();
  s.pending.shift()(result('different','/wrong.png')); await tick(); assert.equal(s.get('home-standing').src,FIXED_IMAGES.battlerStanding);
  s.render({...signedIn('99'),accounts:[{eno:'99'},{eno:'100'}]}); await tick(); assert.equal(s.pending.length,0);
});
