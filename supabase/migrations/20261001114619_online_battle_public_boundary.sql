begin;

-- Full JSON includes private/detached Duck presentation. Do not expose whole
-- Battler rows (or future extra public-Duck fields) to other accounts.
drop policy battlers_select_authenticated on public.battlers;
create policy battlers_select_access on public.battlers for select to authenticated
using (exists (select 1 from public.game_account_access a
  where a.auth_user_id = (select auth.uid()) and a.game_account_id = battlers.game_account_id));
drop policy ducks_select_access_or_public on public.ducks;
create policy ducks_select_access on public.ducks for select to authenticated
using (exists (select 1 from public.game_account_access a
  where a.auth_user_id = (select auth.uid()) and a.game_account_id = ducks.game_account_id));

-- Deliberate, narrow declassification boundary, not a generic RLS bypass RPC.
-- This schema must not be added to the Data API's exposed schemas.
create schema diesduck_private;
revoke all on schema diesduck_private from public, anon, authenticated;
grant usage on schema diesduck_private to authenticated;
create function diesduck_private.public_battle_data(p_account uuid)
returns table(account_id uuid, eno text, duck_id uuid, name text, snapshot jsonb)
language sql stable security definer set search_path = '' as $$
  select g.id, g.eno::text, d.id, b.presentation->>'name',
    jsonb_build_object('gameAccountId', g.id, 'eno', g.eno::text, 'publicDuckId', d.id,
      'battler', jsonb_build_object(
        'build', jsonb_build_object('schemaVersion', b.build->'schemaVersion',
          'bSelection', b.build->'bSelection', 'dSelection', b.build->'dSelection'),
        'presentation', jsonb_build_object('schemaVersion', b.presentation->'schemaVersion',
          'name', b.presentation->'name', 'standingImageUrl', b.presentation->'standingImageUrl',
          'defaultIconUrl', b.presentation->'defaultIconUrl', 'iconSlots', b.presentation->'iconSlots',
          'quotes', b.presentation->'quotes', 'detachedDuckPresentation', '{}'::jsonb)),
      'ducks', jsonb_build_array(jsonb_build_object('id', d.id,
        'build', jsonb_build_object('schemaVersion', d.build->'schemaVersion',
          'stats', jsonb_build_object('AT', d.build#>'{stats,AT}', 'DF', d.build#>'{stats,DF}', 'SP', d.build#>'{stats,SP}'),
          'dice', d.build->'dice', 'diceFrame', d.build->'diceFrame',
          'aSelection', d.build->'aSelection', 'cSelection', d.build->'cSelection'),
        'presentation', jsonb_build_object('schemaVersion', d.presentation->'schemaVersion',
          'name', d.presentation->'name', 'icon', case when d.presentation->'icon' = 'null'::jsonb then 'null'::jsonb
            else jsonb_build_object('iconUrl', d.presentation#>'{icon,iconUrl}') end))))
  from public.game_accounts g
  join public.battlers b on b.game_account_id = g.id
  join public.ducks d on d.game_account_id = g.id and d.id = g.public_duck_id
  where auth.uid() is not null
    and (select count(*) from public.game_account_access a where a.auth_user_id = auth.uid()) = 1
    and not exists (select 1 from public.game_account_access a where a.auth_user_id = auth.uid() and a.game_account_id = g.id)
    and (p_account is null or g.id = p_account);
$$;
revoke all on function diesduck_private.public_battle_data(uuid) from public, anon, authenticated;
grant execute on function diesduck_private.public_battle_data(uuid) to authenticated;

-- Public entrypoints remain invokers; only the fixed projection above is privileged.
create function public.list_online_opponents() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', account_id, 'eno', eno,
    'publicDuckId', duck_id, 'name', name) order by eno::bigint), '[]'::jsonb)
  from diesduck_private.public_battle_data(null);
$$;
create function public.get_online_opponent(p_game_account_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select snapshot from diesduck_private.public_battle_data(p_game_account_id)
  where account_id = p_game_account_id;
$$;

-- One stable statement observes both players at the same database snapshot.
-- A switched/unpublished public Duck is rejected, never silently substituted.
create function public.prepare_online_battle(p_game_account_id uuid, p_duck_id uuid,
  p_opponent_account_id uuid, p_opponent_duck_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('self', public.load_online_player(p_game_account_id), 'opponent', o.snapshot)
  from diesduck_private.public_battle_data(p_opponent_account_id) o
  where o.account_id = p_opponent_account_id and o.duck_id = p_opponent_duck_id
    and exists (select 1 from public.game_account_access a
      where a.auth_user_id = auth.uid() and a.game_account_id = p_game_account_id)
    and exists (select 1 from public.ducks d where d.game_account_id = p_game_account_id and d.id = p_duck_id);
$$;
revoke all on function public.list_online_opponents(), public.get_online_opponent(uuid),
  public.prepare_online_battle(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.list_online_opponents(), public.get_online_opponent(uuid),
  public.prepare_online_battle(uuid,uuid,uuid,uuid) to authenticated;

comment on function diesduck_private.public_battle_data(uuid) is
  'Authenticated single-account callers only. Public Duck + whitelisted battle fields; no detached/private Duck data.';
notify pgrst, 'reload schema';
commit;
