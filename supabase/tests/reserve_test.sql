-- The reserve (0006): one perpetual budget outside every division, seen, funded and claimed against
-- only by Finance. Run: pnpm supabase test db. Rolls back.
begin;
select no_plan();

create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.reserve() returns uuid language sql security definer as $$
  select id from public.budgets where is_reserve
$$;
create function pg_temp.claim(p_desc text) returns void language sql as $$
  insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc, submission_id)
  values (pg_temp.reserve(), '0b300000-0000-4000-8000-000000000001', p_desc, 3000,
          array[auth.uid()::text || '/r/r.pdf'], 'bank', 'DBS •••• 1', 'v1.a.b.c', gen_random_uuid())
$$;

insert into auth.users (id, email) values
  ('0b100000-0000-4000-8000-000000000001', 'r-fin@test.local'),
  ('0b100000-0000-4000-8000-000000000002', 'r-lead@test.local'),
  ('0b100000-0000-4000-8000-000000000003', 'r-vol@test.local');
insert into public.members (id, email, name, role) values
  ('0b100000-0000-4000-8000-000000000001', 'r-fin@test.local', 'R Fin', 'finance'),
  ('0b100000-0000-4000-8000-000000000002', 'r-lead@test.local', 'R Lead', 'lead'),
  ('0b100000-0000-4000-8000-000000000003', 'r-vol@test.local', 'R Vol', 'volunteer');
insert into public.categories (id, name) values ('0b300000-0000-4000-8000-000000000001', 'R Printing');
insert into storage.objects (bucket_id, name) values
  ('receipts', '0b100000-0000-4000-8000-000000000001/r/r.pdf'),
  ('receipts', '0b100000-0000-4000-8000-000000000002/r/r.pdf'),
  ('receipts', '0b100000-0000-4000-8000-000000000003/r/r.pdf');

select is((select count(*) from public.budgets where is_reserve), 1::bigint, 'there is exactly one reserve');
select ok((select division_id from public.budgets where is_reserve) is null, 'it belongs to no division');
select ok(exists (select 1 from public.budget_categories where budget_id = pg_temp.reserve()
                  and category_id = '0b300000-0000-4000-8000-000000000001'),
  'a new category is provisioned on the reserve automatically');
select throws_ok($$ insert into public.budgets (name, division_id, is_reserve) values ('R Second', null, true) $$,
  '23505', null, 'there can''t be a second reserve');

-- ---------- nobody but Finance sees or uses it ----------
select pg_temp.login('0b100000-0000-4000-8000-000000000003');
select is_empty($$ select 1 from public.budgets where is_reserve $$, 'volunteers don''t see the reserve');
select is_empty($$ select 1 from public.budget_categories where budget_id = pg_temp.reserve() $$, 'nor its categories');
select throws_ok($$ select pg_temp.claim('R vol claim') $$, '42501', 'Only Finance can claim against the reserve.',
  'volunteers can''t claim against it');
select throws_ok($$ select public.add_to_reserve(100, null, 'R try') $$, '42501', 'Only Finance can do this.',
  'nor add to it');

select pg_temp.login('0b100000-0000-4000-8000-000000000002');
select is_empty($$ select 1 from public.budget_totals where is_reserve $$, 'leads don''t see the reserve''s totals');
select throws_ok($$ select pg_temp.claim('R lead claim') $$, '42501', 'Only Finance can claim against the reserve.',
  'leads can''t claim against it');
select is_empty($$ select 1 from public.reserve_additions $$, 'nor see its additions');

-- ---------- Finance funds it and claims against it ----------
select pg_temp.login('0b100000-0000-4000-8000-000000000001');
select throws_ok($$ select public.add_to_reserve(100, null, 'x') $$, 'P0001', 'Add a note saying where the funds come from.',
  'an addition needs a note');
select throws_ok($$ select public.add_to_reserve(0, null, 'R nothing') $$, 'P0001', 'Enter a valid amount.', 'and an amount');
select lives_ok($$ select public.add_to_reserve(50000, null, 'R council grant') $$, 'Finance adds to the reserve');
select lives_ok($$ select public.add_to_reserve(-5000, null, 'R correction') $$, 'and can correct it the other way');
select lives_ok($$ select pg_temp.claim('R fin claim') $$, 'Finance claims against the reserve');
select results_eq($$ select status::text, division_id from public.claims where description = 'R fin claim' $$,
  $$ values ('pending_finance', null::uuid) $$, 'the claim goes to Finance and belongs to no division');
select results_eq($$ select funded_cents, pending_cents from public.budget_totals where is_reserve $$,
  $$ values (45000::bigint, 3000::bigint) $$, 'its funds are the sum of additions, and claims count against them');
select throws_ok($$ select public.save_budget(pg_temp.reserve(), 'Reserve', 'general', null, true, '[]') $$,
  'P0001', 'The reserve takes every category and has no guidelines, so there is nothing to set up.',
  'the reserve isn''t set up like other budgets');
select throws_ok($$ update public.budgets set active = false where is_reserve $$, 'P0001', 'The reserve is always open.',
  'and can''t be closed');

select results_eq($$ with d as (delete from public.budget_categories where budget_id = pg_temp.reserve()
    and category_id = '0b300000-0000-4000-8000-000000000001' returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$, 'Finance can''t remove a category from the reserve');
select throws_ok($$ insert into public.budget_guidelines (budget_id, category_id, guideline_cents)
  values (pg_temp.reserve(), '0b300000-0000-4000-8000-000000000001', 100) $$,
  '42501', null, 'nor give the reserve a guideline');

-- A lead never sees the reserve's claims.
select pg_temp.login('0b100000-0000-4000-8000-000000000002');
select is_empty($$ select id from public.claims where description = 'R fin claim' $$, 'leads don''t see reserve claims');

select * from finish();
rollback;
