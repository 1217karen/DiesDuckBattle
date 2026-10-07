import { createEmptyDuckQuotes } from "../js/playerPresentationModel.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadSettingPage } from './settingPageHarness.mjs';
import { createOnlineEditController } from '../js/onlineEditController.js';
import { createOnlinePlayerStorage } from '../js/onlinePlayerStorage.js';
import { encodeOnlinePlayer, decodeOnlinePlayer } from '../js/onlinePlayerDto.js';
import { createEmptyPlayerBuild, createEmptyDuck } from '../js/playerBuildModel.js';
import { createEmptyPlayerPresentation, createEmptyDuckProfile } from '../js/playerPresentationModel.js';
const account='11111111-1111-4111-8111-111111111111', a='22222222-2222-4222-8222-222222222222', b='33333333-3333-4333-8333-333333333333';
const clone=structuredClone;
const emptyDisplay=()=>({iconUrl:'',cutinUrl:'',quotes:createEmptyDuckQuotes(),profile:createEmptyDuckProfile()});
function initial() {
 const build=createEmptyPlayerBuild();build.ducks=[a,b].map((id,i)=>({...createEmptyDuck({idFactory:()=>id}),name:'Duck'+i}));
 const presentation=createEmptyPlayerPresentation();
 presentation.battler.standingImageUrl='standing';presentation.battler.defaultIconUrl='default';presentation.battler.iconSlots[9]='tenth';presentation.battler.quotes.battleStart={ lines: [{text:' quote ',iconSlot:10, opponentEno:null}] };
 presentation.battler.profile={text:' Battler ',iconSlots:[1,10],theme:{background:'#123456',panel:'#234567',text:'#345678',accent:'#456789'},featuredBattleId:a,message:"",messageTail:false,showBestStreak:true};
 presentation.ducks[a]={iconUrl:'icon',cutinUrl:'cutin',quotes:createEmptyDuckQuotes(),profile:{text:' profile ',type:'attack',attributes:['炎','😀',''],statLabelPreset:'english',flavorStats:[{label:'test',value:6}]}};
 presentation.ducks[b]={...emptyDisplay(),iconUrl:'other',profile:{...createEmptyDuckProfile(),text:'other profile'}};
 presentation.ducks[a].quotes.skill.A.lines[0].text='delete A';presentation.ducks[a].quotes.skill.C.lines.push({text:'delete C extra',iconSlot:10,opponentEno:'15'});
 presentation.ducks.orphan={...emptyDisplay(),profile:{...createEmptyDuckProfile(),text:'detached'}};
 return {build,presentation,publicSettings:{schemaVersion:1,publicDuckId:b},battlerName:'Battler'};
}
function database(data) {
 const seed=clone(data);
 // Simulate historical unpublished rows without allowing the normal encoder to save them.
 if(seed.build.ducks.length && seed.publicSettings.publicDuckId===null)seed.publicSettings.publicDuckId=seed.build.ducks[0].id;
 let row={...encodeOnlinePlayer(seed),publicDuckId:data.publicSettings.publicDuckId,gameAccountId:account,eno:'7',revision:'0'};
 const calls=[];
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'auth'}}}})},
  from:()=>({select:()=>({eq:async()=>({data:[{game_account_id:account,game_accounts:{eno:'7'}}]})})}),
  rpc:async(name,p)=>{
   calls.push({name,p:clone(p)});
   if(name==='load_online_player')return {data:clone(row)};
   assert.equal(name,'save_online_player');
   if(p.p_expected_revision!==row.revision)return {error:{code:'40001'}};
   row={...row,...clone(p.p_payload),revision:String(Number(row.revision)+1)};
   return {data:{revision:row.revision}};
  }};
 const storage=createOnlinePlayerStorage(client);
 return {storage,calls,row:()=>clone(row),character:()=>createOnlineEditController({storage,sections:['presentation','battlerName'],confirm:()=>true})};
}
async function page(data=initial()) {
 class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.attributes={};this.value='';this.classList={toggle(){}};}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,fn){this.handlers[k]=fn;}
  focus(){} showModal(){this.open=true;} close(){this.open=false;this.handlers.close?.();}
  remove(){this.parent.children=this.parent.children.filter(e=>e!==this);}
  set textContent(v){this.text=String(v);this.children=[];}
  get textContent(){return (this.text??'')+this.children.map(e=>e.textContent).join('');}
 }
 const body=new Element('body'),walk=e=>[e,...e.children.flatMap(walk)],all=()=>walk(body);
 for(const m of (await readFile(new URL('../setting.html',import.meta.url),'utf8')).matchAll(/\bid="([^"]+)"/g)) {const e=new Element('div');e.id=m[1];body.append(e);}
 const get=id=>all().find(e=>e.id===id);
 globalThis.document={body,createElement:tag=>new Element(tag),getElementById:get};globalThis.window={addEventListener(){}};
 const db=database(data),edits=[],observed=[];let controller,accept=true;
 await loadSettingPage(data.build,()=>{},async ({sections,allowDuckPresentationDeletion,hydrate,onState})=>{
  assert.deepEqual(sections,['build','publicSettings']);assert.equal(allowDuckPresentationDeletion,true);
  controller=createOnlineEditController({storage:db.storage,sections,allowDuckPresentationDeletion,confirm:()=>accept});
  let version=-1;
  controller.subscribe(next=>{observed.push(next);if(next.dataVersion!==version){version=next.dataVersion;hydrate(next.draft);}onState(next);});
  const edit=controller.edit;controller.edit=(...args)=>{edits.push(clone(args));return edit(...args);};
  await controller.load();return controller;
 });
 const button=(text,root=body)=>walk(root).find(e=>e.tagName==='button'&&e.textContent===text);
 const dialog=()=>all().find(e=>e.tagName==='dialog');
 return {db,controller,edits,observed,get,all,button,dialog,accept:v=>{accept=v;},
  openDelete(){button('削除',get('duck-editor')).handlers.click();return dialog();},
  confirmDelete(){(button('削除する',dialog()) ?? button('変更する',dialog())).handlers.click();},
  cancel(){button('取り消す',dialog()).handlers.click();}};
}

for(const published of [false,true])for(const kind of ['missing','empty','populated'])test(`delete confirmation ${published}/${kind}; cancel is inert and confirm is one atomic edit`,async()=>{
 const data=initial();data.publicSettings.publicDuckId=published?a:b;
 if(kind==='missing')delete data.presentation.ducks[a];if(kind==='empty')data.presentation.ducks[a]=emptyDisplay();
 const p=await page(data),before=p.controller.snapshot().draft;
 if(published) {
  assert.equal(p.button('削除',p.get('duck-editor')).disabled,true);
  assert.match(p.button('削除',p.get('duck-editor')).title,/公開中/);
  assert.equal(p.openDelete(),undefined);assert.deepEqual(p.controller.snapshot().draft,before);return;
 }
 const message=p.openDelete().textContent;
 assert.equal(message.includes('プロフィール情報・A/Cセリフも削除'),kind==='populated');assert.equal(message.includes('対戦相手として選択されなくなります'),published);
 assert.match(message,/保存するまで確定しません/);assert.equal(p.all().filter(e=>e.tagName==='dialog').length,1);
 assert.deepEqual(p.controller.snapshot().draft,before);p.cancel();assert.deepEqual(p.controller.snapshot().draft,before);assert.equal(p.edits.length,0);
 p.openDelete();p.confirmDelete();
 assert.equal(p.edits.length,1);assert.equal(p.controller.snapshot().dirty,true);
 const after=p.controller.snapshot().draft,expected=clone(data);expected.build.ducks=expected.build.ducks.filter(d=>d.id!==a);delete expected.presentation.ducks[a];

 assert.deepEqual(after,expected);assert.doesNotThrow(()=>encodeOnlinePlayer(after));
 for(const event of p.observed.filter(s=>s.dirty)) {assert.equal(event.draft.build.ducks.some(d=>d.id===a),false);assert.equal(Object.hasOwn(event.draft.presentation.ducks,a),false);}
 assert.equal(p.db.calls.filter(c=>c.name==='save_online_player').length,0);
 assert.equal((await p.controller.save()).ok,true);assert.equal(p.db.calls.filter(c=>c.name==='save_online_player').length,1);
 assert.equal(Object.hasOwn(p.db.row().battler.presentation.detachedDuckPresentation,a),false);
 await p.controller.load();assert.deepEqual(p.controller.snapshot().draft,expected);
 const character=p.db.character();await character.load();assert.deepEqual(character.snapshot().draft,expected);
});

for(const [key,change]of [
 ['A quote',d=>d.quotes.skill.A.lines[0].text='A'],['C quote',d=>d.quotes.skill.C.lines[0].text='C'],
 ['icon',d=>d.iconUrl='icon'],['cutin',d=>d.cutinUrl='cutin'],['spaces',d=>d.profile.text='  \n'],
 ['type',d=>d.profile.type='normal'],['attributes',d=>d.profile.attributes[2]='😀'],
 ['preset',d=>d.profile.statLabelPreset='kanji'],['flavor',d=>d.profile.flavorStats=[{label:'',value:0}]]
])test(`non-default warning detects ${key}`,async()=>{
 const data=initial();data.presentation.ducks[a]=emptyDisplay();change(data.presentation.ducks[a]);
 const p=await page(data);assert.match(p.openDelete().textContent,/アイコン・カットイン・プロフィール情報・A\/Cセリフも削除/);p.cancel();
});

test('discard restores deletion and clears pending intent; cancelling reload preserves dirty draft',async()=>{
 const data=initial(),p=await page(data);p.openDelete();p.confirmDelete();p.accept(false);
 assert.equal((await p.controller.load()).status,'cancelled');assert.equal(p.controller.snapshot().dirty,true);
 p.accept(true);await p.controller.load();assert.deepEqual(p.controller.snapshot().draft,data);
 assert.deepEqual(p.controller.snapshot().deletedDuckPresentationIds,[]);assert.equal(p.controller.snapshot().dirty,false);
});

test('build-only conflict rebase preserves the entire latest character presentation',async()=>{
 const p=await page(),character=p.db.character();await character.load();
 p.get('duck-name').value='build edit';p.get('duck-name').handlers.input();
 const latest=character.snapshot().draft.presentation;latest.battler.profile.text='latest';latest.ducks[a].profile.text='latest duck';latest.ducks.newDetached=emptyDisplay();
 character.edit({presentation:latest});await character.save();assert.equal((await p.controller.save()).status,'conflict');
 await p.controller.compare();await p.controller.adoptLatest(true);
 assert.deepEqual(p.controller.snapshot().draft.presentation,latest);assert.deepEqual(p.controller.snapshot().deletedDuckPresentationIds,[]);
 assert.equal(p.controller.snapshot().draft.build.ducks[0].name,'build edit');await p.controller.save();
});

test('delete conflict rebase removes only target from latest presentation, even through repeated conflicts',async()=>{
 const p=await page(),character=p.db.character();await character.load();p.openDelete();p.confirmDelete();
 const latest=character.snapshot().draft.presentation;latest.battler.profile.text='latest battler';latest.battler.profile.theme.accent='#AABBCC';
 latest.ducks[a].profile.text='edited target';latest.ducks[b].profile.text='latest other';latest.ducks.orphan.profile.text='latest detached';latest.ducks.newDetached=emptyDisplay();
 character.edit({presentation:latest});await character.save();assert.equal((await p.controller.save()).status,'conflict');
 await p.controller.compare();await p.controller.adoptLatest(true);
 const expected=clone(latest);delete expected.ducks[a];assert.deepEqual(p.controller.snapshot().draft.presentation,expected);
 // Preserve intent even if the next server revision has already removed the target.
 delete latest.ducks[a];character.edit({presentation:latest});await character.save();
 assert.equal((await p.controller.save()).status,'conflict');await p.controller.compare();await p.controller.adoptLatest(true);
 latest.ducks[a]={...emptyDisplay(),iconUrl:'concurrent reappearance'};latest.battler.profile.text='even newer';
 character.edit({presentation:latest});await character.save();assert.equal((await p.controller.save()).status,'conflict');
 await p.controller.compare();await p.controller.adoptLatest(true);
 const final=clone(latest);delete final.ducks[a];assert.deepEqual(p.controller.snapshot().draft.presentation,final);
 await p.controller.save();assert.deepEqual(p.controller.snapshot().deletedDuckPresentationIds,[]);
 await character.load();assert.deepEqual(character.snapshot().draft.presentation,final);assert.equal(character.snapshot().draft.publicSettings.publicDuckId,b);
 assert.equal(Object.hasOwn(p.db.row().battler.presentation.detachedDuckPresentation,a),false);
});

test('absent display deletion also removes a concurrently created profile without making empty displays',async()=>{
 const data=initial();delete data.presentation.ducks[a];const p=await page(data),c=p.db.character();await c.load();
 p.openDelete();p.confirmDelete();assert.deepEqual(p.controller.snapshot().draft.presentation,data.presentation);
 const presentation=c.snapshot().draft.presentation;presentation.ducks[a]={...emptyDisplay(),profile:{...createEmptyDuckProfile(),text:'concurrent'}};
 c.edit({presentation});await c.save();await p.controller.compare();await p.controller.adoptLatest(true);
 assert.deepEqual(p.controller.snapshot().draft.presentation,data.presentation);
});

test('adopt server data and identity invalidation clear pending deletions',async()=>{
 const p=await page();p.openDelete();p.confirmDelete();await p.controller.compare();await p.controller.adoptLatest(false);
 assert.deepEqual(p.controller.snapshot().deletedDuckPresentationIds,[]);assert.ok(p.controller.snapshot().draft.presentation.ducks[a]);
 p.openDelete();p.confirmDelete();p.controller.invalidate();assert.deepEqual(p.controller.snapshot().deletedDuckPresentationIds,[]);assert.equal(p.controller.snapshot().draft,null);
});

test('ordinary section ownership remains strict; deletion must accompany removing an existing build Duck',async()=>{
 const p=await page(),draft=p.controller.snapshot().draft;
 assert.equal(p.controller.edit({presentation:draft.presentation}),false);
 assert.equal(p.controller.edit({build:draft.build},{deleteDuckPresentationIds:[a]}),false);
 const build=clone(draft.build);build.ducks=build.ducks.filter(d=>d.id!==a);
 assert.equal(p.controller.edit({build},{deleteDuckPresentationIds:['orphan']}),false);
 const c=p.db.character();await c.load();assert.equal(c.edit({presentation:draft.presentation},{deleteDuckPresentationIds:[a]}),false);
 assert.deepEqual(p.controller.snapshot().draft,draft);assert.equal(p.controller.snapshot().dirty,false);
});

for (const deleted of [true, false]) test(`character rebase preserves other edits and original detached data; server deletion=${deleted}`, async () => {
 const db=database(initial()),character=db.character();await character.load();
 const setting=createOnlineEditController({storage:db.storage,sections:['build','publicSettings'],allowDuckPresentationDeletion:true,confirm:()=>true});
 await setting.load();
 const serverDraft=setting.snapshot().draft;
 if(deleted) {
  serverDraft.build.ducks=serverDraft.build.ducks.filter(d=>d.id!==a);
  serverDraft.publicSettings.publicDuckId=b;
  setting.edit({build:serverDraft.build,publicSettings:serverDraft.publicSettings},{deleteDuckPresentationIds:[a]});
 } else {
  serverDraft.build.ducks[0].name='latest name';
  setting.edit({build:serverDraft.build});
 }
 assert.equal((await setting.save()).ok,true);
 const presentation=character.snapshot().draft.presentation;
 presentation.battler.standingImageUrl='edited standing';presentation.battler.defaultIconUrl='edited icon';presentation.battler.iconSlots[2]='edited slot';
 presentation.battler.quotes.battleStart={ lines: [{text:' edited quote ',iconSlot:3, opponentEno:null}] };
 presentation.battler.profile={text:' edited Battler\n',iconSlots:[3],theme:{background:'#ABCDEF',panel:'#FEDCBA',text:'#102030',accent:'#405060'},featuredBattleId:b,message:"",messageTail:false,showBestStreak:false};
 presentation.ducks[a].profile.text='stale target edit';
 presentation.ducks[b].profile.text='edited B';presentation.ducks.orphan.profile.text='edited orphan';
 character.edit({presentation,battlerName:'edited name'});
 assert.equal((await character.save()).status,'conflict');await character.compare();
 const before=character.snapshot(),serverBefore=db.row();
 assert.equal(await character.adoptLatest(true),true);
 const expected=clone(presentation);if(deleted)delete expected.ducks[a];
 const rebased=character.snapshot().draft;
 assert.deepEqual(rebased.build,serverDraft.build);assert.deepEqual(rebased.publicSettings,serverDraft.publicSettings);
 assert.deepEqual(rebased.presentation,expected);assert.equal(rebased.battlerName,'edited name');
 assert.deepEqual(before.draft.presentation,presentation);assert.deepEqual(db.row(),serverBefore);
 assert.equal((await character.save()).ok,true);await character.load();
 assert.deepEqual(character.snapshot().draft,rebased);
 if(deleted)assert.equal(Object.hasOwn(db.row().battler.presentation.detachedDuckPresentation,a),false);
 assert.equal(character.snapshot().draft.presentation.ducks.orphan.profile.text,'edited orphan');
});

test('Duck toolbar and operations precede the name, retain selection/public actions and hide only inline name feedback',async()=>{
 const html=await readFile(new URL('../setting.html',import.meta.url),'utf8');
 assert.match(html,/<div class="duck-toolbar"><button id="add-duck"[^>]*>＋ 新規アヒル<\/button><div id="duck-tabs"/);
 const data=initial();data.publicSettings.publicDuckId=a;
 const p=await page(data),root=p.get('duck-editor');
 assert.equal(root.children[0].className,'actions duck-actions');assert.equal(root.children[1].className,'duck-meta');
 assert.deepEqual(root.children[0].children.map(e=>e.textContent),['公開中','複製','削除']);
 p.get('duck-tabs').children[1].handlers.click();
 assert.equal(p.get('duck-name').value,'Duck1');assert.equal(p.button('公開アヒルに設定',root).disabled,false);
 p.button('公開アヒルに設定',root).handlers.click();assert.equal(p.controller.snapshot().draft.publicSettings.publicDuckId,b);assert.equal(p.button('公開中',root).disabled,true);
 p.button('複製',root).handlers.click();
 const duplicate=p.controller.snapshot().draft.build.ducks.at(-1);
 assert.notEqual(duplicate.id,b);assert.equal(p.get('duck-name').value,duplicate.name);
 p.get('add-duck').handlers.click();
 const added=p.controller.snapshot().draft.build.ducks.at(-1);
 assert.notEqual(added.id,duplicate.id);assert.equal(p.get('duck-tabs').children.at(-1).attributes['aria-pressed'],'true');
 const name=p.get('duck-name');name.value='　 ';name.handlers.input();
 assert.equal(name.attributes['aria-invalid'],'true');assert.equal(p.get('duck-name-error').hidden,true);assert.match(p.get('duck-name-error').textContent,/アヒル名を入力/);
 assert.equal(p.get('save').attributes['aria-disabled'],'true');
 const calls=p.db.calls.filter(c=>c.name==='save_online_player').length;
 p.get('save').handlers.click();assert.equal(p.db.calls.filter(c=>c.name==='save_online_player').length,calls);assert.match(p.dialog().textContent,/アヒル名/);
});


test('public incomplete save warns, cancellation does not save, confirmation saves normally',async()=>{
 const p=await page();p.get('duck-name').value='changed';p.get('duck-name').handlers.input();
 p.get('save').handlers.click();assert.match(p.dialog().textContent,/公開アヒルの設定が未完成/);
 p.button('キャンセル',p.dialog()).handlers.click();
 assert.equal(p.db.calls.filter(c=>c.name==='save_online_player').length,0);
 p.get('save').handlers.click();p.button('このまま保存',p.dialog()).handlers.click();
 await new Promise(r=>setImmediate(r));assert.equal(p.db.calls.filter(c=>c.name==='save_online_player').length,1);
 assert.equal(p.db.row().publicDuckId,b);
});

test('complete public Duck saves without warning even when a private Duck is incomplete',async()=>{
 const {player}=await import('./onlineSelectFixture.mjs');
 const data=initial(),complete=(await player(account,'7',b)).data;
 data.build.battler=complete.build.battler;data.build.ducks[1]=complete.build.ducks[0];
 const p=await page(data);p.get('duck-name').value='private draft';p.get('duck-name').handlers.input();
 p.get('save').handlers.click();await new Promise(r=>setImmediate(r));
 assert.equal(p.dialog(),undefined);assert.equal(p.db.calls.filter(c=>c.name==='save_online_player').length,1);
});

test('switching the public Duck enables deletion of the former representative',async()=>{
 const data=initial();data.publicSettings.publicDuckId=a;const p=await page(data);
 assert.equal(p.button('削除',p.get('duck-editor')).disabled,true);
 p.get('duck-tabs').children[1].handlers.click();p.button('公開アヒルに設定',p.get('duck-editor')).handlers.click();
 p.get('duck-tabs').children[0].handlers.click();assert.equal(p.button('削除',p.get('duck-editor')).disabled,false);
 assert.ok(p.openDelete());p.confirmDelete();assert.equal(p.controller.snapshot().draft.publicSettings.publicDuckId,b);
});


test('legacy unpublished data loads unchanged, requires publication on save, and first addition to zero Ducks is public',async()=>{
 const legacy=initial();legacy.publicSettings.publicDuckId=null;
 const p=await page(legacy);assert.equal(p.controller.snapshot().draft.publicSettings.publicDuckId,null);
 assert.equal(p.controller.snapshot().dirty,false);p.get('save').handlers.click();
 assert.match(p.dialog().textContent,/公開アヒルを設定/);assert.equal(p.db.calls.filter(c=>c.name==='save_online_player').length,0);
 const empty=initial();empty.build.ducks=[];empty.publicSettings.publicDuckId=null;
 const old=await page(empty);old.get('add-duck').handlers.click();
 const first=old.controller.snapshot().draft.build.ducks[0].id;
 assert.equal(old.controller.snapshot().draft.publicSettings.publicDuckId,first);
 assert.equal(old.button('削除',old.get('duck-editor')).disabled,true);
 old.get('add-duck').handlers.click();assert.equal(old.controller.snapshot().draft.publicSettings.publicDuckId,first);
});
