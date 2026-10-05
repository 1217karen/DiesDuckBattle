begin;

-- v3 public battle data exposes only the primary line, in the existing v1 contract.
-- Profiles accept v2/v3 equally. Existing authorization, grants and response versions remain unchanged.
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
        'presentation', jsonb_build_object('schemaVersion', case when b.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb, '3'::jsonb) then '1'::jsonb else b.presentation->'schemaVersion' end,
          'name', b.presentation->'name', 'standingImageUrl', b.presentation->'standingImageUrl',
          'defaultIconUrl', b.presentation->'defaultIconUrl', 'iconSlots', b.presentation->'iconSlots',
          'quotes', case when b.presentation->'schemaVersion' = '3'::jsonb then jsonb_build_object('battleStart', jsonb_build_object('text', b.presentation#>'{quotes,battleStart,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,battleStart,lines,0,iconSlot}'),
            'turn', jsonb_build_object('even', jsonb_build_object('text', b.presentation#>'{quotes,turn,even,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,turn,even,lines,0,iconSlot}'), 'lead', jsonb_build_object('text', b.presentation#>'{quotes,turn,lead,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,turn,lead,lines,0,iconSlot}'), 'behind', jsonb_build_object('text', b.presentation#>'{quotes,turn,behind,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,turn,behind,lines,0,iconSlot}')),
            'phaseStart', jsonb_build_object('first', jsonb_build_object('text', b.presentation#>'{quotes,phaseStart,first,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,phaseStart,first,lines,0,iconSlot}'), 'second', jsonb_build_object('text', b.presentation#>'{quotes,phaseStart,second,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,phaseStart,second,lines,0,iconSlot}'), 'third', jsonb_build_object('text', b.presentation#>'{quotes,phaseStart,third,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,phaseStart,third,lines,0,iconSlot}')),
            'skill', jsonb_build_object('A', jsonb_build_object('text', b.presentation#>'{quotes,skill,A,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,skill,A,lines,0,iconSlot}'), 'B', jsonb_build_object('text', b.presentation#>'{quotes,skill,B,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,skill,B,lines,0,iconSlot}'), 'C', jsonb_build_object('text', b.presentation#>'{quotes,skill,C,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,skill,C,lines,0,iconSlot}'), 'D', jsonb_build_object('text', b.presentation#>'{quotes,skill,D,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,skill,D,lines,0,iconSlot}')),
            'battleEnd', jsonb_build_object('win', jsonb_build_object('text', b.presentation#>'{quotes,battleEnd,win,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,battleEnd,win,lines,0,iconSlot}'), 'lose', jsonb_build_object('text', b.presentation#>'{quotes,battleEnd,lose,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,battleEnd,lose,lines,0,iconSlot}'), 'draw', jsonb_build_object('text', b.presentation#>'{quotes,battleEnd,draw,lines,0,text}', 'iconSlot', b.presentation#>'{quotes,battleEnd,draw,lines,0,iconSlot}'))) else b.presentation->'quotes' end, 'detachedDuckPresentation', '{}'::jsonb)),
      'ducks', jsonb_build_array(jsonb_build_object('id', d.id,
        'build', jsonb_build_object('schemaVersion', d.build->'schemaVersion',
          'stats', jsonb_build_object('AT', d.build#>'{stats,AT}', 'DF', d.build#>'{stats,DF}', 'SP', d.build#>'{stats,SP}'),
          'dice', d.build->'dice', 'diceFrame', d.build->'diceFrame',
          'aSelection', d.build->'aSelection', 'cSelection', d.build->'cSelection') || case when d.build->'schemaVersion' = '3'::jsonb then
          jsonb_build_object('skillLabels', jsonb_build_object('A', jsonb_build_object('name', d.build#>'{skillLabels,A,name}', 'ruby', d.build#>'{skillLabels,A,ruby}'), 'C', jsonb_build_object('name', d.build#>'{skillLabels,C,name}', 'ruby', d.build#>'{skillLabels,C,ruby}')))
          else '{}'::jsonb end,
        'presentation', jsonb_build_object('schemaVersion', case when d.presentation->'schemaVersion' in ('1'::jsonb, '2'::jsonb, '3'::jsonb) then '1'::jsonb else d.presentation->'schemaVersion' end,
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


create or replace function diesduck_private.public_profile(p_eno bigint)
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
  if not registration and (b.presentation->'schemaVersion' is null or b.presentation->'schemaVersion' not in ('1'::jsonb,'2'::jsonb,'3'::jsonb)) then
    raise exception 'Unsupported presentation version' using errcode='22023';
  end if;
  bp := case when b.presentation->'schemaVersion' in ('2'::jsonb,'3'::jsonb) then b.presentation->'profile' else empty_bp end;
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
    if d.presentation->'schemaVersion' is null or d.presentation->'schemaVersion' not in ('1'::jsonb,'2'::jsonb,'3'::jsonb) then
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


notify pgrst, 'reload schema';
commit;
