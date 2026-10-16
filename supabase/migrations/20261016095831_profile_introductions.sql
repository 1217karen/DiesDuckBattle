begin;

-- RPC-only storage: never expose private Presentation or writable table grants.
create function diesduck_private.introduction_is_blank(p_body text) returns boolean
language sql immutable set search_path = '' as $$
  select p_body is null or regexp_replace(regexp_replace(p_body,
    '</?(b|i|u|rb|rt|small|big)>', '', 'gi'),
    E'[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g') = '';
$$;
create table diesduck_private.profile_introductions (
  id uuid primary key default gen_random_uuid(),
  author_account_id uuid not null references public.game_accounts(id) on delete cascade,
  target_account_id uuid not null references public.game_accounts(id) on delete cascade,
  body text not null check (char_length(body) <= 500 and not diesduck_private.introduction_is_blank(body)),
  icon_slot integer check (icon_slot between 1 and 10),
  image_url text not null default '' check (image_url = '' or (char_length(image_url) <= 2048 and image_url ~* '^https?://[^[:space:]]+$')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  revision bigint not null default 1 check (revision > 0),
  unique (author_account_id,target_account_id),
  check (author_account_id <> target_account_id)
);
create index profile_introductions_target_order_idx on diesduck_private.profile_introductions(target_account_id,created_at,id);
alter table diesduck_private.profile_introductions enable row level security;
revoke all on diesduck_private.profile_introductions from public,anon,authenticated;

create function diesduck_private.list_profile_introductions(p_target_account_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'body',i.body,'iconSlot',i.icon_slot,'imageUrl',i.image_url,
    'createdAt',i.created_at,'updatedAt',i.updated_at,'revision',i.revision::text,
    'author',jsonb_build_object('accountId',g.id,'eno',g.eno::text,'name',coalesce(b.presentation->>'name',''),
      'iconUrl',coalesce(nullif(btrim(case when i.icon_slot is not null then b.presentation->'iconSlots'->>(i.icon_slot-1) end),''),b.presentation->>'defaultIconUrl',''),
      'defaultIconUrl',coalesce(b.presentation->>'defaultIconUrl',''),
      'theme',jsonb_build_object(
        'background',case when b.presentation#>>'{profile,theme,background}' ~ '^#[0-9A-Fa-f]{6}$' then b.presentation#>>'{profile,theme,background}' else '#DCEEF3' end,
        'panel',case when b.presentation#>>'{profile,theme,panel}' ~ '^#[0-9A-Fa-f]{6}$' then b.presentation#>>'{profile,theme,panel}' else '#FFFFFF' end,
        'text',case when b.presentation#>>'{profile,theme,text}' ~ '^#[0-9A-Fa-f]{6}$' then b.presentation#>>'{profile,theme,text}' else '#20282C' end,
        'accent',case when b.presentation#>>'{profile,theme,accent}' ~ '^#[0-9A-Fa-f]{6}$' then b.presentation#>>'{profile,theme,accent}' else '#4F91B3' end)))
    order by i.created_at,i.id),'[]'::jsonb)
  from diesduck_private.profile_introductions i
  join public.game_accounts g on g.id=i.author_account_id
  join public.battlers b on b.game_account_id=g.id
  where i.target_account_id=p_target_account_id;
$$;

create function diesduck_private.save_profile_introduction(p_author_account_id uuid,p_target_account_id uuid,
  p_expected_id uuid,p_expected_revision bigint,p_body text,p_icon_slot integer,p_image_url text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare result diesduck_private.profile_introductions; blank boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  -- Lock the verified grant through commit; caller-supplied UUID is only a selector.
  perform 1 from public.game_account_access where auth_user_id=auth.uid() and game_account_id=p_author_account_id for share;
  if not found then raise exception 'Account access denied' using errcode='42501'; end if;
  if p_author_account_id=p_target_account_id then raise exception 'Self introduction denied' using errcode='22023'; end if;
  if p_body is null or char_length(p_body)>500 then raise exception 'Invalid body' using errcode='22023'; end if;
  blank := diesduck_private.introduction_is_blank(p_body);
  if p_expected_id is null then
    if p_expected_revision is not null or blank then raise exception 'Invalid new introduction' using errcode='22023'; end if;
    insert into diesduck_private.profile_introductions(author_account_id,target_account_id,body,icon_slot,image_url)
      values(p_author_account_id,p_target_account_id,p_body,p_icon_slot,p_image_url)
      on conflict(author_account_id,target_account_id) do nothing returning * into result;
  elsif blank then
    -- Ignore image/icon fields for deletion, even when they are invalid.
    delete from diesduck_private.profile_introductions where id=p_expected_id and revision=p_expected_revision
      and author_account_id=p_author_account_id and target_account_id=p_target_account_id returning * into result;
  else
    update diesduck_private.profile_introductions set body=p_body,icon_slot=p_icon_slot,image_url=p_image_url,
      updated_at=clock_timestamp(),revision=revision+1
      where id=p_expected_id and revision=p_expected_revision and author_account_id=p_author_account_id
        and target_account_id=p_target_account_id returning * into result;
  end if;
  if result.id is null then raise exception 'Introduction changed; reload before saving' using errcode='40001'; end if;
  return jsonb_build_object('id',result.id,'revision',result.revision::text,'deleted',blank);
end;
$$;
create function public.list_profile_introductions(p_target_account_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select diesduck_private.list_profile_introductions(p_target_account_id); $$;
create function public.save_profile_introduction(p_author_account_id uuid,p_target_account_id uuid,
  p_expected_id uuid,p_expected_revision bigint,p_body text,p_icon_slot integer,p_image_url text) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select diesduck_private.save_profile_introduction(p_author_account_id,p_target_account_id,p_expected_id,p_expected_revision,p_body,p_icon_slot,p_image_url);
$$;
revoke all on function diesduck_private.introduction_is_blank(text) from public,anon,authenticated;
revoke all on function diesduck_private.list_profile_introductions(uuid),public.list_profile_introductions(uuid) from public,anon,authenticated;
grant execute on function diesduck_private.list_profile_introductions(uuid),public.list_profile_introductions(uuid) to anon,authenticated;
revoke all on function diesduck_private.save_profile_introduction(uuid,uuid,uuid,bigint,text,integer,text),
  public.save_profile_introduction(uuid,uuid,uuid,bigint,text,integer,text) from public,anon,authenticated;
grant execute on function diesduck_private.save_profile_introduction(uuid,uuid,uuid,bigint,text,integer,text),
  public.save_profile_introduction(uuid,uuid,uuid,bigint,text,integer,text) to authenticated;
notify pgrst, 'reload schema';
commit;
