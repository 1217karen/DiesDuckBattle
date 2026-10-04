begin;
create table public.battle_favorites (
  game_account_id uuid not null references public.game_accounts(id) on delete cascade,
  battle_id uuid not null references public.battles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (game_account_id, battle_id)
);
alter table public.battle_favorites enable row level security;
revoke all on public.battle_favorites from public, anon, authenticated;
create index battle_favorites_battle_id_idx on public.battle_favorites(battle_id);

-- Replace the old signature, avoiding ambiguous PostgREST overloads.
drop function public.list_online_battle_results(integer,integer,text);
drop function diesduck_private.list_battle_results(integer,integer,text);
create function diesduck_private.list_battle_results(p_page integer, p_page_size integer, p_order text, p_eno bigint, p_outcome text, p_favorites_only boolean, p_game_account_id uuid) returns jsonb
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
  if p_eno is not null and p_eno < 1 or p_outcome is null or p_outcome not in ('all','win','lose','draw')
    or (p_eno is null and p_outcome <> 'all') or p_favorites_only is null
    or (p_favorites_only and p_game_account_id is null) then
    raise exception 'Invalid history filters' using errcode = '22023';
  end if;
  if p_game_account_id is not null and not exists (
    select 1 from public.game_account_access where auth_user_id = auth.uid() and game_account_id = p_game_account_id
  ) then raise exception 'Account access denied' using errcode = '42501'; end if;
  select count(*) into v_total from public.battles b where (p_eno is null or b.p1_eno = p_eno or b.p2_eno = p_eno)
    and (p_outcome = 'all'
      or (p_outcome = 'draw' and b.result = 'draw')
      or (p_outcome = 'win' and ((b.p1_eno = p_eno and b.result = 'P1_win') or (b.p2_eno = p_eno and b.result = 'P2_win')))
      or (p_outcome = 'lose' and ((b.p1_eno = p_eno and b.result = 'P2_win') or (b.p2_eno = p_eno and b.result = 'P1_win'))))
    and (not p_favorites_only or exists (select 1 from public.battle_favorites f where f.game_account_id = p_game_account_id and f.battle_id = b.id));
  v_pages := (v_total + p_page_size - 1) / p_page_size;
  v_page := greatest(1, least(p_page, v_pages));
  select coalesce(jsonb_agg(summary order by
    case when p_order = 'asc' then created_at end asc,
    case when p_order = 'desc' then created_at end desc,
    case when p_order = 'asc' then battle_no end asc,
    case when p_order = 'desc' then battle_no end desc), '[]'::jsonb) into v_records
  from (
    select b.created_at, b.battle_no, jsonb_build_object(
      'favorite', exists (select 1 from public.battle_favorites f where f.game_account_id = p_game_account_id and f.battle_id = b.id),
      'battleId', b.id, 'battleNo', b.battle_no, 'dateISO', b.created_at, 'result', b.result,
      'p1', jsonb_build_object('eno', b.p1_eno::text, 'battlerName', b.record#>'{p1,battlerName}',
        'duckName', b.record#>'{p1,duckName}', 'presentation', jsonb_build_object(
          'battlerDefaultIconUrl', b.record#>'{p1,presentation,battlerDefaultIconUrl}',
          'duckIconUrl', b.record#>'{p1,presentation,duckIconUrl}')),
      'p2', jsonb_build_object('eno', b.p2_eno::text, 'battlerName', b.record#>'{p2,battlerName}',
        'duckName', b.record#>'{p2,duckName}', 'presentation', jsonb_build_object(
          'battlerDefaultIconUrl', b.record#>'{p2,presentation,battlerDefaultIconUrl}',
          'duckIconUrl', b.record#>'{p2,presentation,duckIconUrl}'))) summary
    from public.battles b where (p_eno is null or b.p1_eno = p_eno or b.p2_eno = p_eno)
    and (p_outcome = 'all'
      or (p_outcome = 'draw' and b.result = 'draw')
      or (p_outcome = 'win' and ((b.p1_eno = p_eno and b.result = 'P1_win') or (b.p2_eno = p_eno and b.result = 'P2_win')))
      or (p_outcome = 'lose' and ((b.p1_eno = p_eno and b.result = 'P2_win') or (b.p2_eno = p_eno and b.result = 'P1_win'))))
    and (not p_favorites_only or exists (select 1 from public.battle_favorites f where f.game_account_id = p_game_account_id and f.battle_id = b.id))
    order by case when p_order = 'asc' then b.created_at end asc,
      case when p_order = 'desc' then b.created_at end desc,
      case when p_order = 'asc' then b.battle_no end asc,
      case when p_order = 'desc' then b.battle_no end desc
    limit p_page_size offset (v_page - 1) * p_page_size
  ) page_rows;
  return jsonb_build_object('records', v_records, 'page', v_page, 'pageSize', p_page_size, 'total', v_total, 'totalPages', v_pages);
end;
$$;


create function public.list_online_battle_results(
  p_page integer default 1, p_page_size integer default 30, p_order text default 'desc',
  p_eno bigint default null, p_outcome text default 'all', p_favorites_only boolean default false,
  p_game_account_id uuid default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select diesduck_private.list_battle_results(p_page,p_page_size,p_order,p_eno,p_outcome,p_favorites_only,p_game_account_id);
$$;

create function diesduck_private.set_battle_favorite(p_game_account_id uuid, p_battle_id uuid, p_favorite boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.game_account_access where auth_user_id = auth.uid() and game_account_id = p_game_account_id
  ) then raise exception 'Account access denied' using errcode = '42501'; end if;
  if p_favorite is null or not exists (select 1 from public.battles where id = p_battle_id) then
    raise exception 'Invalid favorite' using errcode = '22023';
  end if;
  if p_favorite then
    insert into public.battle_favorites(game_account_id,battle_id) values (p_game_account_id,p_battle_id) on conflict do nothing;
  else
    delete from public.battle_favorites where game_account_id = p_game_account_id and battle_id = p_battle_id;
  end if;
  return jsonb_build_object('battleId',p_battle_id,'favorite',p_favorite);
end;
$$;
create function public.set_online_battle_favorite(p_game_account_id uuid, p_battle_id uuid, p_favorite boolean)
returns jsonb language sql security invoker set search_path = '' as $$
  select diesduck_private.set_battle_favorite(p_game_account_id,p_battle_id,p_favorite);
$$;
revoke all on function diesduck_private.list_battle_results(integer,integer,text,bigint,text,boolean,uuid), public.list_online_battle_results(integer,integer,text,bigint,text,boolean,uuid),
  diesduck_private.set_battle_favorite(uuid,uuid,boolean), public.set_online_battle_favorite(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function diesduck_private.list_battle_results(integer,integer,text,bigint,text,boolean,uuid), public.list_online_battle_results(integer,integer,text,bigint,text,boolean,uuid),
  diesduck_private.set_battle_favorite(uuid,uuid,boolean), public.set_online_battle_favorite(uuid,uuid,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
