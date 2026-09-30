-- Atomic online draft storage. Apply separately after review; never resets accounts/ENo.
begin;
alter table public.game_accounts add column save_revision bigint not null default 0
  check (save_revision >= 0);
comment on column public.game_accounts.save_revision is 'Opaque optimistic concurrency token. Returned as decimal text; not writable by clients.';

create function public.advance_save_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.save_revision := old.save_revision + 1;
  return new;
end;
$$;
create trigger game_accounts_save_revision before update on public.game_accounts
  for each row execute function public.advance_save_revision();

-- Even direct writes through the existing RLS policies invalidate loaded drafts.
-- Touch/lock the parent before changing its child. No elevated privileges.
create function public.touch_player_account() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare account_id uuid; ids uuid[];
begin
  if tg_op = 'INSERT' then ids := array[new.game_account_id];
  elsif tg_op = 'DELETE' then ids := array[old.game_account_id];
  else ids := array[old.game_account_id, new.game_account_id]; end if;
  for account_id in select distinct unnest(ids) order by 1 loop
    update public.game_accounts set public_duck_id = public_duck_id where id = account_id;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger battlers_touch_account before insert or update or delete on public.battlers
  for each row execute function public.touch_player_account();
create trigger ducks_touch_account before insert or update or delete on public.ducks
  for each row execute function public.touch_player_account();
revoke all on function public.advance_save_revision(), public.touch_player_account() from public, anon, authenticated;

-- One SQL statement gives all rows and revision a single MVCC snapshot.
-- Unlike public opponent reads, this full-draft RPC requires account access.
create function public.load_online_player(p_game_account_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'gameAccountId', g.id, 'eno', g.eno::text, 'revision', g.save_revision::text,
    'publicDuckId', g.public_duck_id,
    'battler', (select jsonb_build_object('build', b.build, 'presentation', b.presentation)
      from public.battlers b where b.game_account_id = g.id),
    'ducks', coalesce((select jsonb_agg(jsonb_build_object('id', d.id,
      'build', d.build, 'presentation', d.presentation) order by d.sort_order, d.id)
      from public.ducks d where d.game_account_id = g.id), '[]'::jsonb)
  ) from public.game_accounts g where g.id = p_game_account_id
    and exists (select 1 from public.game_account_access a
      where a.game_account_id = g.id and a.auth_user_id = (select auth.uid()));
$$;

create function public.save_online_player(p_game_account_id uuid, p_expected_revision text, p_payload jsonb)
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
revoke all on function public.load_online_player(uuid), public.save_online_player(uuid, text, jsonb) from public, anon;
grant execute on function public.load_online_player(uuid), public.save_online_player(uuid, text, jsonb) to authenticated;
-- Existing table grants, RLS and ownership FK remain unchanged. No revision UPDATE grant.
commit;
