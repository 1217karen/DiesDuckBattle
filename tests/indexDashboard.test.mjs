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
  const nodes = new Map(), pending = [], images = [];
  const get = id => { if (!nodes.has(id)) nodes.set(id, { style: {}, decode: async () => {}, handlers: {}, addEventListener(k,f) { this.handlers[k]=f; }, focus() {} }); return nodes.get(id); };
  let render, logouts=0;
  await vm.runInNewContext('(async()=>{'+source+'})()', {
    document: { getElementById: get, createElement() { const image={}; images.push(image); return image; }, querySelectorAll: () => [] },
    consumeIndexNotice() {}, mountIndexMessages: () => ({update() {}}), finishPageLoad() {}, menuModel, FIXED_IMAGES, setImageFromCandidates,
    mountAuthView: () => ({}), getAuthRuntime: async () => ({ subscribe(fn) { render=fn; fn({ ...signedOut, ready:false }); }, logout() { logouts++; render(signedOut); } }),
    getSupabaseClient: async () => ({}), createOnlinePlayerStorage: () => ({ load: () => new Promise(resolve => pending.push(resolve)) }),
  });
  return { get, images, render: state => render(state), pending, logouts: () => logouts };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const result = (eno, url) => ({ ok:true, account:{eno}, data:{presentation:{battler:{standingImageUrl:url,defaultIconUrl:url+'-icon'}}} });
test('registered images stay hidden through data/image/decode loading without blocking menus', async () => {
 const s=await screen();assert.equal(s.images.length,0);
 s.render({...signedIn('77'),accountsResolved:false,accounts:[],enos:[]});await tick();assert.equal(s.images.length,0);assert.equal(s.get('home-standing').style.visibility,'hidden');
 s.render(signedIn('77'));await tick();
 assert.equal(s.get('home-game').hidden,false);assert.equal(s.get('home-guest').hidden,true);assert.equal(s.get('home-identity').textContent,'ENo.77｜バトラー77');assert.equal(s.get('home-standing').style.visibility,'hidden');assert.equal(s.images.length,0);
 s.pending.shift()(result('77','/own.png'));await tick();
 assert.deepEqual(s.images.map(i=>i.src),['/own.png','/own.png-icon']);assert.equal(s.get('home-standing').src,undefined);
 let decoded;s.get('home-standing').decode=()=>new Promise(resolve=>decoded=resolve);
 const loading=s.images[0].onload();assert.equal(s.get('home-standing').style.visibility,'hidden');decoded();await loading;
 await s.images[1].onload();assert.equal(s.get('home-standing').style.visibility,'visible');assert.equal(s.get('home-icon').style.visibility,'visible');
 s.render({...signedIn('77'),busy:'logout'});assert.equal(s.get('home-logout').disabled,true);
 s.get('home-logout').handlers.click();assert.equal(s.logouts(),1);assert.equal(s.get('home-standing').style.visibility,'hidden');assert.equal(s.get('home-game').hidden,true);
 s.get('home-standing').decode=async()=>{};await s.images.at(-2).onload();assert.equal(s.get('home-standing').src,FIXED_IMAGES.battlerStanding);
});
test('unset images, data failures and bounded image/decode fallbacks',async()=>{
 for(const response of [{ok:false},result('77',''),result('different','/wrong.png')]) {
  const s=await screen();s.render(signedIn('77'));await tick();s.pending.shift()(response);await tick();
  assert.equal(s.images[0].src,FIXED_IMAGES.battlerStanding);await s.images[0].onload();assert.equal(s.get('home-standing').style.visibility,'visible');
 }
 const s=await screen();s.render(signedIn('77'));await tick();s.pending.shift()(result('77','/broken.png'));await tick();
 s.images[0].onerror();assert.equal(s.images[0].src,FIXED_IMAGES.battlerStanding);await s.images[0].onload();assert.equal(s.get('home-standing').style.visibility,'visible');
 s.images[0].onerror();assert.equal(s.images[0].onerror,null);
 s.get('home-icon').decode=async()=>{throw Error('decode');};await s.images[1].onload();assert.equal(s.images[1].src,FIXED_IMAGES.battlerIcon);
 await s.images[1].onload();assert.equal(s.images[1].onerror,null);assert.equal(s.get('home-icon').style.visibility,'hidden');
});
test('late responses, image loads and decode completions cannot reveal a previous ENo',async()=>{
 const s=await screen();s.render(signedIn('77'));await tick();const old=s.pending.shift();
 s.render(signedIn('88'));await tick();old(result('77','/old.png'));await tick();assert.equal(s.images.length,0);
 s.pending.shift()(result('88','/eight.png'));await tick();const oldImage=s.images[0];
 let decoded;s.get('home-standing').decode=()=>new Promise(resolve=>decoded=resolve);const decoding=oldImage.onload();
 s.render(signedIn('99'));decoded();await decoding;assert.equal(s.get('home-standing').style.visibility,'hidden');
 await oldImage.onload();assert.equal(s.get('home-standing').style.visibility,'hidden');await tick();
 s.render(signedOut);s.pending.shift()(result('99','/late.png'));await tick();assert.equal(s.images.at(-2).src,FIXED_IMAGES.battlerStanding);
 s.render({...signedIn('99'),accounts:[{eno:'99'},{eno:'100'}]});await tick();assert.equal(s.pending.length,0);
});
test('initial HTML hides only images while preserving explicit dimensions',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html, /id="home-standing"[^>]*visibility: hidden[^>]*width="500" height="800"/);
 assert.match(html, /id="home-icon"[^>]*visibility: hidden[^>]*width="60" height="60"/);
});
