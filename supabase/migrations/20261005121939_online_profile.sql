begin;

-- Internal whitelist helpers. These have no table access and are not callable by API roles.
create function diesduck_private.profile_fields(v jsonb, names text[], kind text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare k text; r jsonb := '{}'; x jsonb;
begin
  if jsonb_typeof(v) is distinct from 'object' then raise exception 'Invalid profile data' using errcode='22023'; end if;
  foreach k in array names loop
    if not (v ? k) then raise exception 'Missing profile field' using errcode='22023'; end if;
    x := v->k;
    if x is not null and x <> 'null'::jsonb and jsonb_typeof(x) <> kind then
      raise exception 'Invalid profile field' using errcode='22023';
    end if;
    r := r || jsonb_build_object(k,x);
  end loop;
  return r;
end;
$$;

-- Selection DTO whitelist, including partial selections. Never return a stored object wholesale.
create function diesduck_private.profile_selection(v jsonb, category text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare names text[]; k text; x jsonb; r jsonb := '{}'; child text;
begin
  if v = 'null'::jsonb then return v; end if;
  if jsonb_typeof(v) is distinct from 'object' then raise exception 'Invalid selection' using errcode='22023'; end if;
  names := case category
    when 'B' then array['type','triggerId','conditionId','effectId','traitId','options','targetId','statusId']
    when 'D' then array['optionId'] when 'A' then array['triggerId','effects']
    when 'C' then array['mode','structure']
    when 'structure' then array['kind','effects','branches','thresholdOptionId']
    when 'branch' then array['effects'] when 'branches' then array['met','unmet']
    when 'effect' then array['effectId','targetId','statusId','options','chanceOptionId']
    when 'options' then array['statusId','amount','amountPct','multiplier','baseAmount','everyTurns','stepAmount','status','duration','maxHpPct']
    else null end;
  if names is null then raise exception 'Invalid selection category' using errcode='22023'; end if;
  foreach k in array names loop
    if not (v ? k) then continue; end if;
    x := v->k;
    if x <> 'null'::jsonb then
      if k = 'effects' or (k = 'branches' and jsonb_typeof(x) = 'array') then
        if jsonb_typeof(x) <> 'array' then raise exception 'Invalid selection array' using errcode='22023'; end if;
        child := case when k='effects' then 'effect' else 'branch' end;
        select coalesce(jsonb_agg(diesduck_private.profile_selection(e,child) order by n),'[]'::jsonb)
          into x from jsonb_array_elements(x) with ordinality a(e,n);
      elsif k in ('options','structure','branches','met','unmet') then
        x := diesduck_private.profile_selection(x,case when k in ('met','unmet') then 'branch' else k end);
      elsif jsonb_typeof(x) <> 'string' then raise exception 'Invalid selection value' using errcode='22023';
      end if;
    end if;
    r := r || jsonb_build_object(k,x);
  end loop;
  return r;
end;
$$;

create function diesduck_private.profile_skill(v jsonb, category text)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if v->'schemaVersion' is null or v->'schemaVersion' not in ('2'::jsonb,'3'::jsonb) then
    raise exception 'Unsupported build version' using errcode='22023';
  end if;
  return jsonb_build_object('selection',diesduck_private.profile_selection(v->(lower(category)||'Selection'),category),
    'label',case when v->'schemaVersion'='2'::jsonb then '{"name":"","ruby":""}'::jsonb
      else diesduck_private.profile_fields(v#>array['skillLabels',category],array['name','ruby'],'string') end);
end;
$$;

create function diesduck_private.public_profile(p_eno bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  g public.game_accounts; b public.battlers; d public.ducks;
  bp jsonb; dp jsonb; battler jsonb; duck jsonb := 'null'; icons jsonb := '[]'; featured jsonb := 'null';
  empty_bp constant jsonb := '{"text":"","iconSlots":[],"theme":{"background":"#DCEEF3","panel":"#FFFFFF","text":"#20282C","accent":"#4F91B3"},"featuredBattleId":null}';
  empty_dp constant jsonb := '{"text":"","type":null,"attributes":["","",""],"statLabelPreset":"default","flavorStats":[]}';
  registration boolean; slot jsonb; last_slot integer := 0; slot_no integer; featured_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_eno is null or p_eno < 1 then raise exception 'Invalid ENo' using errcode='22023'; end if;
  select * into g from public.game_accounts where eno=p_eno;
  if not found then return null; end if;
  select * into b from public.battlers where game_account_id=g.id;
  if not found then raise exception 'Missing Battler' using errcode='22023'; end if;
  registration := coalesce(b.build='{}'::jsonb and b.presentation - 'name'='{}'::jsonb and jsonb_typeof(b.presentation->'name')='string',false);
  if not registration and (b.presentation->'schemaVersion' is null or b.presentation->'schemaVersion' not in ('1'::jsonb,'2'::jsonb)) then
    raise exception 'Unsupported presentation version' using errcode='22023';
  end if;
  bp := case when b.presentation->'schemaVersion'='2'::jsonb then b.presentation->'profile' else empty_bp end;
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
      diesduck_private.profile_fields(bp,array['text'],'string') || jsonb_build_object('theme',
        diesduck_private.profile_fields(bp->'theme',array['background','panel','text','accent'],'string')),
      'skills',case when registration then '{"B":{"selection":null,"label":{"name":"","ruby":""}},"D":{"selection":null,"label":{"name":"","ruby":""}}}'::jsonb
        else jsonb_build_object('B',diesduck_private.profile_skill(b.build,'B'),'D',diesduck_private.profile_skill(b.build,'D')) end);
  if g.public_duck_id is not null then
    select * into d from public.ducks where id=g.public_duck_id and game_account_id=g.id;
    if not found then raise exception 'Missing public Duck' using errcode='22023'; end if;
    if d.presentation->'schemaVersion' is null or d.presentation->'schemaVersion' not in ('1'::jsonb,'2'::jsonb) then
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
  return jsonb_build_object('profileVersion',1,'accountId',g.id,'eno',g.eno::text,
    'isOwner',exists(select 1 from public.game_account_access where auth_user_id=auth.uid() and game_account_id=g.id),
    'battler',battler,'duck',duck,'featuredBattle',featured);
end;
$$;

create function public.get_online_profile(p_eno bigint)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select diesduck_private.public_profile(p_eno);
$$;
revoke all on function diesduck_private.profile_fields(jsonb,text[],text), diesduck_private.profile_selection(jsonb,text),
  diesduck_private.profile_skill(jsonb,text), diesduck_private.public_profile(bigint), public.get_online_profile(bigint) from public,anon,authenticated;
grant execute on function diesduck_private.public_profile(bigint), public.get_online_profile(bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
