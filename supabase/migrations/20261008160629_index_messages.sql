begin;

-- Independent current value, never part of player presentation/save_revision.
create table public.game_account_messages (
  game_account_id uuid primary key references public.game_accounts(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 60),
  updated_at timestamptz not null default now()
);
alter table public.game_account_messages enable row level security;
revoke all on public.game_account_messages from public, anon, authenticated;

create function diesduck_private.index_message_account(p_eno bigint)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare target uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if (select count(*) from public.game_account_access where auth_user_id=auth.uid()) <> 1 then
    raise exception 'Single account required' using errcode='42501';
  end if;
  select g.id into target from public.game_accounts g join public.game_account_access a on a.game_account_id=g.id
    where a.auth_user_id=auth.uid() and g.eno=p_eno;
  if target is null then raise exception 'Account access denied' using errcode='42501'; end if;
  return target;
end;
$$;

create function diesduck_private.get_index_messages(p_eno bigint)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare target uuid; own_message text; others jsonb;
begin
  target := diesduck_private.index_message_account(p_eno);
  select message into own_message from public.game_account_messages where game_account_id=target;
  select coalesce(jsonb_agg(row.value),'[]'::jsonb) into others from (
    select jsonb_build_object('eno',g.eno::text,
      'battlerName',coalesce(b.presentation->>'name',''),
      'defaultIconUrl',coalesce(b.presentation->>'defaultIconUrl',''),
      'message',m.message) as value
    from public.game_account_messages m join public.game_accounts g on g.id=m.game_account_id
      join public.battlers b on b.game_account_id=g.id
    where g.id<>target and m.message !~ '^[[:space:]]*$'
    order by random() limit 3
  ) row;
  return jsonb_build_object('eno',p_eno::text,'ownMessage',coalesce(own_message,''),'others',others);
end;
$$;

create function diesduck_private.set_index_message(p_eno bigint,p_message text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare target uuid; normalized text;
begin
  target := diesduck_private.index_message_account(p_eno);
  if p_message is null or char_length(p_message)>60 then raise exception 'Message must be at most 60 characters' using errcode='22023'; end if;
  -- Match ECMAScript trim whitespace, including fullwidth spaces and BOM.
  normalized := btrim(p_message, E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if normalized='' then delete from public.game_account_messages where game_account_id=target;
  else
    insert into public.game_account_messages(game_account_id,message) values(target,normalized)
    on conflict(game_account_id) do update set message=excluded.message,updated_at=now();
  end if;
  return jsonb_build_object('eno',p_eno::text,'message',normalized);
end;
$$;

create function public.get_index_messages(p_eno bigint)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select diesduck_private.get_index_messages(p_eno);
$$;
create function public.set_index_message(p_eno bigint,p_message text)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select diesduck_private.set_index_message(p_eno,p_message);
$$;
revoke all on function diesduck_private.index_message_account(bigint),
  diesduck_private.get_index_messages(bigint), diesduck_private.set_index_message(bigint,text),
  public.get_index_messages(bigint), public.set_index_message(bigint,text) from public,anon,authenticated;
grant execute on function diesduck_private.get_index_messages(bigint), diesduck_private.set_index_message(bigint,text),
  public.get_index_messages(bigint), public.set_index_message(bigint,text) to authenticated;
notify pgrst, 'reload schema';
commit;
