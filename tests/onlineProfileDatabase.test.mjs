import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { a,b,da,db as duckB,privateDuck,player } from './onlineSelectFixture.mjs';
import { encodeOnlinePlayer } from '../js/onlinePlayerDto.js';
import { createEmptyBattlerProfile, createEmptyDuckProfile } from '../js/playerPresentationModel.js';
import { decodeOnlineProfile } from '../js/onlineProfileService.js';
import { profileOptionSelections } from './onlineProfileFixture.mjs';
let PGlite;
if(process.env.PGLITE_MODULE)({PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE)));
const userA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',userB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const third='66666666-6666-4666-8666-666666666666',battle='77777777-7777-4777-8777-777777777777';
test('dedicated authenticated public profile DB boundary',{skip:!PGlite&&'Set PGLITE_MODULE'},async t=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      grant execute on function auth.uid() to authenticated,anon,service_role;`);
    for(const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())
      await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    await db.exec(`insert into auth.users values ('${userA}'),('${userB}');
      insert into public.game_accounts(id) values ('${a}'),('${b}'),('${third}');
      insert into public.game_account_access(auth_user_id,game_account_id) values ('${userA}','${a}'),('${userB}','${b}');
      insert into public.battlers(game_account_id,presentation) values ('${a}','{"name":"registration"}'),('${b}','{"name":"B"}'),('${third}','{"name":"third"}');`);
    const {data}=await player(b,'2',duckB);
    const bp=data.presentation.battler.profile;
    bp.text=' raw [b]profile[/b]\n ';bp.iconSlots=[1,3];bp.theme.accent='#abcdef';
    data.presentation.battler.standingImageUrl='standing.png';
    data.presentation.battler.iconSlots[0]='one.png';data.presentation.battler.iconSlots[1]='SECRET-unselected';
    data.presentation.battler.quotes.battleStart.text='SECRET-quotes';
    data.presentation.ducks.orphan={iconUrl:'SECRET-detached',cutinUrl:'',profile:createEmptyDuckProfile()};
    const dp=data.presentation.ducks[duckB].profile;
    Object.assign(dp,{text:' duck\n ',type:'technical',attributes:['🔥','炎',''],statLabelPreset:'kanji',flavorStats:[{label:'',value:0},{label:'味',value:6}]});
    data.presentation.ducks[duckB].cutinUrl='SECRET-cutin';
    const dto=encodeOnlinePlayer(data);
    async function restore() {
      await db.exec('reset role');
      await db.query('update public.battlers set build=$1::jsonb,presentation=$2::jsonb where game_account_id=$3',[JSON.stringify(dto.battler.build),JSON.stringify(dto.battler.presentation),b]);
      await db.query('insert into public.ducks(id,game_account_id,build,presentation) values ($1,$2,$3::jsonb,$4::jsonb) on conflict(id) do update set build=excluded.build,presentation=excluded.presentation',
        [duckB,b,JSON.stringify(dto.ducks[0].build),JSON.stringify(dto.ducks[0].presentation)]);
      await db.query('update public.game_accounts set public_duck_id=$1 where id=$2',[duckB,b]);
    }
    await restore();
    await db.query('insert into public.ducks(id,game_account_id,presentation) values ($1,$2,$3::jsonb)',[privateDuck,b,JSON.stringify({name:'SECRET-privateDuck'})]);
    const asUser=async user=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${user}',false);`);
    const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0].data;
    const get=()=>value('select public.get_online_profile(2) data');
    await asUser(userA);
    for (const [category, axis, selection] of profileOptionSelections) await t.test(`RPC to decoder preserves ${category} options.${axis} and excludes unknown options`, async () => {
      await db.exec('reset role');
      const stored = structuredClone(selection);
      const leaf = category === 'B' ? stored : category === 'A' ? stored.effects[0] : stored.structure.effects[0];
      leaf.options.unknownOption = 'SECRET-option';
      const field = category.toLowerCase() + 'Selection';
      if (category === 'B') await db.query('update public.battlers set build=jsonb_set(build,$1::text[],$2::jsonb) where game_account_id=$3', [[field], JSON.stringify(stored), b]);
      else await db.query('update public.ducks set build=jsonb_set(build,$1::text[],$2::jsonb) where id=$3', [[field], JSON.stringify(stored), duckB]);
      await asUser(userA);
      const raw = await get(), owner = category === 'B' ? 'battler' : 'duck';
      assert.deepEqual(raw[owner].skills[category].selection, selection);
      assert.deepEqual(decodeOnlineProfile(raw)[owner].skills[category].selection, selection);
      assert.doesNotMatch(JSON.stringify(raw), /SECRET-option|unknownOption/);
      await restore(); await asUser(userA);
    });
    await t.test('foreign profile uses v1 API contract with lossless v2 fields and selected empty URL',async()=>{
      const raw=await get(),p=decodeOnlineProfile(raw);assert.deepEqual(p,raw);
      assert.equal(p.isOwner,false);assert.equal(p.accountId,b);assert.equal(p.eno,'2');
      assert.deepEqual(p.battler.profile,{text:bp.text,theme:bp.theme});
      assert.deepEqual(p.battler.profileIcons,[{slot:1,url:'one.png'},{slot:3,url:''}]);
      assert.deepEqual(p.duck.profile,dp);assert.deepEqual(p.duck.stats,data.build.ducks[0].stats);
      for(const [key,selection,label] of [['B',data.build.battler.bSelection,data.build.battler.skillLabels.B],['D',data.build.battler.dSelection,data.build.battler.skillLabels.D]])
        assert.deepEqual(p.battler.skills[key],{selection,label});
      for(const [key,selection,label] of [['A',data.build.ducks[0].aSelection,data.build.ducks[0].skillLabels.A],['C',data.build.ducks[0].cSelection,data.build.ducks[0].skillLabels.C]])
        assert.deepEqual(p.duck.skills[key],{selection,label});
      assert.equal(p.featuredBattle,null);
      assert.doesNotMatch(JSON.stringify(p),/SECRET|cutinUrl|quotes|dice|diceFrame|detached|save_revision|auth_user|featuredBattleId/);
    });
    await t.test('own, multiple-access, zero-access callers; isOwner is per target',async()=>{
      await asUser(userB);assert.equal((await get()).isOwner,true);
      await db.exec(`reset role;insert into public.game_account_access(auth_user_id,game_account_id) values ('${userA}','${b}');`);
      await asUser(userA);assert.equal((await get()).isOwner,true);
      assert.equal((await value('select public.get_online_profile(1) data')).isOwner,true);
      assert.equal((await value('select public.get_online_profile(3) data')).isOwner,false);
      await asUser('cccccccc-cccc-4ccc-8ccc-cccccccccccc');assert.equal((await get()).isOwner,false);
      await asUser(userB);
    });
    await t.test('unknown ENo returns null; invalid and absent identity are rejected',async()=>{
      assert.equal(await value('select public.get_online_profile(999) data'),null);
      for(const eno of [null,0,-1])await assert.rejects(value('select public.get_online_profile($1) data',[eno]),{code:'22023'});
      await asUser('');await assert.rejects(get(),{code:'42501'});await asUser(userB);
    });
    await t.test('registration name-only data returns defaults and no Duck',async()=>{
      const p=decodeOnlineProfile(await value('select public.get_online_profile(1) data'));
      assert.equal(p.battler.name,'registration');assert.equal(p.duck,null);assert.equal(p.featuredBattle,null);
      const {text,theme}=createEmptyBattlerProfile();assert.deepEqual(p.battler.profile,{text,theme});
      assert.deepEqual(p.battler.profileIcons,[]);assert.equal(p.battler.skills.B.selection,null);
    });
    await t.test('unpublished full Battler is still public; partial build stats are accepted',async()=>{
      await db.exec(`reset role;update public.game_accounts set public_duck_id=null where id='${b}';`);await asUser(userB);
      const p=decodeOnlineProfile(await get());assert.equal(p.duck,null);assert.equal(p.battler.profile.text,bp.text);
      await restore();await db.query("update public.ducks set build=jsonb_set(build,'{stats}','{\"AT\":null,\"DF\":0,\"SP\":null}') where id=$1",[duckB]);
      await asUser(userB);assert.deepEqual(decodeOnlineProfile(await get()).duck.stats,{AT:null,DF:0,SP:null});await restore();await asUser(userB);
    });
    await t.test('v1 presentation and v2 build provide explicit defaults without persistence changes',async()=>{
      await db.exec(`reset role;
        update public.battlers set presentation=jsonb_set(presentation-'profile','{schemaVersion}','1'),build=jsonb_set(build-'skillLabels','{schemaVersion}','2') where game_account_id='${b}';
        update public.ducks set presentation=jsonb_set(presentation #- '{icon,profile}','{schemaVersion}','1'),build=jsonb_set(build-'skillLabels','{schemaVersion}','2') where id='${duckB}';`);
      await asUser(userB);const p=decodeOnlineProfile(await get());
      const {text,theme}=createEmptyBattlerProfile();assert.deepEqual(p.battler.profile,{text,theme});assert.deepEqual(p.duck.profile,createEmptyDuckProfile());
      assert.deepEqual(p.battler.skills.B.label,{name:'',ruby:''});assert.deepEqual(p.duck.skills.A.label,{name:'',ruby:''});
      assert.equal((await value('select presentation data from public.battlers where game_account_id=$1',[b])).schemaVersion,1);
      await restore();await asUser(userB);
    });
    await t.test('v2 null Duck display uses empty profile and icon',async()=>{
      await db.exec(`reset role;update public.ducks set presentation=jsonb_set(presentation,'{icon}','null') where id='${duckB}';`);
      await asUser(userB);const p=decodeOnlineProfile(await get());assert.deepEqual(p.duck.profile,createEmptyDuckProfile());assert.equal(p.duck.iconUrl,'');
      await restore();await asUser(userB);
    });
    await t.test('unknown fields in stored objects cannot cross whitelist, including selections/labels',async()=>{
      await db.exec('reset role');
      const build=structuredClone(dto.battler.build);build.skillLabels.B.private='SECRET-label';build.bSelection={...build.bSelection,private:'SECRET-selection'};
      const pres=structuredClone(dto.battler.presentation);pres.profile.theme.mode='SECRET-mode';pres.private='SECRET-field';
      const duckPres=structuredClone(dto.ducks[0].presentation);duckPres.icon.profile.flavorStats[0].private='SECRET-flavor';
      await db.query('update public.battlers set build=$1,presentation=$2 where game_account_id=$3',[JSON.stringify(build),JSON.stringify(pres),b]);
      await db.query('update public.ducks set presentation=$1 where id=$2',[JSON.stringify(duckPres),duckB]);
      await asUser(userB);assert.doesNotMatch(JSON.stringify(decodeOnlineProfile(await get())),/SECRET/);
      await restore();await asUser(userB);
    });
    await t.test('future versions and missing or object-valued public data are not normalized to defaults',async()=>{
      for(const sql of [
        `update public.battlers set presentation=jsonb_set(presentation,'{schemaVersion}','99') where game_account_id='${b}'`,
        `update public.ducks set presentation=jsonb_set(presentation,'{schemaVersion}','99') where id='${duckB}'`,
        `update public.battlers set build=jsonb_set(build,'{schemaVersion}','99') where game_account_id='${b}'`,
        `update public.battlers set presentation=presentation-'profile' where game_account_id='${b}'`,
        `update public.battlers set presentation=jsonb_set(presentation,'{profile,text}','{"private":"SECRET"}') where game_account_id='${b}'`,
        `update public.ducks set presentation=jsonb_set(presentation,'{icon,profile,attributes}','[{"private":"SECRET"},"",""]') where id='${duckB}'`,
      ]) {await db.exec('reset role');await db.exec(sql);await asUser(userB);await assert.rejects(get(),{code:'22023'});await restore();}
      await asUser(userB);
    });
    await t.test('malformed scalar profile values remain invalid at client boundary, never defaulted',async()=>{
      for(const [path,value] of [['{profile,theme,accent}','bad-color'],['{profile,text}',null]]) {
        await db.exec('reset role');await db.query('update public.battlers set presentation=jsonb_set(presentation,$1::text[],$2::jsonb) where game_account_id=$3',[path,JSON.stringify(value),b]);
        await asUser(userB);const response=await get();assert.throws(()=>decodeOnlineProfile(response),TypeError);await restore();
      }
      await asUser(userB);
    });
    await t.test('featured battle requires current favorite, not participation; summary only; unfavorite/deletion hides it',async()=>{
      await db.exec('reset role');
      const side={battlerName:'historical',duckName:'historical Duck',presentation:{battlerDefaultIconUrl:'b.png',duckIconUrl:'d.png',quotes:'SECRET',cutinUrl:'SECRET'},loadout:'SECRET'};
      await db.query('insert into public.battles(id,p1_account_id,p1_eno,p1_duck_id,p2_account_id,p2_eno,p2_duck_id,result,record) values ($1,$2,1,$3,$4,3,$5,\'draw\',$6)',
        [battle,a,da,third,privateDuck,JSON.stringify({p1:side,p2:side,events:'SECRET'})]);
      await db.query('insert into public.battles(id,p1_account_id,p1_eno,p1_duck_id,p2_account_id,p2_eno,p2_duck_id,result,record) values ($1,$2,1,$3,$4,3,$5,\'draw\',$6)',
        [da,a,da,third,privateDuck,JSON.stringify({p1:{...side,battlerName:'SECRET-other-favorite'},p2:side,events:[]})]);
      await db.query('insert into public.battle_favorites(game_account_id,battle_id) values ($1,$2)',[b,da]);
      await db.query("update public.battlers set presentation=jsonb_set(presentation,'{profile,featuredBattleId}',to_jsonb($1::text)) where game_account_id=$2",[battle,b]);
      await asUser(userB);assert.equal((await get()).featuredBattle,null);
      await db.exec(`reset role;insert into public.battle_favorites(game_account_id,battle_id) values ('${b}','${battle}');`);
      await asUser(userA);const featured=decodeOnlineProfile(await get()).featuredBattle;
      assert.equal(featured.battleId,battle);assert.equal(featured.battleNo,'1');assert.equal(featured.p1.eno,'1');assert.equal(featured.p2.eno,'3');
      assert.doesNotMatch(JSON.stringify(featured),/SECRET|events|record|loadout|quotes|cutin|favorite/);
      await db.exec(`reset role;delete from public.battle_favorites where game_account_id='${b}';`);await asUser(userB);assert.equal((await get()).featuredBattle,null);
      await db.exec(`reset role;insert into public.battle_favorites(game_account_id,battle_id) values ('${b}','${battle}');delete from public.battles where id='${battle}';`);
      await asUser(userB);assert.equal((await get()).featuredBattle,null);
      await restore();await asUser(userB);
    });
    await t.test('RLS remains closed; anon and helper EXECUTE denied; invoker entrypoint and fixed search paths',async()=>{
      await asUser(userB);assert.equal((await db.query('select * from public.battlers where game_account_id=$1',[a])).rows.length,0);
      await assert.rejects(db.query('select * from public.battle_favorites'),{code:'42501'});
      await assert.rejects(value("select diesduck_private.profile_fields('{}',array['name'],'string') data"),{code:'42501'});
      await db.exec('reset role');
      const procs=(await db.query("select proname,prosecdef,proconfig from pg_proc where proname in ('public_profile','get_online_profile')")).rows;
      for(const p of procs){assert.equal(p.prosecdef,p.proname==='public_profile');assert.ok(p.proconfig.includes('search_path=""'));}
      await db.exec('set role anon');await assert.rejects(get(),{code:'42501'});
      await assert.rejects(value('select diesduck_private.public_profile(2) data'),{code:'42501'});
    });
  } finally {await db.close();}
});
