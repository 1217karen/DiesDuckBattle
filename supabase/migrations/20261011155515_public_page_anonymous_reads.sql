begin;

-- Anonymous access to existing public projections only. No table or write grants.

create or replace function diesduck_private.public_profile(p_eno bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  g public.game_accounts; b public.battlers; d public.ducks;
  bp jsonb; dp jsonb; battler jsonb; duck jsonb := 'null'; icons jsonb := '[]'; featured jsonb := 'null';
  empty_bp constant jsonb := '{"text":"","iconSlots":[],"theme":{"background":"#DCEEF3","panel":"#FFFFFF","text":"#20282C","accent":"#4F91B3"},"featuredBattleId":null}';
  empty_dp constant jsonb := '{"text":"","type":null,"attributes":["","",""],"statLabelPreset":"default","flavorStats":[]}';
  registration boolean; slot jsonb; last_slot integer := 0; slot_no integer; featured_id uuid;
begin
  if p_eno is null or p_eno < 1 then raise exception 'Invalid ENo' using errcode='22023'; end if;
  select * into g from public.game_accounts where eno=p_eno;
  if not found then return null; end if;
  select * into b from public.battlers where game_account_id=g.id;
  if not found then raise exception 'Missing Battler' using errcode='22023'; end if;
  registration := coalesce(b.build='{}'::jsonb and b.presentation - 'name'='{}'::jsonb and jsonb_typeof(b.presentation->'name')='string',false);
  if not registration and (b.presentation->'schemaVersion' is null or b.presentation->'schemaVersion' not in ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)) then
    raise exception 'Unsupported presentation version' using errcode='22023';
  end if;
  bp := case when b.presentation->'schemaVersion' in ('2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb) then b.presentation->'profile' else empty_bp end;
  -- Older profiles receive only the new defaults; v5 values must remain typed.
  if b.presentation->'schemaVersion' in ('5'::jsonb,'6'::jsonb) then
    if jsonb_typeof(bp->'message') is distinct from 'string'
      or jsonb_typeof(bp->'messageTail') is distinct from 'boolean' then
      raise exception 'Invalid profile message' using errcode='22023';
    end if;
  else
    bp := bp || '{"message":"","messageTail":false}'::jsonb;
  end if;
  if jsonb_typeof(bp->'iconSlots') is distinct from 'array' or jsonb_array_length(bp->'iconSlots')>4 then
    raise exception 'Invalid profile icons' using errcode='22023';
  end if;
  for slot in select value from jsonb_array_elements(bp->'iconSlots') loop
    if jsonb_typeof(slot)<>'number' or slot::text !~ '^[0-9]+$' then raise exception 'Invalid profile slot' using errcode='22023'; end if;
    slot_no := slot::text::integer;
    if slot_no<=last_slot or slot_no>10 then raise exception 'Invalid profile slot order' using errcode='22023'; end if;
    if jsonb_typeof(b.presentation->'iconSlots'->(slot_no-1)) is distinct from 'string' then raise exception 'Invalid icon URL' using errcode='22023'; end if;
    icons := icons || jsonb_build_array(jsonb_build_object('slot',slot_no,'url',b.presentation->'iconSlots'->(slot_no-1)));
    last_slot := slot_no;
  end loop;
  battler := diesduck_private.profile_fields(b.presentation,array['name'],'string') ||
    case when registration then '{"standingImageUrl":"","defaultIconUrl":""}'::jsonb
      else diesduck_private.profile_fields(b.presentation,array['standingImageUrl','defaultIconUrl'],'string') end ||
    jsonb_build_object('profileIcons',icons,'profile',
      diesduck_private.profile_fields(bp,array['text','message'],'string') ||
      diesduck_private.profile_fields(bp,array['messageTail'],'boolean') || jsonb_build_object('theme',
        diesduck_private.profile_fields(bp->'theme',array['background','panel','text','accent'],'string')),
      'skills',case when registration then '{"B":{"selection":null,"label":{"name":"","ruby":""}},"D":{"selection":null,"label":{"name":"","ruby":""}}}'::jsonb
        else jsonb_build_object('B',diesduck_private.profile_skill(b.build,'B'),'D',diesduck_private.profile_skill(b.build,'D')) end);
  if g.public_duck_id is not null then
    select * into d from public.ducks where id=g.public_duck_id and game_account_id=g.id;
    if not found then raise exception 'Missing public Duck' using errcode='22023'; end if;
    if d.presentation->'schemaVersion' is null or d.presentation->'schemaVersion' not in ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb) then
      raise exception 'Unsupported Duck presentation version' using errcode='22023';
    end if;
    dp := case when d.presentation->'schemaVersion'='1'::jsonb or d.presentation->'icon'='null'::jsonb
      then empty_dp else d.presentation#>'{icon,profile}' end;
    if jsonb_typeof(dp->'attributes') is distinct from 'array' or jsonb_array_length(dp->'attributes')<>3
      or exists(select 1 from jsonb_array_elements(dp->'attributes') a where jsonb_typeof(a)<>'string')
      or jsonb_typeof(dp->'flavorStats') is distinct from 'array' then raise exception 'Invalid Duck profile' using errcode='22023'; end if;
    duck := jsonb_build_object('id',d.id) || diesduck_private.profile_fields(d.presentation,array['name'],'string') ||
      case when d.presentation->'icon'='null'::jsonb then '{"iconUrl":""}'::jsonb
        else diesduck_private.profile_fields(d.presentation->'icon',array['iconUrl'],'string') end ||
      jsonb_build_object('profile',diesduck_private.profile_fields(dp,array['text','type','statLabelPreset'],'string') ||
        jsonb_build_object('attributes',dp->'attributes','flavorStats',(select coalesce(jsonb_agg(
          diesduck_private.profile_fields(e,array['label'],'string') || diesduck_private.profile_fields(e,array['value'],'number') order by n),'[]'::jsonb)
          from jsonb_array_elements(dp->'flavorStats') with ordinality a(e,n))),
        'stats',diesduck_private.profile_fields(d.build->'stats',array['AT','DF','SP'],'number'),
        'skills',jsonb_build_object('A',diesduck_private.profile_skill(d.build,'A'),'C',diesduck_private.profile_skill(d.build,'C')));
  end if;
  -- A stale favorite reference is not public. Participation is deliberately not required.
  if bp->'featuredBattleId' is distinct from 'null'::jsonb then
    if jsonb_typeof(bp->'featuredBattleId') is distinct from 'string' then raise exception 'Invalid featured battle' using errcode='22023'; end if;
    featured_id := (bp->>'featuredBattleId')::uuid;
    select jsonb_build_object('battleId',r.id,'battleNo',r.battle_no::text,'dateISO',r.created_at,'result',r.result,
      'p1',jsonb_build_object('eno',r.p1_eno::text) || diesduck_private.profile_fields(r.record->'p1',array['battlerName','duckName'],'string') ||
        diesduck_private.profile_fields(r.record#>'{p1,presentation}',array['battlerDefaultIconUrl','duckIconUrl'],'string'),
      'p2',jsonb_build_object('eno',r.p2_eno::text) || diesduck_private.profile_fields(r.record->'p2',array['battlerName','duckName'],'string') ||
        diesduck_private.profile_fields(r.record#>'{p2,presentation}',array['battlerDefaultIconUrl','duckIconUrl'],'string'))
      into featured from public.battles r join public.battle_favorites f on f.battle_id=r.id
      where f.game_account_id=g.id and r.id=featured_id;
  end if;
  return jsonb_build_object('profileVersion',2,'accountId',g.id,'eno',g.eno::text,
    'isOwner',exists(select 1 from public.game_account_access where auth_user_id=auth.uid() and game_account_id=g.id),
    'battler',battler,'duck',duck,'featuredBattle',featured);
end;
$$;

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

create or replace function diesduck_private.list_battle_results(p_page integer, p_page_size integer, p_order text, p_eno bigint, p_outcome text, p_favorites_only boolean, p_game_account_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_total bigint;
  v_pages bigint;
  v_page bigint;
  v_records jsonb;
begin
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

create or replace function diesduck_private.get_battle_result(p_battle_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return (select record from public.battles where id = p_battle_id);
end;
$$;

-- Invoker wrappers require EXECUTE on their corresponding private implementations.
-- Existing authenticated grants, helper ACLs and table RLS remain unchanged.
grant execute on function
  public.list_online_characters(), diesduck_private.list_characters(),
  public.get_online_profile(bigint), diesduck_private.public_profile(bigint),
  public.list_online_battle_results(integer,integer,text,bigint,text,boolean,uuid),
  diesduck_private.list_battle_results(integer,integer,text,bigint,text,boolean,uuid),
  public.get_online_battle_result(uuid), diesduck_private.get_battle_result(uuid)
to anon;

notify pgrst, 'reload schema';
commit;
