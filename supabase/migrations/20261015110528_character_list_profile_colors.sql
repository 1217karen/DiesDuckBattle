begin;

-- Extend the existing public projection only; retain function ACLs and all joins.
create or replace function diesduck_private.list_characters() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'eno',g.eno::text,
    'battlerName',coalesce(b.presentation->>'name',''),
    'battlerIconUrl',case when b.presentation->'schemaVersion' in ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)
      and jsonb_typeof(b.presentation->'defaultIconUrl')='string' then b.presentation->>'defaultIconUrl' else '' end,
    'accent',case when b.presentation->'schemaVersion' in ('2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)
      and b.presentation#>>'{profile,theme,accent}' ~ '^#[0-9A-Fa-f]{6}$' then b.presentation#>>'{profile,theme,accent}' else '#4F91B3' end,
    'background',case when b.presentation->'schemaVersion' in ('2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)
      and b.presentation#>>'{profile,theme,background}' ~ '^#[0-9A-Fa-f]{6}$' then b.presentation#>>'{profile,theme,background}' else '#DCEEF3' end,
    'panel',case when b.presentation->'schemaVersion' in ('2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)
      and b.presentation#>>'{profile,theme,panel}' ~ '^#[0-9A-Fa-f]{6}$' then b.presentation#>>'{profile,theme,panel}' else '#FFFFFF' end,
    'text',case when b.presentation->'schemaVersion' in ('2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)
      and b.presentation#>>'{profile,theme,text}' ~ '^#[0-9A-Fa-f]{6}$' then b.presentation#>>'{profile,theme,text}' else '#20282C' end,
    'duck',case when d.id is null then 'null'::jsonb else jsonb_build_object(
      'name',coalesce(d.presentation->>'name',''),
      'iconUrl',case when jsonb_typeof(d.presentation#>'{icon,iconUrl}')='string' then d.presentation#>>'{icon,iconUrl}' else '' end,
      'type',case when d.presentation->'schemaVersion' in ('2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)
        and d.presentation#>>'{icon,profile,type}' in ('attack','defense','speed','heal','technical','normal')
        then d.presentation#>'{icon,profile,type}' else 'null'::jsonb end,
      'attributes',(select jsonb_agg(case when d.presentation->'schemaVersion' in ('2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)
          and jsonb_typeof(d.presentation#>array['icon','profile','attributes',n::text])='string'
          and char_length(d.presentation#>>array['icon','profile','attributes',n::text])<=1
        then d.presentation#>array['icon','profile','attributes',n::text] else '""'::jsonb end order by n)
        from generate_series(0,2) n)) end,
    -- Unknown or malformed newer privacy settings fail closed, never reveal a value.
    'bestStreak',case when b.presentation->'schemaVersion' in ('1'::jsonb,'2'::jsonb,'3'::jsonb)
      or (b.presentation - 'name'='{}'::jsonb and jsonb_typeof(b.presentation->'name')='string')
      or (b.presentation->'schemaVersion' in ('4'::jsonb,'5'::jsonb,'6'::jsonb) and b.presentation#>'{profile,showBestStreak}'='true'::jsonb)
      then coalesce(r.best_random_win_streak,0) else null end
  ) order by g.eno),'[]'::jsonb)
  from public.game_accounts g
  left join public.battlers b on b.game_account_id=g.id
  left join public.ducks d on d.id=g.public_duck_id and d.game_account_id=g.id
  left join public.game_account_records r on r.game_account_id=g.id);
end;
$$;

notify pgrst, 'reload schema';
commit;
