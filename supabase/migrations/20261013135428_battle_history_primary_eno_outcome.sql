begin;
-- Only outcome eligibility/perspective changes. Existing signatures and EXECUTE grants stay intact.
create or replace function diesduck_private.list_battle_results(p_page integer, p_page_size integer, p_order text, p_eno bigint, p_outcome text, p_favorites_only boolean, p_game_account_id uuid, p_opponent_eno bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_total bigint;
  v_pages bigint;
  v_page bigint;
  v_records jsonb;
  v_eno bigint := coalesce(p_eno, p_opponent_eno);
begin
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size < 1 or p_page_size > 30
    or p_order is null or p_order not in ('asc','desc') then
    raise exception 'Invalid pagination' using errcode = '22023';
  end if;
  if (p_eno is not null and p_eno < 1) or (p_opponent_eno is not null and p_opponent_eno < 1) or p_outcome is null or p_outcome not in ('all','win','lose','draw')
    or (p_eno is null and p_outcome <> 'all') or p_favorites_only is null
    or (p_favorites_only and p_game_account_id is null) then
    raise exception 'Invalid history filters' using errcode = '22023';
  end if;
  if p_game_account_id is not null and not exists (
    select 1 from public.game_account_access where auth_user_id = auth.uid() and game_account_id = p_game_account_id
  ) then raise exception 'Account access denied' using errcode = '42501'; end if;
  select count(*) into v_total from public.battles b where (case when p_eno is not null and p_opponent_eno is not null then
      (b.p1_eno = p_eno and b.p2_eno = p_opponent_eno) or (b.p1_eno = p_opponent_eno and b.p2_eno = p_eno)
      else v_eno is null or b.p1_eno = v_eno or b.p2_eno = v_eno end)
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
    from public.battles b where (case when p_eno is not null and p_opponent_eno is not null then
      (b.p1_eno = p_eno and b.p2_eno = p_opponent_eno) or (b.p1_eno = p_opponent_eno and b.p2_eno = p_eno)
      else v_eno is null or b.p1_eno = v_eno or b.p2_eno = v_eno end)
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
notify pgrst, 'reload schema';
commit;
