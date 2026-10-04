// In-memory RPC transport for presentation/engine unit tests; not an application fallback.
export function battleResultRpcFixture(battleId) {
  let saved;
  return {async rpc(name,args) {
    if(name==='save_online_battle_result') {
      const meta={battleId,battleNo:1,dateISO:'2026-10-04T12:00:00Z'};
      saved=JSON.parse(JSON.stringify({...args.p_record,...meta}));return {data:meta};
    }
    if(name==='get_online_battle_result')return {data:structuredClone(saved??null)};
    throw new Error('Unexpected result RPC');
  }};
}
