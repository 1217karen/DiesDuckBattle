import { getOpponent } from '../js/opponentSource.js';
import { migratePlayerBuild } from '../js/playerBuildMigration.js';
import { createEmptyPlayerPresentation } from '../js/playerPresentationModel.js';
import { encodeOnlinePlayer } from '../js/onlinePlayerDto.js';
export const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
export const da='33333333-3333-4333-8333-333333333333', db='44444444-4444-4444-8444-444444444444', privateDuck='55555555-5555-4555-8555-555555555555';
export async function player(id, eno, duckId) {
  const fixture=await getOpponent('dev-opponent-2');
  const build=migratePlayerBuild(fixture.build).build; build.ducks[0].id=duckId;
  const presentation=createEmptyPlayerPresentation();
  presentation.battler.defaultIconUrl='https://example.invalid/'+eno+'.png';
  presentation.battler.quotes.battleStart.text='開始'+eno;
  presentation.ducks[duckId]={iconUrl:'https://example.invalid/duck'+eno+'.png',cutinUrl:'https://example.invalid/cutin'+eno+'.png'};
  const data={build,presentation,publicSettings:{schemaVersion:1,publicDuckId:duckId},battlerName:'DB名'+eno};
  return {data,snapshot:{...encodeOnlinePlayer(data),gameAccountId:id,eno,revision:'0'}};
}
export async function fixture() {
  const rows=new Map([[a,(await player(a,'88',da)).snapshot],[b,(await player(b,'89',db)).snapshot]]);
  let user='auth-A',access=[a],error=null,gate=null;
  const calls=[];
  const client={auth:{getSession:async()=>({data:{session:user?{user:{id:user}}:null}})},
    from:table=>{if(table!=='game_account_access')throw Error('whole table read forbidden'); return {select:()=>({eq:async()=>({data:access.map(id=>({game_account_id:id,game_accounts:{eno:rows.get(id).eno}}))})})};},
    rpc:async(name,params)=>{
      calls.push([name,params]); if(gate) await gate;
      if(error==='network')throw Error('SECRET'); if(error)return{error:{code:error,message:'SECRET'}};
      if(name==='load_online_player')return {data:structuredClone(rows.get(params.p_game_account_id))};
      const publicRow=id=>{const row=structuredClone(rows.get(id));if(!row?.publicDuckId || access.includes(id))return null;
        row.ducks=row.ducks.filter(d=>d.id===row.publicDuckId);row.battler.presentation.detachedDuckPresentation={};return row;};
      if(name==='list_online_opponents')return {data:[...rows.keys()].map(publicRow).filter(Boolean).map(r=>({id:r.gameAccountId,eno:r.eno,name:r.battler.presentation.name,publicDuckId:r.publicDuckId}))};
      if(name==='get_online_opponent')return {data:publicRow(params.p_game_account_id)};
      if(name==='prepare_online_battle') {const opponent=publicRow(params.p_opponent_account_id);
        return {data:opponent?.publicDuckId===params.p_opponent_duck_id?{self:structuredClone(rows.get(params.p_game_account_id)),opponent}:null};}
      throw Error('Unexpected RPC');
    }};
  return {client,rows,calls,user:v=>{user=v;},access:v=>{access=v;},error:v=>{error=v;},gate:v=>{gate=v;}};
}
