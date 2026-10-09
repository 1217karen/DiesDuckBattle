begin;

-- Only RPC DTOs cross the Data API boundary. No client can read these tables.
create table diesduck_private.feedback_moderators (
  auth_user_id uuid primary key references auth.users(id) on delete cascade
);
create table diesduck_private.feedback_threads (
  id uuid primary key default gen_random_uuid(),
  game_account_id uuid not null references public.game_accounts(id),
  category text not null check (category in ('bug','request','question')),
  title text not null check (char_length(title) between 1 and 100 and title !~ '^[[:space:]]*$'),
  body text not null check (char_length(body) between 1 and 2000 and body !~ '^[[:space:]]*$'),
  status text not null default 'open' check (status in ('open','confirmed','resolved','withdrawn')),
  created_at timestamptz not null default now(),
  hidden_at timestamptz
);
create table diesduck_private.feedback_replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references diesduck_private.feedback_threads(id),
  game_account_id uuid not null references public.game_accounts(id),
  body text not null check (char_length(body) between 1 and 2000 and body !~ '^[[:space:]]*$'),
  -- Snapshot the authenticated writer's role, not the role of another account accessor.
  is_moderator boolean not null default false,
  created_at timestamptz not null default now(),
  hidden_at timestamptz
);
create table diesduck_private.feedback_reactions (
  thread_id uuid not null references diesduck_private.feedback_threads(id),
  game_account_id uuid not null references public.game_accounts(id),
  created_at timestamptz not null default now(),
  primary key(thread_id,game_account_id)
);
create index feedback_threads_account_idx on diesduck_private.feedback_threads(game_account_id);
create index feedback_threads_visible_idx on diesduck_private.feedback_threads(created_at desc,id) where hidden_at is null;
create index feedback_replies_thread_idx on diesduck_private.feedback_replies(thread_id,created_at,id);
create index feedback_replies_account_idx on diesduck_private.feedback_replies(game_account_id);
create index feedback_reactions_account_idx on diesduck_private.feedback_reactions(game_account_id);
alter table diesduck_private.feedback_moderators enable row level security;
alter table diesduck_private.feedback_threads enable row level security;
alter table diesduck_private.feedback_replies enable row level security;
alter table diesduck_private.feedback_reactions enable row level security;
revoke all on diesduck_private.feedback_moderators, diesduck_private.feedback_threads,
  diesduck_private.feedback_replies, diesduck_private.feedback_reactions from public,anon,authenticated;

create function diesduck_private.feedback_is_moderator()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from diesduck_private.feedback_moderators where auth_user_id=auth.uid());
$$;
create function diesduck_private.feedback_account(p_eno bigint)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare account_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select g.id into account_id from public.game_accounts g
    join public.game_account_access a on a.game_account_id=g.id
    where a.auth_user_id=auth.uid() and g.eno=p_eno;
  if account_id is null then raise exception 'Account access denied' using errcode='42501'; end if;
  return account_id;
end;
$$;

create function diesduck_private.list_feedback_threads(p_eno bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare account_id uuid; rows jsonb;
begin
  if p_eno is not null then account_id := diesduck_private.feedback_account(p_eno); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'category',t.category,'title',t.title,'body',t.body,'status',t.status,'createdAt',t.created_at,
    'reactionCount',(select count(*) from diesduck_private.feedback_reactions r where r.thread_id=t.id),
    'replyCount',(select count(*) from diesduck_private.feedback_replies r where r.thread_id=t.id and r.hidden_at is null),
    'isOwn',coalesce(t.game_account_id=account_id,false),
    'hasReacted',exists(select 1 from diesduck_private.feedback_reactions r where r.thread_id=t.id and r.game_account_id=account_id)
  ) order by t.created_at desc,t.id),'[]'::jsonb) into rows
    from diesduck_private.feedback_threads t where t.hidden_at is null;
  return jsonb_build_object('threads',rows,'canPost',account_id is not null,
    'isModerator',diesduck_private.feedback_is_moderator());
end;
$$;
create function diesduck_private.list_feedback_replies(p_thread_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'body',r.body,'createdAt',r.created_at,
    'isAuthor',r.game_account_id=t.game_account_id,'isModerator',r.is_moderator)
    order by r.created_at,r.id),'[]'::jsonb)
  from diesduck_private.feedback_replies r join diesduck_private.feedback_threads t on t.id=r.thread_id
  where t.id=p_thread_id and t.hidden_at is null and r.hidden_at is null;
$$;

create function diesduck_private.create_feedback_thread(p_eno bigint,p_category text,p_title text,p_body text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare account_id uuid; result uuid;
begin
  account_id := diesduck_private.feedback_account(p_eno);
  insert into diesduck_private.feedback_threads(game_account_id,category,title,body)
    values(account_id,p_category,p_title,p_body) returning id into result;
  return result;
end;
$$;
create function diesduck_private.create_feedback_reply(p_eno bigint,p_thread_id uuid,p_body text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare account_id uuid; result uuid;
begin
  account_id := diesduck_private.feedback_account(p_eno);
  -- Serialize with hide/status/reaction operations on this thread.
  perform 1 from diesduck_private.feedback_threads where id=p_thread_id and hidden_at is null for update;
  if not found then raise exception 'Thread unavailable' using errcode='22023'; end if;
  insert into diesduck_private.feedback_replies(thread_id,game_account_id,body,is_moderator)
    values(p_thread_id,account_id,p_body,diesduck_private.feedback_is_moderator()) returning id into result;
  return result;
end;
$$;
create function diesduck_private.toggle_feedback_reaction(p_eno bigint,p_thread_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare account_id uuid; reacted boolean;
begin
  account_id := diesduck_private.feedback_account(p_eno);
  perform 1 from diesduck_private.feedback_threads where id=p_thread_id and hidden_at is null for update;
  if not found then raise exception 'Thread unavailable' using errcode='22023'; end if;
  delete from diesduck_private.feedback_reactions where thread_id=p_thread_id and game_account_id=account_id;
  reacted := not found;
  if reacted then insert into diesduck_private.feedback_reactions(thread_id,game_account_id) values(p_thread_id,account_id); end if;
  return jsonb_build_object('hasReacted',reacted,'reactionCount',
    (select count(*) from diesduck_private.feedback_reactions where thread_id=p_thread_id));
end;
$$;
create function diesduck_private.withdraw_feedback_thread(p_eno bigint,p_thread_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare account_id uuid;
begin
  account_id := diesduck_private.feedback_account(p_eno);
  update diesduck_private.feedback_threads set status='withdrawn'
    where id=p_thread_id and game_account_id=account_id and status in ('open','confirmed') and hidden_at is null;
  if not found then raise exception 'Withdrawal denied' using errcode='42501'; end if;
  return true;
end;
$$;
create function diesduck_private.moderate_feedback_status(p_thread_id uuid,p_status text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if not diesduck_private.feedback_is_moderator() then raise exception 'Moderator required' using errcode='42501'; end if;
  if p_status is null or p_status not in ('open','confirmed','resolved') then raise exception 'Invalid status' using errcode='22023'; end if;
  update diesduck_private.feedback_threads set status=p_status where id=p_thread_id and status<>'withdrawn' and hidden_at is null;
  if not found then raise exception 'Status change denied' using errcode='42501'; end if;
  return true;
end;
$$;
create function diesduck_private.hide_feedback(p_thread_id uuid,p_reply_id uuid default null)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if not diesduck_private.feedback_is_moderator() then raise exception 'Moderator required' using errcode='42501'; end if;
  perform 1 from diesduck_private.feedback_threads where id=p_thread_id for update;
  if not found then raise exception 'Thread unavailable' using errcode='22023'; end if;
  if p_reply_id is null then
    update diesduck_private.feedback_threads set hidden_at=coalesce(hidden_at,now()) where id=p_thread_id;
  else
    update diesduck_private.feedback_replies set hidden_at=coalesce(hidden_at,now()) where id=p_reply_id and thread_id=p_thread_id;
    if not found then raise exception 'Reply unavailable' using errcode='22023'; end if;
  end if;
  return true;
end;
$$;

-- Invoker wrappers only; privileged code stays in the unexposed private schema.
create function public.list_feedback_threads(p_eno bigint default null) returns jsonb
language sql stable security invoker set search_path = '' as $$ select diesduck_private.list_feedback_threads(p_eno); $$;
create function public.list_feedback_replies(p_thread_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select diesduck_private.list_feedback_replies(p_thread_id); $$;
create function public.create_feedback_thread(p_eno bigint,p_category text,p_title text,p_body text) returns uuid
language sql volatile security invoker set search_path = '' as $$ select diesduck_private.create_feedback_thread(p_eno,p_category,p_title,p_body); $$;
create function public.create_feedback_reply(p_eno bigint,p_thread_id uuid,p_body text) returns uuid
language sql volatile security invoker set search_path = '' as $$ select diesduck_private.create_feedback_reply(p_eno,p_thread_id,p_body); $$;
create function public.toggle_feedback_reaction(p_eno bigint,p_thread_id uuid) returns jsonb
language sql volatile security invoker set search_path = '' as $$ select diesduck_private.toggle_feedback_reaction(p_eno,p_thread_id); $$;
create function public.withdraw_feedback_thread(p_eno bigint,p_thread_id uuid) returns boolean
language sql volatile security invoker set search_path = '' as $$ select diesduck_private.withdraw_feedback_thread(p_eno,p_thread_id); $$;
create function public.moderate_feedback_status(p_thread_id uuid,p_status text) returns boolean
language sql volatile security invoker set search_path = '' as $$ select diesduck_private.moderate_feedback_status(p_thread_id,p_status); $$;
create function public.hide_feedback(p_thread_id uuid,p_reply_id uuid default null) returns boolean
language sql volatile security invoker set search_path = '' as $$ select diesduck_private.hide_feedback(p_thread_id,p_reply_id); $$;

revoke all on function diesduck_private.feedback_is_moderator(), diesduck_private.feedback_account(bigint) from public,anon,authenticated;
revoke all on function diesduck_private.list_feedback_threads(bigint), diesduck_private.list_feedback_replies(uuid),
  public.list_feedback_threads(bigint),public.list_feedback_replies(uuid) from public,anon,authenticated;
grant usage on schema diesduck_private to anon,authenticated;
grant execute on function diesduck_private.list_feedback_threads(bigint),diesduck_private.list_feedback_replies(uuid),
  public.list_feedback_threads(bigint),public.list_feedback_replies(uuid) to anon,authenticated;
revoke all on function diesduck_private.create_feedback_thread(bigint,text,text,text), diesduck_private.create_feedback_reply(bigint,uuid,text),
  diesduck_private.toggle_feedback_reaction(bigint,uuid),diesduck_private.withdraw_feedback_thread(bigint,uuid),
  diesduck_private.moderate_feedback_status(uuid,text),diesduck_private.hide_feedback(uuid,uuid),
  public.create_feedback_thread(bigint,text,text,text),public.create_feedback_reply(bigint,uuid,text),
  public.toggle_feedback_reaction(bigint,uuid),public.withdraw_feedback_thread(bigint,uuid),
  public.moderate_feedback_status(uuid,text),public.hide_feedback(uuid,uuid) from public,anon,authenticated;
grant execute on function diesduck_private.create_feedback_thread(bigint,text,text,text),diesduck_private.create_feedback_reply(bigint,uuid,text),
  diesduck_private.toggle_feedback_reaction(bigint,uuid),diesduck_private.withdraw_feedback_thread(bigint,uuid),
  diesduck_private.moderate_feedback_status(uuid,text),diesduck_private.hide_feedback(uuid,uuid),
  public.create_feedback_thread(bigint,text,text,text),public.create_feedback_reply(bigint,uuid,text),
  public.toggle_feedback_reaction(bigint,uuid),public.withdraw_feedback_thread(bigint,uuid),
  public.moderate_feedback_status(uuid,text),public.hide_feedback(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
