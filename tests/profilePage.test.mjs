import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadProfilePage } from '../js/profilePage.js';
import { profileStatLevel } from '../js/profileView.js';
import { profileFixture } from './onlineProfileFixture.mjs';
import { createOnlineProfileService, profileFailure } from '../js/onlineProfileService.js';
import { renderQuoteRichText } from '../js/quoteRichText.js';
import { FIXED_IMAGES } from '../js/fixedImages.js';

// Minimal DOM boundary: real page, service, decoder, view and presenters execute.
class Element {
  constructor(tag) { this.tagName=tag; this.children=[];this.attributes={};this.handlers={};this.style={setProperty:(k,v)=>this.styles[k]=v};this.styles={}; }
  append(...nodes) { for(const n of nodes) this.children.push(...(n.tagName==='#fragment'?n.children:[n])); }
  replaceChildren(...nodes) { this.children=[];this.append(...nodes); }
  setAttribute(k,v) { this.attributes[k]=v; }
  addEventListener(k,fn) { this.handlers[k]=fn; }
  set textContent(v) { this.text=String(v);this.children=[]; }
  get textContent() { return (this.text??'')+this.children.map(c=>c.textContent).join(''); }
  set innerHTML(v) { this.html=v; }
  get innerHTML() { return this.html; }
}
const all = node => [node,...node.children.flatMap(all)];
const byClass=(node,name)=>all(node).filter(n=>n.className?.split(' ').includes(name));
async function page({profile=profileFixture(),search='?eno=1',status,throws=false,clientFailure=false}={}) {
  const main=new Element('main'),body=new Element('body'),calls=[];
  const document={body,title:'initial',createElement:t=>new Element(t),createDocumentFragment:()=>new Element('#fragment'),getElementById:id=>{assert.equal(id,'profile');return main;}};
  const client={auth:{getSession:async()=>({data:{session:{user:{id:'caller'}}}})},
    from:()=>{throw Error('No table reads');},rpc:async(name,args)=>{calls.push(['rpc',name,args]);return{data:profile};}};
  const result=await loadProfilePage({document,location:{search},requireLogin:async()=>calls.push(['login']),getClient:async()=>{calls.push(['client']);if(clientFailure)throw Error('private failure');return client;},
    createService:c=>status||throws?{getProfile:async eno=>{calls.push(['eno',eno]);if(throws)throw Error('private failure');return profileFailure(status);}}:createOnlineProfileService(c),
    finish:()=>calls.push(['finish'])});
  return {main,document,calls,result};
}
test('URL ENo passes service boundary after login; canonical header/title and four theme colors',async()=>{
  const p=profileFixture();p.eno='123';p.isOwner=true;p.battler.name='<img onerror=alert(1)>';
  const {main,document,calls,result}=await page({profile:p,search:'?eno=00123'});
  assert.equal(result.ok,true);assert.equal(result.profile.isOwner,true);
  assert.deepEqual(calls,[['login'],['client'],['rpc','get_online_profile',{p_eno:'123'}],['finish']]);
  assert.equal(byClass(main,'profile-header')[0].textContent,`ENo.123 / ${p.battler.name}🎨`);
  assert.equal(document.title,`ENo.123 ${p.battler.name} | DiesDuckBattle`);
  assert.deepEqual(document.body.styles,{'--profile-bg':'#DCEEF3','--profile-panel':'#FFFFFF','--profile-text':'#20282C','--profile-accent':'#4F91B3'});
  assert.equal(byClass(main,'profile-theme-trigger').length,1);
  assert.equal(byClass(document.body,'profile-theme-editor').length,1);
});
test('non-owner never receives theme editor DOM',async()=>{
  const {main,document}=await page();
  assert.equal(byClass(main,'profile-theme-trigger').length,0);
  assert.equal(byClass(document.body,'profile-theme-editor').length,0);
});
for(const status of ['invalid-eno','profile-not-found','unsupported-data','migration-required','load-failed','forbidden','session-changed'])test(`page error ${status} has no partial cards and finishes loading`,async()=>{
  const p=await page({status});assert.equal(byClass(p.main,'profile-error').length,1);assert.equal(byClass(p.main,'profile-card').length,0);assert.equal(p.calls.at(-1)[0],'finish');
});
test('missing/invalid ENo makes no RPC; unexpected connection/service/render failure ends loading',async()=>{
  for(const search of ['','?eno=bad']) {const p=await page({search});assert.equal(p.result.status,'invalid-eno');assert.equal(p.calls.some(c=>c[0]==='rpc'),false);}
  for(const opts of [{throws:true},{clientFailure:true},{profile:{}}]) {
    const p=await page(opts);assert.equal(byClass(p.main,'profile-error').length,1);assert.equal(p.calls.at(-1)[0],'finish');assert.doesNotMatch(p.main.textContent,/private failure/);
  }
});
test('default Battler icon remains visible with fixed fallback; empty/broken additional icons have no placeholder',async()=>{
  const profile=profileFixture();profile.battler.defaultIconUrl='default.png';profile.battler.standingImageUrl='standing.png';
  let {main}=await page({profile});
  const standing=byClass(main,'battler-standing')[0];assert.equal(standing.src,'standing.png');standing.handlers.error();assert.equal(standing.src,FIXED_IMAGES.battlerStanding);
  const rail=byClass(main,'profile-icon-rail')[0];assert.equal(rail.children.length,2);assert.deepEqual(rail.children.map(i=>i.src),['default.png','three.png']);
  assert.equal(rail.children[0].alt,'Battlerアイコン');
  rail.children[0].handlers.error();assert.equal(rail.children[0].src,FIXED_IMAGES.battlerIcon);assert.notEqual(rail.children[0].hidden,true);
  rail.children[1].handlers.error();assert.equal(rail.children[1].hidden,true);assert.equal(rail.children[1].src,'three.png');
  const duck=byClass(main,'duck-icon')[0];assert.equal(duck.src,FIXED_IMAGES.duckIcon);
  profile.battler.defaultIconUrl='';profile.battler.standingImageUrl='';profile.battler.profileIcons=[];
  ({main}=await page({profile}));const defaultRail=byClass(main,'profile-icon-rail');assert.equal(defaultRail.length,1);assert.equal(defaultRail[0].children.length,1);
  assert.equal(defaultRail[0].children[0].src,FIXED_IMAGES.battlerIcon);assert.equal(FIXED_IMAGES.battlerIcon,'/img/B00_icon.png');
  assert.equal(byClass(main,'battler-standing')[0].src,FIXED_IMAGES.battlerStanding);
});

test('Battler icon rail has default plus four additional icons at most, and keeps default when all additional URLs are empty',async()=>{
  const profile=profileFixture();
  profile.battler.profileIcons=[1,2,3,4].map(slot=>({slot,url:`icon-${slot}.png`}));
  let {main}=await page({profile});
  const rail=byClass(main,'profile-icon-rail')[0];
  assert.equal(rail.children.length,5);
  assert.deepEqual(rail.children.map(img=>img.src),[FIXED_IMAGES.battlerIcon,'icon-1.png','icon-2.png','icon-3.png','icon-4.png']);
  profile.battler.profileIcons.forEach(icon=>{icon.url='';});
  ({main}=await page({profile}));
  assert.equal(byClass(main,'profile-icon-rail')[0].children.length,1);
  assert.equal(byClass(main,'profile-icon-rail')[0].children[0].src,FIXED_IMAGES.battlerIcon);
});
test('DOM order, skill placement, Duck metadata and safe rich text/name/ruby',async()=>{
  const p=profileFixture();p.duck.profile.type='attack';p.duck.profile.attributes=['炎','','🔥'];
  const raw='  <b>太</b>\n<i>斜</i><u>線</u><rb>名</rb><rt>な</rt><small>小</small><big>大</big><script>alert(1)</script>';
  p.battler.profile.text=raw;p.duck.profile.text=raw;
  p.battler.skills.B.label={name:'<img>',ruby:'<script>'};
  const {main}=await page({profile:p}),grid=byClass(main,'profile-grid')[0];
  assert.deepEqual(grid.children.map(n=>n.className),['profile-card battler-card','profile-card profile-text-card','profile-card duck-card','profile-card featured-battle']);
  assert.equal(byClass(grid.children[0],'skill-B').length,1);assert.equal(byClass(grid.children[0],'skill-D').length,1);
  const duck=grid.children[2];assert.ok(duck.children.indexOf(byClass(duck,'skill-list')[0])<duck.children.indexOf(byClass(duck,'stat-section')[0]));
  assert.equal(byClass(duck,'duck-meta')[0].textContent,'アタック / 炎・🔥');
  for(const node of byClass(main,'profile-rich-text')){assert.equal(node.innerHTML,renderQuoteRichText(raw));assert.doesNotMatch(node.innerHTML,/<script>/);assert.match(node.innerHTML,/&lt;script&gt;/);}
  const name=byClass(main,'skill-name')[0];assert.equal(name.children[0].tagName,'ruby');assert.equal(name.children[0].text,'<img>');assert.equal(name.children[0].children[0].textContent,'<script>');
  assert.equal(all(main).filter(n=>n.innerHTML!==undefined).every(n=>n.className==='profile-rich-text'),true);
});
test('unpublished Duck leaves Battler readable without Duck skill/stats/profile',async()=>{
  const profile=profileFixture();profile.duck=null;profile.battler.profile.text='Battler remains';
  const {main,result}=await page({profile});assert.equal(result.ok,true);const duck=byClass(main,'duck-card')[0];
  assert.match(duck.textContent,/未登録/);assert.equal(byClass(duck,'skill-list').length,0);assert.equal(byClass(duck,'stat-section').length,0);
  assert.equal(byClass(main,'profile-rich-text')[0].innerHTML,'Battler remains');
});
for(const [preset,labels] of Object.entries({default:['AT','DF','SP'],kanji:['攻撃','防御','速度'],english:['Attack','Defense','Speed'],hiragana:['つよさ','かたさ','はやさ']}))test(`stat preset ${preset} and no numeric labels`,async()=>{
  const profile=profileFixture();profile.duck.profile.statLabelPreset=preset;
  const {main}=await page({profile});assert.deepEqual(byClass(main,'stat-label').map(n=>n.textContent),labels);
  assert.equal(byClass(main,'stat-section')[0].textContent,'STATUS'+labels.join(''));
});
test('SP conversion is display-only, null is empty, flavor 0/5/6 keep unclipped levels',async()=>{
  for(const [sp,level] of [[1,1],[2,3],[3,5],[null,0],[99,0]])assert.equal(profileStatLevel('SP',sp),level);
  for(const value of [0,5,6]) {
    const profile=profileFixture();profile.duck.stats.SP=2;profile.duck.profile.flavorStats=[{label:'',value}];
    const before=structuredClone(profile),{main}=await page({profile}),fills=byClass(main,'stat-fill');
    assert.equal(fills[2].styles['--value'],'3');assert.equal(fills[3].styles['--value'],String(value));assert.deepEqual(profile,before);
    assert.equal(byClass(main,'stat-flavor')[0].textContent,'');
  }
});
test('Featured Battle uses summary only, links to result, has fixed image fallbacks and neutral result',async()=>{
  const p=profileFixture(),{main,calls}=await page({profile:p}),link=byClass(main,'featured-summary')[0];
  assert.equal(link.href,`result.html?battleId=${p.featuredBattle.battleId}`);assert.match(link.textContent,/DRAW/);assert.match(link.textContent,/P1 \/ ENo/);
  assert.deepEqual(byClass(link,'battle-icon').map(i=>i.src),[FIXED_IMAGES.battlerIcon,FIXED_IMAGES.duckIcon,FIXED_IMAGES.battlerIcon,FIXED_IMAGES.duckIcon]);
  assert.equal(calls.filter(c=>c[0]==='rpc').length,1);
  p.featuredBattle=null;const empty=await page({profile:p});assert.match(byClass(empty.main,'featured-battle')[0].textContent,/お気に入りバトルは設定されていません/);
});
test('HTML/CSS integrate gate/menu without common theme, preserve layout, natural image size and overflow',async()=>{
  const html=await readFile(new URL('../profile.html',import.meta.url),'utf8'),css=await readFile(new URL('../css/profile.css',import.meta.url),'utf8');
  for(const name of ['pageLoadGate.js','pageEntry.js','commonMenu.js','data-page-content','has-common-menu page-loading'])assert.ok(html.includes(name));
  assert.doesNotMatch(html,/common-theme.css|<input|<select|<textarea/);assert.doesNotMatch(css,/result_BG|url\(/);
  assert.match(css,/width: auto; height: auto; max-width: min\(100%, 500px\); max-height: 800px/);
  assert.match(css,/"visual duck" "text text" "favorite favorite"/);assert.match(css,/"visual" "text" "duck" "favorite"/);
  assert.match(css,/white-space: pre-wrap/);assert.match(css,/var\(--value\) \* 20%/);assert.match(css,/width: calc\(100% \/ 1\.2\)/);
  assert.doesNotMatch(css,/overflow:\s*hidden/);
});

for(const count of [1,2,3,4,5])test(`fixed icon positions start at top for ${count} visible icons`,async()=>{
  const profile=profileFixture();profile.battler.profileIcons=Array.from({length:count-1},(_,i)=>({slot:i+1,url:`icon-${i}.png`}));
  const {main}=await page({profile}),rail=byClass(main,'profile-icon-rail')[0];
  assert.equal(rail.children.length,count);
  assert.deepEqual(rail.children.map(img=>img.attributes['data-icon-position']),Array.from({length:count},(_,i)=>String(i+1)));
  assert.deepEqual(rail.children.map(img=>img.styles['--icon-position']),Array.from({length:count},(_,i)=>String(i+1)));
});

test('empty and broken additional icons compact visible positions without default fallback changes',async()=>{
  const profile=profileFixture();profile.battler.profileIcons=[{slot:1,url:'one.png'},{slot:2,url:''},{slot:3,url:'three.png'},{slot:4,url:'four.png'}];
  const {main}=await page({profile}),rail=byClass(main,'profile-icon-rail')[0];
  assert.deepEqual(rail.children.map(img=>img.src),[FIXED_IMAGES.battlerIcon,'one.png','three.png','four.png']);
  assert.deepEqual(rail.children.map(img=>img.attributes['data-icon-position']),['1','2','3','4']);
  rail.children[1].handlers.error();
  assert.equal(rail.children[1].hidden,true);assert.equal(rail.children[1].src,'one.png');
  assert.deepEqual(rail.children.filter(img=>!img.hidden).map(img=>img.attributes['data-icon-position']),['1','2','3']);
  rail.children[2].handlers.error();
  assert.equal(rail.children[3].attributes['data-icon-position'],'2');
  assert.equal(rail.children[0].attributes['data-icon-position'],'1');
});

for(const value of ['', ' ', '   ', '\n', '<b>本文</b><script>alert(1)</script>'])test(`profile empty state distinguishes exact empty string: ${JSON.stringify(value)}`,async()=>{
  const profile=profileFixture();profile.battler.profile.text=value;profile.duck.profile.text=value;
  const {main}=await page({profile});
  for(const name of ['profile-text-card','duck-profile']) {
    const section=byClass(main,name)[0];
    if(value==='') {assert.equal(byClass(section,'profile-empty')[0].textContent,'プロフィールが設定されていません');assert.equal(byClass(section,'profile-rich-text').length,0);}
    else {assert.equal(byClass(section,'profile-empty').length,0);assert.equal(byClass(section,'profile-rich-text')[0].innerHTML,renderQuoteRichText(value));assert.doesNotMatch(byClass(section,'profile-rich-text')[0].innerHTML,/<script>/);}
  }
});

test('section headings and themed separators distinguish Battler visuals and Duck skills/status/profile',async()=>{
  const {main}=await page(),css=await readFile(new URL('../css/profile.css',import.meta.url),'utf8');
  const battler=byClass(main,'battler-card')[0],duck=byClass(main,'duck-card')[0];
  assert.equal(battler.children[0].className,'battler-visual');assert.equal(battler.children[1].className,'skill-list');
  assert.deepEqual(duck.children.map(child=>child.className),['','duck-heading','duck-meta','skill-list','stat-section','duck-profile']);
  assert.equal(byClass(duck,'stat-section')[0].children[0].textContent,'STATUS');assert.equal(byClass(duck,'duck-profile')[0].children[0].textContent,'DUCK PROFILE');
  assert.match(css,/\.battler-card > \.skill-list, \.duck-card > \.skill-list, \.stat-section, \.duck-profile\s*\{[^}]*border-top: 1px solid var\(--profile-line\)/);
});

test('layout reserves natural standing width, five fixed zigzag rows, overlaid five-step marks and responsive order',async()=>{
  const css=await readFile(new URL('../css/profile.css',import.meta.url),'utf8');
  assert.match(css,/max-width: 1360px/);assert.match(css,/grid-template-columns: minmax\(0, 2fr\) minmax\(0, 1fr\)/);
  assert.match(css,/\.battler-visual\s*\{[^}]*align-items: flex-start/);
  assert.match(css,/grid-template-rows: repeat\(5, 120px\)/);assert.match(css,/width: 120px;\s*height: 120px/);
  assert.match(css,/img\[data-icon-position="2"\], \.profile-icon-rail img\[data-icon-position="4"\]\s*\{ justify-self: end/);
  assert.match(css,/\.stat-track::after\s*\{[^}]*repeating-linear-gradient[^}]*20%[^}]*var\(--profile-line\)/);
  assert.match(css,/@media \(max-width: 1160px\)[\s\S]*"visual" "text" "duck" "favorite"/);
  assert.match(css,/@media \(max-width: 760px\)[\s\S]*flex-direction: column/);
  assert.match(css,/repeat\(5, 90px\)/);assert.doesNotMatch(css,/overflow:\s*hidden|align-items: center; gap: 16px; margin-bottom/);
});

test('profile message is omitted when empty; plain text pill precedes visual with optional tail',async()=>{
 assert.equal(byClass((await page()).main,'profile-message').length,0);
 for(const tail of [false,true]){
  const profile=profileFixture();profile.battler.profile.message='<img src=x onerror=alert(1)>[b]hello[/b]';profile.battler.profile.messageTail=tail;
  const {main,result}=await page({profile});assert.equal(result.ok,true);
  const pill=byClass(main,'profile-message')[0];assert.equal(pill.textContent,profile.battler.profile.message);
  assert.equal(pill.innerHTML,undefined);assert.equal(pill.children.length,0);
  assert.equal(pill.className.includes('has-tail'),tail);
  const card=byClass(main,'battler-card')[0];assert.equal(card.children[0],pill);assert.equal(card.children[1].className,'battler-visual');
 }
});
