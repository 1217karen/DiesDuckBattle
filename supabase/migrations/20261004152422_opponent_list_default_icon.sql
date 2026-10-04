begin;

-- Reuse the existing authenticated public projection. Expose only the default
-- Battler icon in the list, never the rest of its presentation or Duck data.
create or replace function public.list_online_opponents() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', account_id, 'eno', eno,
    'publicDuckId', duck_id, 'name', name,
    'defaultIconUrl', snapshot#>'{battler,presentation,defaultIconUrl}') order by eno::bigint), '[]'::jsonb)
  from diesduck_private.public_battle_data(null);
$$;
revoke all on function public.list_online_opponents() from public, anon, authenticated;
grant execute on function public.list_online_opponents() to authenticated;
notify pgrst, 'reload schema';
commit;
