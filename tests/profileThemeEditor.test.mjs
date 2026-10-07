import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileThemeController, THEME_PRESETS, applyProfileTheme } from '../js/profileThemeController.js';
import { mountProfileThemeEditor } from '../js/profileThemeEditor.js';
import { createOnlinePlayerStorage } from '../js/onlinePlayerStorage.js';
import { encodeOnlinePlayer, decodeOnlinePlayer } from '../js/onlinePlayerDto.js';
import { player, a, b, da } from './onlineSelectFixture.mjs';
const clone=structuredClone;
async function setup() {
  const initial=(await player(a,'88',da)).data;
  initial.presentation.battler.profile.text=' original ';
  initial.presentation.battler.profile.featuredBattleId=b;
  let row={...encodeOnlinePlayer(initial),gameAccountId:a,eno:'88',revision:'0'}, user='owner', mode='', race=false;
  const calls=[],previews=[],states=[],notices=[];
  const client={auth:{getSession:async()=>({data:{session:user?{user:{id:user}}:null}})},
    from:table=>{assert.equal(table,'game_account_access');return{select:()=>({eq:async()=>({data:[{game_account_id:b,game_accounts:{eno:'89'}},{game_account_id:a,game_accounts:{eno:'88'}}]})})};},
    rpc:async(name,p)=>{
      calls.push({name,p:clone(p)});assert.equal(p.p_game_account_id,a);
      if(name==='load_online_player')return{data:clone(row)};
      assert.equal(name,'save_online_player');
      if(mode==='unknown')throw Error('network');
      if(mode==='forbidden')return{error:{code:'42501'}};
      if(race){row.revision=String(Number(row.revision)+1);race=false;}
      if(p.p_expected_revision!==row.revision)return{error:{code:'40001'}};
      row={...row,...clone(p.p_payload),revision:String(Number(row.revision)+1)};return{data:{revision:row.revision}};
    }};
  const storage=createOnlinePlayerStorage(client),controller=createProfileThemeController({storage,gameAccountId:a,preview:t=>previews.push(clone(t)),changed:s=>states.push(s),saved:()=>notices.push('saved')});
  return{controller,storage,client,calls,previews,notices,state:()=>states.at(-1),row:()=>row,
    update(fn){const data=decodeOnlinePlayer(row);fn(data);row={...row,...encodeOnlinePlayer(data),revision:String(Number(row.revision)+1)};},
    user:v=>user=v,mode:v=>mode=v,race:()=>race=true};
}
test('open uses explicit account with multiple accessible accounts; save patches only theme of latest full DTO',async()=>{
  const f=await setup();await f.controller.open();assert.equal(f.state().canSave,false);
  f.controller.preset('dark');assert.equal(f.calls.length,1);
  f.update(d=>{d.battlerName='latest name';d.build.ducks[0].name='latest build';
    d.presentation.battler.standingImageUrl='latest-standing';d.presentation.battler.defaultIconUrl='latest-default';d.presentation.battler.iconSlots[0]='latest-slot';
    d.presentation.battler.quotes.battleStart.lines[0].text='latest quote';
    d.presentation.battler.quotes.battleStart.lines.push({text:'private ENo quote',iconSlot:7,opponentEno:'9223372036854775807'});d.presentation.battler.profile.text=' latest text ';d.presentation.battler.profile.showBestStreak=false;
    d.presentation.ducks[da].profile.text=' latest duck ';d.presentation.ducks[da].cutinUrl='latest-cutin';});
  const expected=decodeOnlinePlayer(f.row());expected.presentation.battler.profile.theme={...THEME_PRESETS.dark};
  await f.controller.save();assert.deepEqual(decodeOnlinePlayer(f.row()),expected);
  assert.deepEqual(f.calls.map(c=>c.name),['load_online_player','load_online_player','save_online_player']);
  assert.equal(f.calls.at(-1).p.p_expected_revision,'1');assert.equal(f.state().active,false);assert.deepEqual(f.state().original,THEME_PRESETS.dark);assert.deepEqual(f.notices,['saved']);
});
test('conflict preserves draft and preview; explicit retry reloads latest, no automatic retry',async()=>{
  const f=await setup();await f.controller.open();f.controller.preset('dark');f.race();await f.controller.save();
  assert.equal(f.state().active,true);assert.equal(f.state().canSave,true);assert.match(f.state().message,/もう一度/);assert.deepEqual(f.state().draft,THEME_PRESETS.dark);assert.equal(f.calls.length,3);
  f.update(d=>d.presentation.battler.profile.text='after conflict');await f.controller.save();
  assert.equal(f.calls.length,5);assert.equal(decodeOnlinePlayer(f.row()).presentation.battler.profile.text,'after conflict');
});
for(const mode of ['unknown','forbidden'])test(`${mode} blocks resubmission without clearing preview`,async()=>{
  const f=await setup();await f.controller.open();f.controller.preset('dark');f.mode(mode);await f.controller.save();
  assert.equal(f.state().active,true);assert.equal(f.state().canSave,false);assert.deepEqual(f.state().draft,THEME_PRESETS.dark);
  const count=f.calls.length;await f.controller.save();assert.equal(f.calls.length,count);
});
for(const user of [null,'another-owner'])test(`identity ${user} cannot save old user's draft even with access`,async()=>{
  const f=await setup();await f.controller.open();f.controller.preset('dark');f.user(user);await f.controller.save();
  assert.equal(f.state().canSave,false);assert.equal(f.calls.some(c=>c.name==='save_online_player'),false);
});
test('auth event blocks an open editor and cancel restores original; presets do not save',async()=>{
 const f=await setup();await f.controller.open();f.controller.preset('dark');f.controller.sessionChanged(null);assert.equal(f.state().blocked,true);
 await f.controller.save();f.controller.cancel();assert.deepEqual(f.previews.at(-1),THEME_PRESETS.light);assert.equal(f.calls.length,1);
});
test('pending open cannot reactivate after cancellation/auth change; load errors leave fields blocked',async()=>{
 for(const action of ['cancel','sessionChanged']){
  let resolve,state;const controller=createProfileThemeController({storage:{load:()=>new Promise(r=>resolve=r)},gameAccountId:a,preview:()=>assert.fail('stale preview'),changed:s=>state=s});
  const pending=controller.open();assert.equal(state.busy,true);controller[action](null);resolve({ok:true,authUserId:'a',data:{presentation:{battler:{profile:{theme:THEME_PRESETS.dark}}}}});await pending;assert.equal(state.blocked,true);
 }
 let state;const controller=createProfileThemeController({storage:{load:async()=>({ok:false,status:'load-failed',message:'failed'})},gameAccountId:a,preview:()=>{},changed:s=>state=s});await controller.open();assert.equal(state.blocked,true);assert.equal(state.canSave,false);
});
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.attributes={};this.style={setProperty:(k,v)=>this.styles[k]=v};this.styles={};}
 append(...nodes){this.children.push(...nodes);} setAttribute(k,v){this.attributes[k]=v;} addEventListener(k,fn){this.handlers[k]=fn;}
 showModal(){this.open=true;} close(){this.open=false;} focus(){this.focused=true;}
}
async function ui(owner=true){
 const f=await setup(),body=new Element('body'),header=new Element('header'),document={body,createElement:t=>new Element(t)};
 const notices=[];const editor=mountProfileThemeEditor({document,header,profile:{isOwner:owner,accountId:a},client:f.client,storage:f.storage,notify:n=>notices.push(n)});
 return{...f,editor,body,header,document,notices};
}
test('non-owner creates neither trigger nor dialog',async()=>{const f=await ui(false);assert.equal(f.editor,null);assert.equal(f.body.children.length,0);assert.equal(f.header.children.length,0);});
test('dialog labels, picker/HEX synchronization, strict validation and CSS preview',async()=>{
 const f=await ui(),e=f.editor;e.dialog.showModal();await e.controller.open();
 assert.equal(e.trigger.attributes['aria-label'],'プロフィールカラーを編集');assert.equal(e.dialog.attributes['aria-labelledby'],'profile-theme-title');
 e.fields.background.picker.value='#123456';e.fields.background.picker.handlers.input();assert.equal(e.fields.background.hex.value,'#123456');assert.equal(f.body.styles['--profile-bg'],'#123456');
 e.fields.panel.hex.value='#abcdef';e.fields.panel.hex.handlers.input();assert.equal(e.fields.panel.picker.value,'#abcdef');assert.equal(f.body.styles['--profile-panel'],'#abcdef');
 for(const value of ['FFF','#FFF','red','rgb(1,2,3)','#GGGGGG']){e.fields.panel.hex.value=value;e.fields.panel.hex.handlers.input();assert.equal(e.save.disabled,true);assert.equal(e.fields.panel.hex.attributes['aria-invalid'],'true');assert.equal(f.body.styles['--profile-panel'],'#abcdef');}
 e.dark.handlers.click();assert.equal(e.save.disabled,false);assert.deepEqual(f.body.styles,{'--profile-bg':'#10161A','--profile-panel':'#182126','--profile-text':'#EDF2F4','--profile-accent':'#E0C45A'});
 e.light.handlers.click();assert.equal(e.save.disabled,true);assert.equal(f.calls.length,1);
 e.dark.handlers.click();let prevented=false;e.dialog.handlers.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(e.dialog.open,false);assert.equal(e.trigger.focused,true);assert.equal(f.body.styles['--profile-bg'],'#DCEEF3');assert.equal(f.calls.length,1);
});
test('latest theme on open, cancel, successful save closes/focuses/notifies with preview retained',async()=>{
 const f=await ui(),e=f.editor;f.update(d=>d.presentation.battler.profile.theme={...THEME_PRESETS.dark});
 e.dialog.showModal();await e.controller.open();assert.equal(e.fields.background.hex.value,'#10161A');
 e.light.handlers.click();e.cancel.handlers.click();assert.equal(f.body.styles['--profile-bg'],'#10161A');
 e.dialog.showModal();await e.controller.open();e.light.handlers.click();await e.controller.save();assert.equal(e.dialog.open,false);assert.equal(e.trigger.focused,true);assert.equal(f.body.styles['--profile-bg'],'#DCEEF3');assert.equal(f.notices[0].message,'保存しました。');
});
test('loading disables fields/presets/save and cancel discards delayed load',async()=>{
 const f=await ui(),e=f.editor;let resolve;f.storage.load=()=>new Promise(r=>resolve=r);
 e.trigger.handlers.click();assert.equal(e.dialog.open,true);assert.equal(e.save.disabled,true);assert.equal(e.light.disabled,true);assert.equal(e.fields.text.hex.disabled,true);
 e.cancel.handlers.click();resolve({ok:false,status:'load-failed'});await new Promise(r=>setImmediate(r));assert.equal(e.dialog.open,false);
});
test('transient load failure on save keeps dialog/draft; retry succeeds; in-flight save cannot be double submitted',async()=>{
 const f=await ui(),e=f.editor;e.dialog.showModal();await e.controller.open();e.dark.handlers.click();
 const load=f.storage.load;f.storage.load=async()=>({ok:false,status:'load-failed',message:'読み込み失敗'});await e.controller.save();
 assert.equal(e.dialog.open,true);assert.equal(e.save.disabled,false);assert.equal(e.fields.background.hex.value,'#10161A');assert.equal(f.body.styles['--profile-bg'],'#10161A');
 let resolve;f.storage.load=()=>new Promise(r=>resolve=r);const pending=e.controller.save();assert.equal(e.save.disabled,true);assert.equal(e.cancel.disabled,true);
 await e.controller.save();e.controller.cancel();assert.equal(e.dialog.open,true);resolve(await load({gameAccountId:a}));await pending;assert.equal(e.dialog.open,false);
});
test('save-unknown/forbidden UI stays open with draft and preview, disabled save',async()=>{
 for(const mode of ['unknown','forbidden']){const f=await ui(),e=f.editor;e.dialog.showModal();await e.controller.open();e.dark.handlers.click();f.mode(mode);await e.controller.save();
 assert.equal(e.dialog.open,true);assert.equal(e.save.disabled,true);assert.equal(e.fields.background.hex.value,'#10161A');assert.equal(f.body.styles['--profile-bg'],'#10161A');assert.ok(e.status.textContent);}
});
