-- Representative Ducks may be incomplete. Readiness remains owned by JS.
begin;

create or replace function public.save_online_player(p_game_account_id uuid, p_expected_revision text, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_revision bigint; selected_duck uuid; duck_ids uuid[]; row_item record; affected integer;
begin
  if auth.uid() is null or not exists (select 1 from public.game_account_access a
    where a.auth_user_id = auth.uid() and a.game_account_id = p_game_account_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision !~ '^(0|[1-9][0-9]*)$'
    or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload->'dtoVersion' is distinct from '1'::jsonb
    or jsonb_typeof(p_payload->'battler'->'build') is distinct from 'object'
    or jsonb_typeof(p_payload->'battler'->'presentation') is distinct from 'object'
    or jsonb_typeof(p_payload->'ducks') is distinct from 'array'
    or not (p_payload ? 'publicDuckId') then
    raise exception 'Invalid draft envelope' using errcode = '22023';
  end if;
  -- Structural checks only: game rules and battle-readiness do not belong in SQL.
  if exists (select 1 from jsonb_array_elements(p_payload->'ducks') d where
    jsonb_typeof(d->'id') is distinct from 'string'
    or jsonb_typeof(d->'build') is distinct from 'object'
    or jsonb_typeof(d->'presentation') is distinct from 'object') then
    raise exception 'Invalid Duck envelope' using errcode = '22023';
  end if;
  select coalesce(array_agg((d->>'id')::uuid), array[]::uuid[]) into duck_ids
    from jsonb_array_elements(p_payload->'ducks') d;
  if cardinality(duck_ids) <> (select count(distinct id) from unnest(duck_ids) id) then
    raise exception 'Duplicate Duck ID' using errcode = '22023';
  end if;
  selected_duck := (p_payload->>'publicDuckId')::uuid;
  if cardinality(duck_ids) > 0 and selected_duck is null then
    raise exception 'Public Duck required' using errcode = '22023';
  end if;
  if selected_duck is not null and not (selected_duck = any(duck_ids)) then
    raise exception 'Public Duck absent from draft' using errcode = '22023';
  end if;

  select g.save_revision into current_revision from public.game_accounts g
    where g.id = p_game_account_id for update;
  if not found then raise exception 'Access denied' using errcode = '42501'; end if;
  if current_revision::text <> p_expected_revision then
    raise exception 'Draft conflict' using errcode = '40001';
  end if;
  -- All operations below are one RPC transaction. Any failure rolls them all back.
  update public.game_accounts set public_duck_id = null where id = p_game_account_id;
  insert into public.battlers(game_account_id, build, presentation)
    values (p_game_account_id, p_payload->'battler'->'build', p_payload->'battler'->'presentation')
    on conflict (game_account_id) do update set build = excluded.build, presentation = excluded.presentation;
  for row_item in select value, ordinality from jsonb_array_elements(p_payload->'ducks') with ordinality
    order by value->>'id' loop
    insert into public.ducks(id, game_account_id, sort_order, build, presentation)
      values ((row_item.value->>'id')::uuid, p_game_account_id, (row_item.ordinality - 1)::integer,
        row_item.value->'build', row_item.value->'presentation')
      on conflict (id) do update set sort_order = excluded.sort_order,
        build = excluded.build, presentation = excluded.presentation
      where ducks.game_account_id = p_game_account_id;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'Duck access denied' using errcode = '42501'; end if;
  end loop;
  delete from public.ducks where game_account_id = p_game_account_id and not (id = any(duck_ids));
  update public.game_accounts set public_duck_id = selected_duck where id = p_game_account_id;
  select save_revision into current_revision from public.game_accounts where id = p_game_account_id;
  return jsonb_build_object('revision', current_revision::text);
end;
$$;

-- Reuse only already-public battle build fields; no presentation/other Ducks.
create or replace function public.list_online_opponents() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', account_id, 'eno', eno,
    'publicDuckId', duck_id, 'name', name,
    'defaultIconUrl', snapshot#>'{battler,presentation,defaultIconUrl}',
    'battleBuild', case when snapshot#>'{battler,build,schemaVersion}' = snapshot#>'{ducks,0,build,schemaVersion}' then
      jsonb_build_object('schemaVersion', snapshot#>'{battler,build,schemaVersion}',
        'battler', (snapshot#>'{battler,build}') - 'schemaVersion',
        'ducks', jsonb_build_array((snapshot#>'{ducks,0,build}') - 'schemaVersion'
          || jsonb_build_object('id', duck_id, 'name', ''))) else null end) order by eno::bigint), '[]'::jsonb)
  from diesduck_private.public_battle_data(null);
$$;
-- CREATE OR REPLACE preserves existing ACLs; retain the same explicit boundary.
revoke all on function public.save_online_player(uuid, text, jsonb), public.list_online_opponents() from public, anon;
grant execute on function public.save_online_player(uuid, text, jsonb), public.list_online_opponents() to authenticated;
notify pgrst, 'reload schema';
commit;
