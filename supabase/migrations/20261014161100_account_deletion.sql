begin;

-- The private implementations are the only elevated boundary. No client gets
-- DELETE on game_accounts/auth.users or any administrator credential.
create function diesduck_private.account_deletion_target(p_eno bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  session_id text := nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id';
  target public.game_accounts;
  battler_name text;
begin
  if caller is null or p_eno is null or p_eno < 1 then
    raise exception 'Account deletion denied' using errcode='42501';
  end if;
  -- A deleted/revoked Auth session must not authorize this sensitive operation
  -- merely because its previously issued JWT has not expired yet.
  perform 1 from auth.users where id=caller for update;
  if not found or session_id is null or not exists (
    select 1 from auth.sessions s where s.id::text=session_id and s.user_id=caller
  ) then raise exception 'Active session required' using errcode='42501'; end if;

  -- Lock referenced parents before counting grants. FK key-share locks prevent
  -- concurrent grant insertion from changing an exclusive link into shared access.
  select g.* into target from public.game_accounts g
    join public.game_account_access a on a.game_account_id=g.id
    where a.auth_user_id=caller and g.eno=p_eno for update of g;
  if not found then raise exception 'Account deletion denied' using errcode='42501'; end if;
  perform 1 from public.game_account_access a
    where a.auth_user_id=caller or a.game_account_id=target.id for update;
  if (select count(*) from public.game_account_access where auth_user_id=caller) <> 1
    or (select count(*) from public.game_account_access where game_account_id=target.id) <> 1 then
    raise exception 'Exclusive single account required' using errcode='42501';
  end if;
  select b.presentation->>'name' into battler_name from public.battlers b
    where b.game_account_id=target.id for update;
  if battler_name is null or btrim(battler_name)='' then
    raise exception 'Account identity unavailable' using errcode='22023';
  end if;
  return jsonb_build_object('gameAccountId',target.id,'authUserId',caller,'eno',target.eno::text,'name',battler_name);
end $$;

create function diesduck_private.delete_own_account(
  p_game_account_id uuid, p_auth_user_id uuid, p_eno bigint, p_name text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare target jsonb; deleted integer;
begin
  if auth.uid() is null or auth.uid() is distinct from p_auth_user_id then
    raise exception 'Authentication changed' using errcode='42501';
  end if;
  target := diesduck_private.account_deletion_target(p_eno);
  if target->>'gameAccountId' is distinct from p_game_account_id::text
    or target->>'name' is distinct from p_name then
    raise exception 'Confirmed account changed' using errcode='22023';
  end if;

  -- Resolve the public Duck reference before deleting the owning graph.
  update public.game_accounts set public_duck_id=null where id=p_game_account_id;
  -- Existing FKs cascade battler/ducks/access, messages, vault (including counters
  -- and tombstones), favorites, records and reactions. Feedback text retains its
  -- existing SET NULL semantics. battles has NO participant FKs and is untouched.
  delete from public.game_accounts where id=p_game_account_id;
  get diagnostics deleted = row_count;
  if deleted <> 1 then raise exception 'Account deletion failed' using errcode='40001'; end if;
  if exists(select 1 from public.game_account_access where auth_user_id=p_auth_user_id) then
    raise exception 'Other access remains' using errcode='42501';
  end if;
  -- Same database transaction: an Auth/storage FK/trigger failure rolls back ALL
  -- game deletions too. Supabase Auth's FKs remove sessions/identities/refresh tokens.
  delete from auth.users where id=p_auth_user_id;
  get diagnostics deleted = row_count;
  if deleted <> 1 then raise exception 'Auth deletion failed' using errcode='40001'; end if;
  return jsonb_build_object('deleted',true,'gameAccountId',p_game_account_id,'authUserId',p_auth_user_id,'eno',p_eno::text);
end $$;

create function public.prepare_account_deletion(p_eno bigint) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select diesduck_private.account_deletion_target(p_eno);
$$;
create function public.delete_own_account(p_game_account_id uuid,p_auth_user_id uuid,p_eno bigint,p_name text) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select diesduck_private.delete_own_account(p_game_account_id,p_auth_user_id,p_eno,p_name);
$$;
revoke all on function diesduck_private.account_deletion_target(bigint),
  diesduck_private.delete_own_account(uuid,uuid,bigint,text), public.prepare_account_deletion(bigint),
  public.delete_own_account(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function diesduck_private.account_deletion_target(bigint),
  diesduck_private.delete_own_account(uuid,uuid,bigint,text), public.prepare_account_deletion(bigint),
  public.delete_own_account(uuid,uuid,bigint,text) to authenticated;
notify pgrst, 'reload schema';
commit;
