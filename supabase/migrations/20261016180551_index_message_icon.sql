begin;

-- Keep the original get_index_messages / set_index_message RPCs untouched.
-- Nullable icon number preserves every existing post as the default icon.
alter table public.game_account_messages
  add column icon_slot integer check (icon_slot between 1 and 10);

create function diesduck_private.get_index_messages_v2(p_eno bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  target uuid;
  own_message text;
  own_icon_slot integer;
  own_default_icon_url text;
  own_icon_slots jsonb;
  others jsonb;
begin
  target := diesduck_private.index_message_account(p_eno);
  select m.message, m.icon_slot into own_message, own_icon_slot
    from public.game_account_messages m where m.game_account_id = target;
  select coalesce(b.presentation->>'defaultIconUrl',''),
         coalesce(b.presentation->'iconSlots','[]'::jsonb)
    into own_default_icon_url, own_icon_slots
    from public.battlers b where b.game_account_id = target;
  select coalesce(jsonb_agg(item.value),'[]'::jsonb) into others from (
    select jsonb_build_object(
      'eno',g.eno::text,
      'battlerName',coalesce(b.presentation->>'name',''),
      'defaultIconUrl',coalesce(b.presentation->>'defaultIconUrl',''),
      'iconUrl',case when m.icon_slot between 1 and 10
        then coalesce(b.presentation->'iconSlots'->>(m.icon_slot - 1),'')
        else '' end,
      'message',m.message
    ) as value
    from public.game_account_messages m
      join public.game_accounts g on g.id=m.game_account_id
      join public.battlers b on b.game_account_id=g.id
    where g.id<>target and m.message !~ '^[[:space:]]*$'
    order by random() limit 3
  ) item;
  return jsonb_build_object(
    'eno',p_eno::text,
    'ownMessage',coalesce(own_message,''),
    'ownIconSlot',own_icon_slot,
    'ownDefaultIconUrl',coalesce(own_default_icon_url,''),
    'ownIconSlots',coalesce(own_icon_slots,'[]'::jsonb),
    'others',others
  );
end;
$$;

create function diesduck_private.set_index_message_v2(
  p_eno bigint, p_message text, p_icon_slot integer
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare target uuid; normalized text;
begin
  target := diesduck_private.index_message_account(p_eno);
  if p_message is null or char_length(p_message)>60 then
    raise exception 'Message must be at most 60 characters' using errcode='22023';
  end if;
  -- Same trim characters as the existing RPC.
  normalized := btrim(p_message, E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if normalized='' then
    delete from public.game_account_messages where game_account_id=target;
    p_icon_slot := null;
  else
    if p_icon_slot is not null and (
      p_icon_slot not between 1 and 10
      or not exists (
        select 1 from public.battlers b where b.game_account_id=target
          and nullif(btrim(coalesce(b.presentation->'iconSlots'->>(p_icon_slot - 1),'')),'') is not null
      )
    ) then
      raise exception 'Invalid icon slot' using errcode='22023';
    end if;
    insert into public.game_account_messages(game_account_id,message,icon_slot)
      values(target,normalized,p_icon_slot)
    on conflict(game_account_id) do update
      set message=excluded.message,icon_slot=excluded.icon_slot,updated_at=now();
  end if;
  return jsonb_build_object('eno',p_eno::text,'message',normalized,'iconSlot',p_icon_slot);
end;
$$;

create function public.get_index_messages_v2(p_eno bigint)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select diesduck_private.get_index_messages_v2(p_eno);
$$;
create function public.set_index_message_v2(p_eno bigint,p_message text,p_icon_slot integer)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select diesduck_private.set_index_message_v2(p_eno,p_message,p_icon_slot);
$$;

revoke all on function
  diesduck_private.get_index_messages_v2(bigint),
  diesduck_private.set_index_message_v2(bigint,text,integer),
  public.get_index_messages_v2(bigint),
  public.set_index_message_v2(bigint,text,integer) from public,anon,authenticated;
grant execute on function
  diesduck_private.get_index_messages_v2(bigint),
  diesduck_private.set_index_message_v2(bigint,text,integer),
  public.get_index_messages_v2(bigint),
  public.set_index_message_v2(bigint,text,integer) to authenticated;
notify pgrst, 'reload schema';

commit;
