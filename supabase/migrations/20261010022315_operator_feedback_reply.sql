begin;

create or replace function diesduck_private.create_feedback_reply(p_eno bigint,p_thread_id uuid,p_body text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare account_id uuid; result uuid; thread_status text; moderator boolean;
begin
  moderator := diesduck_private.feedback_is_moderator();
  if p_eno is null then
    if not moderator then raise exception 'Moderator required' using errcode='42501'; end if;
    account_id := null;
  else
    account_id := diesduck_private.feedback_account(p_eno);
  end if;
  -- Serialize with hide/status/reaction operations on this thread.
  select status into thread_status from diesduck_private.feedback_threads where id=p_thread_id and hidden_at is null for update;
  if not found then raise exception 'Thread unavailable' using errcode='22023'; end if;
  if thread_status='withdrawn' and not moderator then raise exception 'Thread closed' using errcode='42501'; end if;
  insert into diesduck_private.feedback_replies(thread_id,game_account_id,body,is_moderator)
    values(p_thread_id,account_id,p_body,moderator) returning id into result;
  return result;
end;
$$;

revoke all on function diesduck_private.create_feedback_reply(bigint,uuid,text),
  public.create_feedback_reply(bigint,uuid,text) from public,anon,authenticated;
grant execute on function diesduck_private.create_feedback_reply(bigint,uuid,text),
  public.create_feedback_reply(bigint,uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
