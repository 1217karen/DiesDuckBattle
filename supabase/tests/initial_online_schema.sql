-- Run ONLY against a disposable local Supabase DB after the migration.
-- psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/initial_online_schema.sql
-- Fixtures roll back; identity sequence increments intentionally do not.
begin;
create function pg_temp.assert_true(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
end;
$$;
create function pg_temp.expect_error(query text, expected_state text) returns void
language plpgsql as $$
begin
  begin
    execute query;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE % for %', expected_state, query;
end;
$$;

insert into auth.users (id) values
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002');
insert into public.game_accounts (id) values
 ('20000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002'),
 ('20000000-0000-0000-0000-000000000003');
insert into public.game_account_access (auth_user_id, game_account_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003'),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003');
insert into public.battlers (game_account_id)
 select id from public.game_accounts where id::text like '20000000-%';
insert into public.ducks (id,game_account_id) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002'),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002');
update public.game_accounts set public_duck_id='30000000-0000-0000-0000-000000000002'
 where id='20000000-0000-0000-0000-000000000002';

select pg_temp.assert_true((select count(distinct eno)=3 and min(eno)>0
 from public.game_accounts where id::text like '20000000-%'), 'distinct positive identity ENo');
select pg_temp.expect_error($q$update public.game_accounts set eno=eno+1000$q$, '23514');
select pg_temp.expect_error($q$insert into public.game_accounts(eno) values (999999)$q$, '428C9');
select pg_temp.expect_error($q$insert into public.battlers(game_account_id)
 values ('20000000-0000-0000-0000-000000000001')$q$, '23505');
select pg_temp.expect_error($q$insert into public.game_account_access values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',now())$q$, '23505');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select pg_temp.assert_true((select count(*)=2 from public.game_account_access), 'only own access rows; multiple accounts');
select pg_temp.assert_true((select count(*)=3 from public.game_accounts where id::text like '20000000-%'), 'account directory');
select pg_temp.assert_true((select count(*)=3 from public.battlers where game_account_id::text like '20000000-%'), 'opponent Battlers');
select pg_temp.assert_true((select count(*)=2 from public.ducks where id::text like '30000000-%'), 'own Duck plus public opponent Duck');
select pg_temp.assert_true(not exists(select 1 from public.ducks where id='30000000-0000-0000-0000-000000000003'), 'private opponent Duck hidden');
select pg_temp.expect_error($q$insert into public.game_account_access(auth_user_id,game_account_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002')$q$, '42501');
select pg_temp.expect_error($q$update public.game_account_access set auth_user_id=auth_user_id$q$, '42501');
select pg_temp.expect_error($q$delete from public.game_account_access$q$, '42501');
select pg_temp.expect_error($q$insert into public.game_accounts default values$q$, '42501');
select pg_temp.expect_error($q$delete from public.game_accounts$q$, '42501');
select pg_temp.expect_error($q$update public.game_accounts set eno=eno$q$, '42501');
select pg_temp.expect_error($q$update public.game_accounts set public_duck_id='30000000-0000-0000-0000-000000000002'
 where id='20000000-0000-0000-0000-000000000001'$q$, '23503');
select pg_temp.expect_error($q$insert into public.ducks(game_account_id)
 values ('20000000-0000-0000-0000-000000000002')$q$, '42501');
select pg_temp.expect_error($q$update public.ducks set game_account_id='20000000-0000-0000-0000-000000000002'$q$, '42501');
select pg_temp.expect_error($q$update public.battlers set build='[]'$q$, '23514');
select pg_temp.expect_error($q$update public.ducks set presentation='null'$q$, '23514');
select pg_temp.expect_error($q$update public.ducks set build=null$q$, '23502');
with changed as (update public.ducks set build='{"forged":true}'
 where game_account_id='20000000-0000-0000-0000-000000000002' returning *)
 select pg_temp.assert_true(count(*)=0,'cannot update opponent Ducks') from changed;
with changed as (delete from public.ducks where game_account_id='20000000-0000-0000-0000-000000000002' returning *)
 select pg_temp.assert_true(count(*)=0,'cannot delete opponent Ducks') from changed;
with changed as (update public.battlers set build='{"forged":true}'
 where game_account_id='20000000-0000-0000-0000-000000000002' returning *)
 select pg_temp.assert_true(count(*)=0,'cannot update opponent Battler') from changed;
with changed as (update public.game_accounts set public_duck_id=null
 where id='20000000-0000-0000-0000-000000000002' returning *)
 select pg_temp.assert_true(count(*)=0,'cannot change opponent public Duck') from changed;
update public.battlers set build='{"bSelection":null}', presentation='{"name":"test"}'
 where game_account_id='20000000-0000-0000-0000-000000000001';
update public.ducks set build='{"stats":{}}', presentation='{"name":"test"}',sort_order=2
 where id='30000000-0000-0000-0000-000000000001';
select pg_temp.assert_true((select build='{"stats":{}}'::jsonb and sort_order=2 and updated_at>created_at
 from public.ducks where id='30000000-0000-0000-0000-000000000001'), 'owner writes allowed and timestamp updated');
update public.game_accounts set public_duck_id='30000000-0000-0000-0000-000000000001'
 where id='20000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($q$delete from public.ducks where id='30000000-0000-0000-0000-000000000001'$q$, '23503');
update public.game_accounts set public_duck_id=null where id='20000000-0000-0000-0000-000000000001';
delete from public.ducks where id='30000000-0000-0000-0000-000000000001';
insert into public.ducks(game_account_id) values ('20000000-0000-0000-0000-000000000003');
delete from public.battlers where game_account_id='20000000-0000-0000-0000-000000000003';
insert into public.battlers(game_account_id) values ('20000000-0000-0000-0000-000000000003');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
with changed as (update public.battlers set presentation='{"name":"shared"}'
 where game_account_id='20000000-0000-0000-0000-000000000003' returning *)
 select pg_temp.assert_true(count(*)=1,'second Auth user can edit shared account') from changed;
select pg_temp.expect_error($q$delete from public.ducks where id='30000000-0000-0000-0000-000000000002'$q$, '23503');

set local role anon;
select pg_temp.expect_error('select * from public.game_accounts','42501');
select pg_temp.expect_error('select * from public.game_account_access','42501');
select pg_temp.expect_error('select * from public.battlers','42501');
select pg_temp.expect_error('select * from public.ducks','42501');
reset role;
-- Even an account with a selected public Duck can be removed by the server.
delete from public.game_accounts where id='20000000-0000-0000-0000-000000000002';
select pg_temp.assert_true(not exists(select 1 from public.ducks
 where game_account_id='20000000-0000-0000-0000-000000000002'), 'Duck cascade');
select pg_temp.assert_true(not exists(select 1 from public.battlers
 where game_account_id='20000000-0000-0000-0000-000000000002'), 'Battler cascade');
rollback;
