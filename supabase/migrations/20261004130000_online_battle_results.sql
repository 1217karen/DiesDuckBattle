begin;

-- Historical identifiers deliberately have no cascading foreign keys.
create table public.battles (
  id uuid primary key default gen_random_uuid(),
  battle_no bigint generated always as identity unique not null,
  created_at timestamptz not null default now(),
  p1_account_id uuid not null,
  p1_eno bigint not null,
  p1_duck_id uuid not null,
  p2_account_id uuid not null,
  p2_eno bigint not null,
  p2_duck_id uuid not null,
  result text not null check (result in ('P1_win', 'P2_win', 'draw')),
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  check (p1_account_id <> p2_account_id)
);
alter table public.battles enable row level security;
revoke all on public.battles from public, anon, authenticated;
revoke all on sequence public.battles_battle_no_seq from public, anon, authenticated;
create index battles_created_at_idx on public.battles (created_at, battle_no);
create index battles_p1_eno_idx on public.battles (p1_eno, created_at, battle_no) include (result);
create index battles_p2_eno_idx on public.battles (p2_eno, created_at, battle_no) include (result);

create function diesduck_private.save_battle_result(
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
  v_record := jsonb_build_object('result', v_result, 'events', p_record->'events');
  foreach v_side in array array['p1','p2'] loop
    v_record := v_record || jsonb_build_object(v_side, jsonb_build_object(
      'battlerId', p_record#>array[v_side,'battlerId'], 'battlerName', p_record#>array[v_side,'battlerName'],
      'duckId', p_record#>array[v_side,'duckId'], 'duckName', p_record#>array[v_side,'duckName'],
      'eno', case when v_side = 'p1' then v_p1_eno::text else v_p2_eno::text end,
      'presentation', p_record#>array[v_side,'presentation']));
  end loop;
  insert into public.battles(p1_account_id,p1_eno,p1_duck_id,p2_account_id,p2_eno,p2_duck_id,result,record)
    values (p_p1_account_id,v_p1_eno,p_p1_duck_id,p_p2_account_id,v_p2_eno,p_p2_duck_id,v_result,v_record)
    returning * into v_row;
  v_record := v_record || jsonb_build_object('battleId', v_row.id, 'battleNo', v_row.battle_no, 'dateISO', v_row.created_at);
  update public.battles set record = v_record where id = v_row.id;
  return jsonb_build_object('battleId', v_row.id, 'battleNo', v_row.battle_no, 'dateISO', v_row.created_at);
end;
$$;

create function diesduck_private.get_battle_result(p_battle_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  return (select record from public.battles where id = p_battle_id);
end;
$$;

create function diesduck_private.list_battle_results(p_page integer, p_page_size integer, p_order text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_total bigint;
  v_pages bigint;
  v_page bigint;
  v_records jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size < 1 or p_page_size > 30
    or p_order is null or p_order not in ('asc','desc') then
    raise exception 'Invalid pagination' using errcode = '22023';
  end if;
  select count(*) into v_total from public.battles;
  v_pages := (v_total + p_page_size - 1) / p_page_size;
  v_page := greatest(1, least(p_page, v_pages));
  select coalesce(jsonb_agg(summary order by
    case when p_order = 'asc' then created_at end asc,
    case when p_order = 'desc' then created_at end desc,
    case when p_order = 'asc' then battle_no end asc,
    case when p_order = 'desc' then battle_no end desc), '[]'::jsonb) into v_records
  from (
    select b.created_at, b.battle_no, jsonb_build_object(
      'battleId', b.id, 'battleNo', b.battle_no, 'dateISO', b.created_at, 'result', b.result,
      'p1', jsonb_build_object('eno', b.p1_eno::text, 'battlerName', b.record#>'{p1,battlerName}',
        'duckName', b.record#>'{p1,duckName}', 'presentation', jsonb_build_object(
          'battlerDefaultIconUrl', b.record#>'{p1,presentation,battlerDefaultIconUrl}',
          'duckIconUrl', b.record#>'{p1,presentation,duckIconUrl}')),
      'p2', jsonb_build_object('eno', b.p2_eno::text, 'battlerName', b.record#>'{p2,battlerName}',
        'duckName', b.record#>'{p2,duckName}', 'presentation', jsonb_build_object(
          'battlerDefaultIconUrl', b.record#>'{p2,presentation,battlerDefaultIconUrl}',
          'duckIconUrl', b.record#>'{p2,presentation,duckIconUrl}'))) summary
    from public.battles b
    order by case when p_order = 'asc' then b.created_at end asc,
      case when p_order = 'desc' then b.created_at end desc,
      case when p_order = 'asc' then b.battle_no end asc,
      case when p_order = 'desc' then b.battle_no end desc
    limit p_page_size offset (v_page - 1) * p_page_size
  ) page_rows;
  return jsonb_build_object('records', v_records, 'page', v_page, 'pageSize', p_page_size, 'total', v_total, 'totalPages', v_pages);
end;
$$;

create function public.save_online_battle_result(p_p1_account_id uuid, p_p1_duck_id uuid,
  p_p2_account_id uuid, p_p2_duck_id uuid, p_record jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select diesduck_private.save_battle_result(p_p1_account_id,p_p1_duck_id,p_p2_account_id,p_p2_duck_id,p_record);
$$;
create function public.get_online_battle_result(p_battle_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select diesduck_private.get_battle_result(p_battle_id);
$$;
create function public.list_online_battle_results(p_page integer default 1, p_page_size integer default 30, p_order text default 'desc') returns jsonb
language sql stable security invoker set search_path = '' as $$
  select diesduck_private.list_battle_results(p_page,p_page_size,p_order);
$$;
revoke all on function diesduck_private.save_battle_result(uuid,uuid,uuid,uuid,jsonb),
  diesduck_private.get_battle_result(uuid), diesduck_private.list_battle_results(integer,integer,text),
  public.save_online_battle_result(uuid,uuid,uuid,uuid,jsonb), public.get_online_battle_result(uuid),
  public.list_online_battle_results(integer,integer,text) from public, anon, authenticated;
grant execute on function diesduck_private.save_battle_result(uuid,uuid,uuid,uuid,jsonb),
  diesduck_private.get_battle_result(uuid), diesduck_private.list_battle_results(integer,integer,text),
  public.save_online_battle_result(uuid,uuid,uuid,uuid,jsonb), public.get_online_battle_result(uuid),
  public.list_online_battle_results(integer,integer,text) to authenticated;
notify pgrst, 'reload schema';
commit;
