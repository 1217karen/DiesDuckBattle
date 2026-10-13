import { renderProfileBattleCard } from '../js/profileBattleCard.js';
import { FIXED_IMAGES } from '../js/fixedImages.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileBattleController } from '../js/profileBattleController.js';
import { mountProfileBattleEditor } from '../js/profileBattleEditor.js';
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
  const listCalls=[], records=Array.from({length:31},(_,i)=>({battleId:i===0?b:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,battleNo:String(i+1),dateISO:'2026-10-14T00:00:00Z',p1:{eno:'100',battlerName:'<script>name</script>'},p2:{eno:'200',battlerName:'other'},result:'P1_win'}));
  const storage=createOnlinePlayerStorage(client),controller=createProfileBattleController({storage,profile:{isOwner:true,accountId:a,eno:'88'},battles:{list:async p=>{listCalls.push(p);return{ok:true,records:records.slice((p.page-1)*30,p.page*30),page:p.page,total:records.length,totalPages:Math.ceil(records.length/30)}}},service:{getProfile:async eno=>{assert.equal(eno,'88');return{ok:true,profile:{isOwner:true,accountId:a,featuredBattle:records.find(r=>r.battleId===decodeOnlinePlayer(row).presentation.battler.profile.featuredBattleId)??null}}}},changed:s=>states.push(s),updated:p=>notices.push(p)});
  return{controller,storage,client,records,listCalls,calls,previews,notices,state:()=>states.at(-1),row:()=>row,
    update(fn){const data=decodeOnlinePlayer(row);fn(data);row={...row,...encodeOnlinePlayer(data),revision:String(Number(row.revision)+1)};},
    user:v=>user=v,mode:v=>mode=v,race:()=>race=true};
}

test('favorite-only explicit account, current selection, 31 favorites paging and nonparticipant selection',async()=>{
 const f=await setup();await f.controller.open();assert.deepEqual(f.listCalls[0],{page:1,pageSize:30,order:'desc',favoritesOnly:true,gameAccountId:a});
 assert.equal(f.state().selected,b);assert.equal(f.state().canSave,false);assert.equal(f.state().records.length,30);
 await f.controller.page(2);assert.equal(f.state().records.length,1);f.controller.select(f.records[30].battleId);await f.controller.save();
 assert.equal(f.notices[0].featuredBattle.battleId,f.records[30].battleId);assert.equal(f.state().active,false);
});
test('fresh authorized read preserves every unrelated field; changing and clearing never mutate favorites',async()=>{
 const f=await setup();await f.controller.open();f.controller.select(f.records[1].battleId);
 f.update(d=>{d.battlerName='latest';d.presentation.battler.profile.text='new text';d.presentation.battler.quotes.battleStart.lines[0].text='new quote';d.presentation.ducks[da].cutinUrl='new image';});
 const expected=decodeOnlinePlayer(f.row());expected.presentation.battler.profile.featuredBattleId=f.records[1].battleId;
 await f.controller.save();assert.deepEqual(decodeOnlinePlayer(f.row()),expected);assert.equal(f.calls.at(-1).p.p_expected_revision,'1');
 await f.controller.open();await f.controller.clear();assert.equal(decodeOnlinePlayer(f.row()).presentation.battler.profile.featuredBattleId,null);assert.equal(f.notices.at(-1).featuredBattle,null);assert.equal(f.records.length,31);
 assert.ok(f.calls.every(c=>['load_online_player','save_online_player'].includes(c.name)));
});
test('empty favorites, unchanged save and cancellation make no writes',async()=>{
 const f=await setup();f.records.length=0;await f.controller.open();assert.match(f.state().message,/ありません/);await f.controller.save();f.controller.cancel();assert.equal(f.calls.length,1);
 const g=await setup();await g.controller.open();g.controller.select(g.records[1].battleId);g.controller.cancel();await g.controller.save();assert.equal(g.calls.length,1);
});
test('conflict keeps draft and explicit retry rereads latest',async()=>{
 const f=await setup();await f.controller.open();f.controller.select(f.records[1].battleId);f.race();await f.controller.save();assert.equal(f.state().canSave,true);assert.equal(f.notices.length,0);assert.match(f.state().message,/もう一度/);
 f.update(d=>d.presentation.battler.profile.text='after conflict');await f.controller.save();assert.equal(decodeOnlinePlayer(f.row()).presentation.battler.profile.text,'after conflict');assert.equal(f.notices.length,1);
});
for(const mode of ['unknown','forbidden'])test(`save ${mode} keeps public display and blocks repeated writes`,async()=>{
 const f=await setup();await f.controller.open();f.controller.select(f.records[1].battleId);f.mode(mode);await f.controller.save();assert.equal(f.state().canSave,false);assert.equal(f.notices.length,0);const n=f.calls.length;await f.controller.save();assert.equal(f.calls.length,n);
});
for(const user of [null,'another-owner'])test(`identity change ${user} prevents saving despite accessible account`,async()=>{
 const f=await setup();await f.controller.open();f.controller.select(f.records[1].battleId);f.user(user);await f.controller.save();assert.equal(f.calls.some(c=>c.name==='save_online_player'),false);assert.equal(f.notices.length,0);
});
test('duplicate save and cancel during save are blocked',async()=>{
 const f=await setup();await f.controller.open();f.controller.select(f.records[1].battleId);let resolve;const load=f.storage.load;f.storage.load=()=>new Promise(r=>resolve=r);
 const pending=f.controller.save();await f.controller.save();f.controller.cancel();assert.equal(f.state().saving,true);resolve(await load({gameAccountId:a}));await pending;assert.equal(f.calls.filter(c=>c.name==='save_online_player').length,1);
});
test('cancellation and auth events discard delayed loads',async()=>{
 for(const action of ['cancel','sessionChanged']){let resolve,state;const controller=createProfileBattleController({profile:{isOwner:true,accountId:a},storage:{load:()=>new Promise(r=>resolve=r)},battles:{list:()=>assert.fail('stale list')},changed:s=>state=s});const pending=controller.open();controller[action](null);resolve({ok:true,authUserId:'owner',data:{presentation:{battler:{profile:{featuredBattleId:null}}}}});await pending;assert.equal(state.blocked,true);}
});
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.handlers={};this.attributes={};}
 append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=[...nodes];} setAttribute(k,v){this.attributes[k]=v;} addEventListener(k,fn){this.handlers[k]=fn;}
 showModal(){this.open=true;} close(){this.open=false;} focus(){this.focused=true;}
}
async function ui(owner){
 if(arguments.length===0) owner=true;
 const f=await setup(),body=new Element('body'),container=new Element('section');container.append(new Element('h2'));const document={body,createElement:t=>new Element(t)};
 const battles={list:async p=>({ok:true,records:f.records.slice((p.page-1)*30,p.page*30),page:p.page,total:f.records.length,totalPages:2})};
 const service={getProfile:async()=>({ok:true,profile:{isOwner:true,accountId:a,featuredBattle:null}})};
 const editor=mountProfileBattleEditor({document,container,profile:{isOwner:owner,accountId:a,eno:'88'},client:f.client,storage:f.storage,battles,service});return{...f,body,container,editor,battles,service};
}
for(const owner of [false,undefined,null])test(`non-owner ${owner} has no editor DOM`,async()=>{const f=await ui(owner);assert.equal(f.editor,null);assert.equal(f.body.children.length,0);assert.equal(f.container.children[0].children.length,0);});
test('safe names, accessible dialog and radio selection, public refresh replaces favorite section only',async()=>{
 const f=await ui(),e=f.editor;e.dialog.showModal();await e.controller.open();assert.equal(e.dialog.attributes['aria-labelledby'],'profile-battle-title');assert.equal(e.list.children[0].children[0].checked,true);const name=descendants(e.list.children[0]).find(n=>n.className==='profile-battle-name');assert.equal(name.textContent,'<script>name</script>');assert.equal(name.children.length,0);
 e.list.children[1].children[0].handlers.change();assert.equal(e.list.children[1].children[0].focused,true);assert.equal(e.save.disabled,false);
 await e.controller.clear();assert.equal(e.dialog.open,false);assert.equal(f.container.children[1].textContent,'お気に入りバトルは設定されていません');assert.equal(f.container.children[0].children[0],e.trigger);
});
test('list failure disables selection/save and public refresh failure preserves original section',async()=>{
 const f=await ui(),e=f.editor;f.battles.list=async()=>{throw Error('network')};await e.controller.open();assert.equal(e.save.disabled,true);assert.equal(e.list.children.length,0);assert.match(e.status.textContent,/取得できません/);
 const g=await ui(),x=g.editor;await x.controller.open();x.controller.select(g.records[1].battleId);g.service.getProfile=async()=>({ok:false});const before=g.container.children[0];await x.controller.save();assert.equal(g.container.children[0],before);assert.match(x.status.textContent,/保存しましたが/);assert.equal(x.save.disabled,true);
});

test('successful public refresh displays selected battle and changing it replaces the link',async()=>{
 const f=await ui(),e=f.editor;f.service.getProfile=async()=>({ok:true,profile:{isOwner:true,accountId:a,featuredBattle:f.records.find(r=>r.battleId===decodeOnlinePlayer(f.row()).presentation.battler.profile.featuredBattleId)}});
 for(const index of [1,2]){await e.controller.open();e.controller.select(f.records[index].battleId);await e.controller.save();assert.equal(f.container.children[1].href,`result.html?battleId=${f.records[index].battleId}`);assert.equal(f.container.children[0].children[0],e.trigger);}
});
test('auth change during public refresh discards response and hides edit trigger',async()=>{
 const f=await ui(),e=f.editor;await e.controller.open();e.controller.select(f.records[1].battleId);let resolve;
 f.service.getProfile=()=>new Promise(r=>resolve=r);const pending=e.controller.save();while(!resolve)await new Promise(r=>setImmediate(r));
 const heading=f.container.children[0];e.controller.sessionChanged(null);resolve({ok:true,profile:{isOwner:true,accountId:a,featuredBattle:null}});await pending;
 assert.equal(f.container.children[0],heading);assert.equal(e.trigger.hidden,true);assert.equal(e.save.disabled,true);
});

for(const user of ['owner',null,'another-owner'])test(`closed editor ignores auth event ${user}, before first open and after cancel`,async()=>{
 const f=await ui(),e=f.editor;
 e.controller.sessionChanged(user);assert.notEqual(e.trigger.hidden,true);
 await e.controller.open();assert.equal(e.list.children.length,30);assert.equal(e.next.disabled,false);
 e.controller.cancel();e.controller.sessionChanged(user);assert.notEqual(e.trigger.hidden,true);
 await e.controller.open();e.controller.select(f.records[1].battleId);assert.equal(e.save.disabled,false);
});
test('same user auth event preserves open draft and pending save',async()=>{
 const f=await setup();await f.controller.open();f.controller.select(f.records[1].battleId);
 const before=structuredClone(f.state());f.controller.sessionChanged('owner');assert.deepEqual(f.state(),before);
 let resolve;const load=f.storage.load;f.storage.load=()=>new Promise(r=>resolve=r);
 const pending=f.controller.save();f.controller.sessionChanged('owner');assert.equal(f.state().saving,true);
 resolve(await load({gameAccountId:a}));await pending;assert.equal(f.notices.length,1);
});
for(const user of [null,'another-owner'])test(`auth event ${user} blocks open editing and delayed save`,async()=>{
 const f=await setup();await f.controller.open();f.controller.select(f.records[1].battleId);
 let resolve;const load=f.storage.load;f.storage.load=()=>new Promise(r=>resolve=r);
 const pending=f.controller.save();f.controller.sessionChanged(user);
 assert.equal(f.state().canSave,false);assert.equal(f.state().unavailable,true);
 resolve(await load({gameAccountId:a}));await pending;await f.controller.save();
 assert.equal(f.calls.some(c=>c.name==='save_online_player'),false);assert.equal(f.notices.length,0);
});

function descendants(node){return [node,...node.children.flatMap(descendants)];}

for(const history of [true,false])for(const result of ['P1_win','P2_win','draw'])test(`battle card ${history?'history':'public'} renders icons, names and ${result}`,()=>{
 const document={createElement:t=>new Element(t)};
 const makeSide=eno=>({eno,battlerName:'<b>バトラー</b>',duckName:'アヒル',...(history?{presentation:{battlerDefaultIconUrl:`/${eno}-b.png`,duckIconUrl:`/${eno}-d.png`}}:{battlerDefaultIconUrl:`/${eno}-b.png`,duckIconUrl:`/${eno}-d.png`})});
 const card=renderProfileBattleCard(document,{battleNo:'123',dateISO:'2026-10-14T00:00:00Z',result,p1:makeSide('111'),p2:makeSide('222')},{history,current:true});
 const nodes=descendants(card),images=nodes.filter(n=>n.tagName==='img');
 assert.deepEqual(images.map(n=>n.src),['/111-b.png','/111-d.png','/222-b.png','/222-d.png']);
 images.forEach(n=>n.handlers.error());assert.deepEqual(images.map(n=>n.src),[FIXED_IMAGES.battlerIcon,FIXED_IMAGES.duckIcon,FIXED_IMAGES.battlerIcon,FIXED_IMAGES.duckIcon]);
 const badges=nodes.filter(n=>n.className.startsWith('profile-battle-badge '));assert.deepEqual(badges.map(n=>n.textContent),result==='draw'?['DRAW','DRAW']:result==='P1_win'?['WIN','LOSE']:['LOSE','WIN']);
 assert.ok(nodes.some(n=>n.textContent==='現在掲載中'));assert.ok(nodes.some(n=>n.textContent==='Battle No.123'));assert.ok(nodes.some(n=>n.textContent==='P2 / ENo.222'));
 const name=nodes.find(n=>n.textContent==='<b>バトラー</b>');assert.equal(name.children.length,0);assert.equal(nodes.some(n=>n.tagName==='a'),false);
});
test('history cards without registered icons use fixed images',()=>{
 const document={createElement:t=>new Element(t)},side={eno:'1',battlerName:'name',duckName:'duck'};
 const card=renderProfileBattleCard(document,{battleNo:'1',dateISO:'2026-10-14T00:00:00Z',result:'draw',p1:side,p2:side},{history:true});
 assert.deepEqual(descendants(card).filter(n=>n.tagName==='img').map(n=>n.src),[FIXED_IMAGES.battlerIcon,FIXED_IMAGES.duckIcon,FIXED_IMAGES.battlerIcon,FIXED_IMAGES.duckIcon]);
});
