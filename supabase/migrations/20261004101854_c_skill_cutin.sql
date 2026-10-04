begin;

-- Expose only the selected public Duck cut-in; missing old values default to empty.
-- Preserve the existing caller authorization and private-field boundary.
create or replace function diesduck_private.public_battle_data(p_account uuid)
returns table(account_id uuid, eno text, duck_id uuid, name text, snapshot jsonb)
language sql stable security definer set search_path = '' as $$
  select g.id, g.eno::text, d.id, b.presentation->>'name',
    jsonb_build_object('gameAccountId', g.id, 'eno', g.eno::text, 'publicDuckId', d.id,
      'battler', jsonb_build_object(
        'build', jsonb_build_object('schemaVersion', b.build->'schemaVersion',
          'bSelection', b.build->'bSelection', 'dSelection', b.build->'dSelection') || case when b.build->'schemaVersion' = '3'::jsonb then
          jsonb_build_object('skillLabels', jsonb_build_object('B', jsonb_build_object('name', b.build#>'{skillLabels,B,name}', 'ruby', b.build#>'{skillLabels,B,ruby}'), 'D', jsonb_build_object('name', b.build#>'{skillLabels,D,name}', 'ruby', b.build#>'{skillLabels,D,ruby}')))
          else '{}'::jsonb end,
        'presentation', jsonb_build_object('schemaVersion', b.presentation->'schemaVersion',
          'name', b.presentation->'name', 'standingImageUrl', b.presentation->'standingImageUrl',
          'defaultIconUrl', b.presentation->'defaultIconUrl', 'iconSlots', b.presentation->'iconSlots',
          'quotes', b.presentation->'quotes', 'detachedDuckPresentation', '{}'::jsonb)),
      'ducks', jsonb_build_array(jsonb_build_object('id', d.id,
        'build', jsonb_build_object('schemaVersion', d.build->'schemaVersion',
          'stats', jsonb_build_object('AT', d.build#>'{stats,AT}', 'DF', d.build#>'{stats,DF}', 'SP', d.build#>'{stats,SP}'),
          'dice', d.build->'dice', 'diceFrame', d.build->'diceFrame',
          'aSelection', d.build->'aSelection', 'cSelection', d.build->'cSelection') || case when d.build->'schemaVersion' = '3'::jsonb then
          jsonb_build_object('skillLabels', jsonb_build_object('A', jsonb_build_object('name', d.build#>'{skillLabels,A,name}', 'ruby', d.build#>'{skillLabels,A,ruby}'), 'C', jsonb_build_object('name', d.build#>'{skillLabels,C,name}', 'ruby', d.build#>'{skillLabels,C,ruby}')))
          else '{}'::jsonb end,
        'presentation', jsonb_build_object('schemaVersion', d.presentation->'schemaVersion',
          'name', d.presentation->'name', 'icon', case when d.presentation->'icon' = 'null'::jsonb then 'null'::jsonb
            else jsonb_build_object('iconUrl', d.presentation#>'{icon,iconUrl}',
              'cutinUrl', coalesce(d.presentation#>'{icon,cutinUrl}', '""'::jsonb)) end))))
  from public.game_accounts g
  join public.battlers b on b.game_account_id = g.id
  join public.ducks d on d.game_account_id = g.id and d.id = g.public_duck_id
  where auth.uid() is not null
    and (select count(*) from public.game_account_access a where a.auth_user_id = auth.uid()) = 1
    and not exists (select 1 from public.game_account_access a where a.auth_user_id = auth.uid() and a.game_account_id = g.id)
    and (p_account is null or g.id = p_account);
$$;

notify pgrst, 'reload schema';
commit;
