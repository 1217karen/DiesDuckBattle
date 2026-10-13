-- Keep the existing public battle boundary; only the selected public Duck is joined.
begin;

-- Whitelist dialogue fields. No profile, detached Duck, or future private fields pass through.
create or replace function diesduck_private.battle_quote_lines(value jsonb, legacy boolean default false)
returns jsonb language sql immutable set search_path = '' as $$
  select case when legacy then jsonb_build_object(
    'text', coalesce(value#>'{lines,0,text}', value->'text', '""'::jsonb),
    'iconSlot', coalesce(value#>'{lines,0,iconSlot}', value->'iconSlot', 'null'::jsonb))
  else jsonb_build_object('lines', coalesce(jsonb_agg(jsonb_build_object(
    'text', coalesce(line->'text', '""'::jsonb),
    'iconSlot', coalesce(line->'iconSlot', 'null'::jsonb),
    'opponentEno', case when ordinal = 1 then 'null'::jsonb else coalesce(line->'opponentEno', 'null'::jsonb) end
  ) order by ordinal), '[{"text":"","iconSlot":null,"opponentEno":null}]'::jsonb)) end
  from jsonb_array_elements(case when jsonb_typeof(value->'lines') = 'array'
    then value->'lines' else jsonb_build_array(coalesce(value, '{}'::jsonb)) end)
    with ordinality as rows(line, ordinal);
$$;
revoke all on function diesduck_private.battle_quote_lines(jsonb, boolean) from public, anon, authenticated;

-- Current dialogue uses line arrays and empty profiles. Legacy v1/v2 text stays
-- legacy-shaped so the save-only length limit is not imposed on old stored text.
-- Duck v6 keeps its own A/C; the existing DTO migrates older Duck quotes.
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
        'presentation', jsonb_build_object('schemaVersion', case when b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb) then '1'::jsonb when b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb, '3'::jsonb, '4'::jsonb,'5'::jsonb,'6'::jsonb) then '3'::jsonb else b.presentation->'schemaVersion' end,
          'name', b.presentation->'name', 'standingImageUrl', b.presentation->'standingImageUrl',
          'defaultIconUrl', b.presentation->'defaultIconUrl', 'iconSlots', b.presentation->'iconSlots',
          'quotes', jsonb_build_object('battleStart', diesduck_private.battle_quote_lines(b.presentation#>'{quotes,battleStart}', b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb)),
            'turn', jsonb_build_object('even', diesduck_private.battle_quote_lines(b.presentation#>'{quotes,turn,even}', b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb)), 'lead', diesduck_private.battle_quote_lines(b.presentation#>'{quotes,turn,lead}', b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb)), 'behind', diesduck_private.battle_quote_lines(b.presentation#>'{quotes,turn,behind}', b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb))),
            'phaseStart', jsonb_build_object('first', diesduck_private.battle_quote_lines(b.presentation#>'{quotes,phaseStart,first}', b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb)), 'second', diesduck_private.battle_quote_lines(b.presentation#>'{quotes,phaseStart,second}', b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb)), 'third', diesduck_private.battle_quote_lines(b.presentation#>'{quotes,phaseStart,third}', b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb))),
            'skill', jsonb_build_object('A', diesduck_private.battle_quote_lines(case when d.presentation->'schemaVersion'='6'::jsonb and d.presentation->'icon' is distinct from 'null'::jsonb then d.presentation#>'{icon,quotes,skill,A}' when b.presentation->'schemaVersion'='6'::jsonb then null else b.presentation#>'{quotes,skill,A}' end, b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb)), 'B', diesduck_private.battle_quote_lines(b.presentation#>'{quotes,skill,B}', b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb)), 'C', diesduck_private.battle_quote_lines(case when d.presentation->'schemaVersion'='6'::jsonb and d.presentation->'icon' is distinct from 'null'::jsonb then d.presentation#>'{icon,quotes,skill,C}' when b.presentation->'schemaVersion'='6'::jsonb then null else b.presentation#>'{quotes,skill,C}' end, b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb)), 'D', diesduck_private.battle_quote_lines(b.presentation#>'{quotes,skill,D}', b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb))),
            'battleEnd', jsonb_build_object('win', diesduck_private.battle_quote_lines(b.presentation#>'{quotes,battleEnd,win}', b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb)), 'lose', diesduck_private.battle_quote_lines(b.presentation#>'{quotes,battleEnd,lose}', b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb)), 'draw', diesduck_private.battle_quote_lines(b.presentation#>'{quotes,battleEnd,draw}', b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb)))), 'detachedDuckPresentation', '{}'::jsonb) || case when b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb) then '{}'::jsonb else jsonb_build_object('profile', '{"text":"","iconSlots":[],"theme":{"background":"#DCEEF3","panel":"#FFFFFF","text":"#20282C","accent":"#4F91B3"},"featuredBattleId":null}'::jsonb) end),
      'ducks', jsonb_build_array(jsonb_build_object('id', d.id,
        'build', jsonb_build_object('schemaVersion', d.build->'schemaVersion',
          'stats', jsonb_build_object('AT', d.build#>'{stats,AT}', 'DF', d.build#>'{stats,DF}', 'SP', d.build#>'{stats,SP}'),
          'dice', d.build->'dice', 'diceFrame', d.build->'diceFrame',
          'aSelection', d.build->'aSelection', 'cSelection', d.build->'cSelection') || case when d.build->'schemaVersion' = '3'::jsonb then
          jsonb_build_object('skillLabels', jsonb_build_object('A', jsonb_build_object('name', d.build#>'{skillLabels,A,name}', 'ruby', d.build#>'{skillLabels,A,ruby}'), 'C', jsonb_build_object('name', d.build#>'{skillLabels,C,name}', 'ruby', d.build#>'{skillLabels,C,ruby}')))
          else '{}'::jsonb end,
        'presentation', jsonb_build_object('schemaVersion', case when d.presentation->'schemaVersion'='6'::jsonb then '6'::jsonb when d.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb, '3'::jsonb, '4'::jsonb,'5'::jsonb,'6'::jsonb) then '1'::jsonb else d.presentation->'schemaVersion' end,
          'name', d.presentation->'name', 'icon', case when d.presentation->'icon' = 'null'::jsonb then 'null'::jsonb
            else jsonb_build_object('iconUrl', d.presentation#>'{icon,iconUrl}',
              'cutinUrl', coalesce(d.presentation#>'{icon,cutinUrl}', '""'::jsonb))
              || case when d.presentation->'schemaVersion'='6'::jsonb then jsonb_build_object(
                'profile', '{"text":"","type":null,"attributes":["","",""],"statLabelPreset":"default","flavorStats":[]}'::jsonb,
                'quotes', jsonb_build_object('skill', jsonb_build_object(
                  'A', diesduck_private.battle_quote_lines(d.presentation#>'{icon,quotes,skill,A}'),
                  'C', diesduck_private.battle_quote_lines(d.presentation#>'{icon,quotes,skill,C}'))))
              else '{}'::jsonb end end))))
  from public.game_accounts g
  join public.battlers b on b.game_account_id = g.id
  join public.ducks d on d.game_account_id = g.id and d.id = g.public_duck_id
  where auth.uid() is not null
    and (select count(*) from public.game_account_access a where a.auth_user_id = auth.uid()) = 1
    and not exists (select 1 from public.game_account_access a where a.auth_user_id = auth.uid() and a.game_account_id = g.id)
    and (p_account is null or g.id = p_account);
$$;

commit;
