begin;

alter table public.battles add column selection_mode text not null default 'manual'
  check (selection_mode in ('manual', 'random'));
-- Existing snapshots keep their original display/event data, with explicit legacy mode.
update public.battles set record = record || jsonb_build_object('selectionMode', 'manual');
create index battles_p1_streak_idx on public.battles(p1_account_id, battle_no desc)
  include (selection_mode, result);

create or replace function diesduck_private.save_battle_result(
  p_p1_account_id uuid, p_p1_duck_id uuid, p_p2_account_id uuid, p_p2_duck_id uuid, p_record jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.battles;
  v_p1_eno bigint;
  v_p2_eno bigint;
  v_side text;
  v_key text;
  v_record jsonb;
  v_result text := p_record->>'result';
  v_mode text := case when p_record ? 'selectionMode' then p_record->>'selectionMode' else 'manual' end;
begin
  if auth.uid() is null or not exists (
    select 1 from public.game_account_access
    where auth_user_id = auth.uid() and game_account_id = p_p1_account_id
  ) then raise exception 'Battle access denied' using errcode = '42501'; end if;
  if p_p1_account_id is null or p_p2_account_id is null or p_p1_account_id = p_p2_account_id then
    raise exception 'Invalid participants' using errcode = '22023';
  end if;
  select g.eno into v_p1_eno from public.game_accounts g join public.ducks d on d.game_account_id = g.id
    where g.id = p_p1_account_id and d.id = p_p1_duck_id;
  select g.eno into v_p2_eno from public.game_accounts g join public.ducks d on d.game_account_id = g.id
    where g.id = p_p2_account_id and d.id = p_p2_duck_id;
  -- Publication was checked by prepare_online_battle; only ownership is checked here.
  if v_p1_eno is null or v_p2_eno is null then
    raise exception 'Invalid Duck ownership' using errcode = '22023';
  end if;
  if v_mode is null or v_mode not in ('manual', 'random')
    or (p_record ? 'selectionMode' and jsonb_typeof(p_record->'selectionMode') is distinct from 'string') then
    raise exception 'Invalid selection mode' using errcode = '22023';
  end if;
  if jsonb_typeof(p_record) is distinct from 'object'
    or v_result is null or v_result not in ('P1_win', 'P2_win', 'draw')
    or jsonb_typeof(p_record->'events') is distinct from 'array' then
    raise exception 'Invalid battle record' using errcode = '22023';
  end if;
  foreach v_side in array array['p1','p2'] loop
    if jsonb_typeof(p_record->v_side) is distinct from 'object'
      or jsonb_typeof(p_record#>array[v_side,'presentation']) is distinct from 'object' then
      raise exception 'Invalid participant snapshot' using errcode = '22023';
    end if;
    foreach v_key in array array['battlerId','battlerName','duckId','duckName'] loop
      if jsonb_typeof(p_record#>array[v_side,v_key]) is distinct from 'string' then
        raise exception 'Invalid participant field' using errcode = '22023';
      end if;
    end loop;
  end loop;
  if (p_record#>>'{p1,battlerId}') is distinct from p_p1_account_id::text
    or (p_record#>>'{p2,battlerId}') is distinct from p_p2_account_id::text
    or (p_record#>>'{p1,duckId}') is distinct from p_p1_duck_id::text
    or (p_record#>>'{p2,duckId}') is distinct from p_p2_duck_id::text then
    raise exception 'Participant ID mismatch' using errcode = '22023';
  end if;
  if (p_record#>>'{events,-1,type}') is distinct from 'battleEnd'
    or (p_record#>>'{events,-1,result}') is distinct from v_result
    or (select count(*) from jsonb_array_elements(p_record->'events') e where e->>'type' = 'battleEnd') <> 1
    or exists (select 1 from jsonb_array_elements(p_record->'events') e
      where jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'type') is distinct from 'string') then
    raise exception 'Invalid battle ending' using errcode = '22023';
  end if;
  -- Whitelist record and side fields; never persist loadouts/compiler internals.
  v_record := jsonb_build_object('result', v_result, 'events', p_record->'events', 'selectionMode', v_mode);
  foreach v_side in array array['p1','p2'] loop
    v_record := v_record || jsonb_build_object(v_side, jsonb_build_object(
      'battlerId', p_record#>array[v_side,'battlerId'], 'battlerName', p_record#>array[v_side,'battlerName'],
      'duckId', p_record#>array[v_side,'duckId'], 'duckName', p_record#>array[v_side,'duckName'],
      'eno', case when v_side = 'p1' then v_p1_eno::text else v_p2_eno::text end,
      'presentation', p_record#>array[v_side,'presentation']));
  end loop;
  insert into public.battles(p1_account_id,p1_eno,p1_duck_id,p2_account_id,p2_eno,p2_duck_id,result,record,selection_mode)
    values (p_p1_account_id,v_p1_eno,p_p1_duck_id,p_p2_account_id,v_p2_eno,p_p2_duck_id,v_result,v_record,v_mode)
    returning * into v_row;
  v_record := v_record || jsonb_build_object('battleId', v_row.id, 'battleNo', v_row.battle_no, 'dateISO', v_row.created_at);
  update public.battles set record = v_record where id = v_row.id;
  return jsonb_build_object('battleId', v_row.id, 'battleNo', v_row.battle_no, 'dateISO', v_row.created_at);
end;
$$;

-- Only own P1 starts participate. The most recent non-random-win is the boundary.
create function diesduck_private.random_win_streak(p_game_account_id uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.game_account_access
    where auth_user_id = auth.uid() and game_account_id = p_game_account_id
  ) then raise exception 'Streak access denied' using errcode = '42501'; end if;
  return (select count(*)::integer from public.battles b
    where b.p1_account_id = p_game_account_id
      and b.selection_mode = 'random' and b.result = 'P1_win'
      and b.battle_no > coalesce((select max(stop.battle_no) from public.battles stop
        where stop.p1_account_id = p_game_account_id
          and (stop.selection_mode <> 'random' or stop.result <> 'P1_win')), 0));
end;
$$;
create function public.get_online_random_win_streak(p_game_account_id uuid) returns integer
language sql stable security invoker set search_path = '' as $$
  select diesduck_private.random_win_streak(p_game_account_id);
$$;
revoke all on function diesduck_private.random_win_streak(uuid),
  public.get_online_random_win_streak(uuid) from public, anon, authenticated;
grant execute on function diesduck_private.random_win_streak(uuid),
  public.get_online_random_win_streak(uuid) to authenticated;
-- The save signature, its ACL, result/history/favorite RPCs and table ACL remain intact.
notify pgrst, 'reload schema';
commit;
