-- Initial game data only. Auth/registration and remote deployment are separate work.
-- Supabase supplies auth.users, auth.uid(), anon/authenticated/service_role.
begin;

create table public.game_accounts (
  id uuid primary key default gen_random_uuid(),
  eno bigint generated always as identity (start with 1 increment by 1 no cycle) not null,
  public_duck_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_accounts_eno_key unique (eno),
  constraint game_accounts_eno_positive check (eno > 0)
);
comment on table public.game_accounts is 'One independent game account per ENo; UUID is separate from Auth identity.';
comment on column public.game_accounts.eno is 'Never reset/reseed this sequence or override identity values. Gaps are intentional; deleted numbers are not reused.';

create table public.game_account_access (
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  game_account_id uuid not null references public.game_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (auth_user_id, game_account_id)
);
comment on table public.game_account_access is 'Many-to-many access grants, managed only by trusted server-side code.';
create index game_account_access_account_idx on public.game_account_access (game_account_id);

create table public.battlers (
  game_account_id uuid primary key references public.game_accounts(id) on delete cascade,
  build jsonb not null default '{}'::jsonb,
  presentation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint battlers_build_object check (jsonb_typeof(build) = 'object'),
  constraint battlers_presentation_object check (jsonb_typeof(presentation) = 'object')
);
comment on table public.battlers is 'At most one Battler per account. JSON contents are interpreted by the application, not SQL game rules.';

create table public.ducks (
  id uuid primary key default gen_random_uuid(),
  game_account_id uuid not null references public.game_accounts(id) on delete cascade,
  sort_order integer not null default 0,
  build jsonb not null default '{}'::jsonb,
  presentation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ducks_account_id_id_key unique (game_account_id, id),
  constraint ducks_build_object check (jsonb_typeof(build) = 'object'),
  constraint ducks_presentation_object check (jsonb_typeof(presentation) = 'object')
);
comment on table public.ducks is 'Multiple Ducks per account; client-generated UUIDs are accepted.';
-- Non-unique so sequential reorder updates may temporarily share an order value.
create index ducks_account_sort_idx on public.ducks (game_account_id, sort_order);

-- Add after both tables exist. MATCH SIMPLE permits an unset (NULL) public Duck.
-- Clear public_duck_id before deleting a selected Duck. Account cascade deletion
-- is checked at statement end by NO ACTION, after its Ducks have been removed.
alter table public.game_accounts add constraint game_accounts_public_duck_owner_fk
  foreign key (id, public_duck_id) references public.ducks (game_account_id, id)
  on update no action on delete no action;

create function public.prevent_eno_change() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.eno is distinct from old.eno then
    raise exception 'ENo cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger game_accounts_eno_immutable before update on public.game_accounts
  for each row execute function public.prevent_eno_change();

create function public.set_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger game_accounts_updated_at before update on public.game_accounts
  for each row execute function public.set_updated_at();
create trigger battlers_updated_at before update on public.battlers
  for each row execute function public.set_updated_at();
create trigger ducks_updated_at before update on public.ducks
  for each row execute function public.set_updated_at();
revoke all on function public.prevent_eno_change(), public.set_updated_at() from public, anon, authenticated;

alter table public.game_accounts enable row level security;
alter table public.game_account_access enable row level security;
alter table public.battlers enable row level security;
alter table public.ducks enable row level security;

-- Reset Supabase default grants before allowing only intended operations/columns.
revoke all on public.game_accounts, public.game_account_access, public.battlers, public.ducks
  from public, anon, authenticated;
revoke all on sequence public.game_accounts_eno_seq from public, anon, authenticated;
grant select on public.game_accounts, public.game_account_access, public.battlers, public.ducks to authenticated;
grant update (public_duck_id) on public.game_accounts to authenticated;
grant insert (game_account_id, build, presentation), update (build, presentation) on public.battlers to authenticated;
grant insert (id, game_account_id, sort_order, build, presentation),
  update (sort_order, build, presentation) on public.ducks to authenticated;
grant delete on public.battlers, public.ducks to authenticated;
-- Server credentials stay server-side; no registration/link RPC is provided here.
grant all on public.game_accounts, public.game_account_access, public.battlers, public.ducks to service_role;
grant usage, select on sequence public.game_accounts_eno_seq to service_role;

create policy game_account_access_select_self on public.game_account_access
  for select to authenticated using (auth_user_id = (select auth.uid()));
create policy game_accounts_select_authenticated on public.game_accounts
  for select to authenticated using (true);
create policy game_accounts_update_access on public.game_accounts
  for update to authenticated
  using (exists (select 1 from public.game_account_access a
    where a.auth_user_id = (select auth.uid()) and a.game_account_id = game_accounts.id))
  with check (exists (select 1 from public.game_account_access a
    where a.auth_user_id = (select auth.uid()) and a.game_account_id = game_accounts.id));

create policy battlers_select_authenticated on public.battlers
  for select to authenticated using (true);
create policy battlers_insert_access on public.battlers
  for insert to authenticated with check (exists (select 1 from public.game_account_access a
    where a.auth_user_id = (select auth.uid()) and a.game_account_id = battlers.game_account_id));
create policy battlers_update_access on public.battlers
  for update to authenticated
  using (exists (select 1 from public.game_account_access a
    where a.auth_user_id = (select auth.uid()) and a.game_account_id = battlers.game_account_id))
  with check (exists (select 1 from public.game_account_access a
    where a.auth_user_id = (select auth.uid()) and a.game_account_id = battlers.game_account_id));
create policy battlers_delete_access on public.battlers
  for delete to authenticated using (exists (select 1 from public.game_account_access a
    where a.auth_user_id = (select auth.uid()) and a.game_account_id = battlers.game_account_id));

create policy ducks_select_access_or_public on public.ducks
  for select to authenticated using (
    exists (select 1 from public.game_account_access a
      where a.auth_user_id = (select auth.uid()) and a.game_account_id = ducks.game_account_id)
    or exists (select 1 from public.game_accounts g
      where g.id = ducks.game_account_id and g.public_duck_id = ducks.id)
  );
create policy ducks_insert_access on public.ducks
  for insert to authenticated with check (exists (select 1 from public.game_account_access a
    where a.auth_user_id = (select auth.uid()) and a.game_account_id = ducks.game_account_id));
create policy ducks_update_access on public.ducks
  for update to authenticated
  using (exists (select 1 from public.game_account_access a
    where a.auth_user_id = (select auth.uid()) and a.game_account_id = ducks.game_account_id))
  with check (exists (select 1 from public.game_account_access a
    where a.auth_user_id = (select auth.uid()) and a.game_account_id = ducks.game_account_id));
create policy ducks_delete_access on public.ducks
  for delete to authenticated using (exists (select 1 from public.game_account_access a
    where a.auth_user_id = (select auth.uid()) and a.game_account_id = ducks.game_account_id));

commit;
