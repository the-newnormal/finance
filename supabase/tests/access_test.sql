-- Who sees and changes what, by role (volunteer, lead, finance), through the Data API.
-- Run: pnpm supabase test db. Builds its own fixtures inside the transaction and rolls back; works
-- with or without seed.sql (fixture names start with "T ").
begin;
select no_plan();

-- ---------- helpers ----------
create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

-- Looks a claim up as the database owner, whoever is signed in, so a refusal really reaches the
-- function instead of being handed a null id.
create function pg_temp.claim(p_description text) returns uuid language sql security definer as $$
  select id from public.claims where description = p_description
$$;

-- Submits a claim as whoever is signed in, attaching their uploaded receipt <uid>/t/r.jpg.
create function pg_temp.submit(p_budget uuid, p_category uuid, p_description text, p_amount bigint,
  p_kind public.claim_kind default 'reimbursement', p_vendor text default null)
returns void language sql as $$
  insert into public.claims (kind, budget_id, category_id, description, amount_cents, vendor_name,
                             attachment_paths, payout_type, payout_masked, payout_enc, submission_id)
  values (p_kind, p_budget, p_category, p_description, p_amount, p_vendor,
          array[auth.uid()::text || '/t/r.jpg'], 'paynow_mobile', 'Mobile •••• 4567', 'v1.a.b.c', gen_random_uuid())
$$;

-- ---------- fixtures (as the database owner; names start with "T " to stay clear of seed.sql) ----------
-- Volunteers v1 (0a..01), v2 (0a..02); leads l1 (0b..01, leads D1), l2 (0b..02, leads D2);
-- Finance f1 (0c..01), f2 (0c..02). Budgets: B1 (D1: K1, K2), B2 (D2: K1), B3 (D1: K1, closed).
-- K3 is active but provisioned by no budget.
insert into auth.users (id, email) values
  ('0a000000-0000-4000-8000-000000000001', 't-v1@test.local'),
  ('0a000000-0000-4000-8000-000000000002', 't-v2@test.local'),
  ('0b000000-0000-4000-8000-000000000001', 't-l1@test.local'),
  ('0b000000-0000-4000-8000-000000000002', 't-l2@test.local'),
  ('0c000000-0000-4000-8000-000000000001', 't-f1@test.local'),
  ('0c000000-0000-4000-8000-000000000002', 't-f2@test.local'),
  ('0a000000-0000-4000-8000-000000000099', 't-new@test.local');

insert into public.members (id, email, name, role) values
  ('0a000000-0000-4000-8000-000000000001', 't-v1@test.local', 'T Vol One', 'volunteer'),
  ('0a000000-0000-4000-8000-000000000002', 't-v2@test.local', 'T Vol Two', 'volunteer'),
  ('0b000000-0000-4000-8000-000000000001', 't-l1@test.local', 'T Lead One', 'lead'),
  ('0b000000-0000-4000-8000-000000000002', 't-l2@test.local', 'T Lead Two', 'lead'),
  ('0c000000-0000-4000-8000-000000000001', 't-f1@test.local', 'T Fin One', 'finance'),
  ('0c000000-0000-4000-8000-000000000002', 't-f2@test.local', 'T Fin Two', 'finance');

insert into public.divisions (id, name) values
  ('0d000000-0000-4000-8000-000000000001', 'T Division One'),
  ('0d000000-0000-4000-8000-000000000002', 'T Division Two');

insert into public.division_leads (member_id, division_id) values
  ('0b000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000002', '0d000000-0000-4000-8000-000000000002');

insert into public.categories (id, name) values
  ('0f000000-0000-4000-8000-000000000001', 'T Transport'),
  ('0f000000-0000-4000-8000-000000000002', 'T Food'),
  ('0f000000-0000-4000-8000-000000000003', 'T Venue');

insert into public.budgets (id, name, kind, division_id, active) values
  ('0e000000-0000-4000-8000-000000000001', 'T Budget One', 'event', '0d000000-0000-4000-8000-000000000001', true),
  ('0e000000-0000-4000-8000-000000000002', 'T Budget Two', 'general', '0d000000-0000-4000-8000-000000000002', true),
  ('0e000000-0000-4000-8000-000000000003', 'T Budget Closed', 'event', '0d000000-0000-4000-8000-000000000001', false);

insert into public.budget_categories (budget_id, category_id) values
  ('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001'),
  ('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002'),
  ('0e000000-0000-4000-8000-000000000002', '0f000000-0000-4000-8000-000000000001'),
  ('0e000000-0000-4000-8000-000000000003', '0f000000-0000-4000-8000-000000000001');

insert into public.budget_guidelines (budget_id, category_id, guideline_cents) values
  ('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 100000),
  ('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002', 50000),
  ('0e000000-0000-4000-8000-000000000002', '0f000000-0000-4000-8000-000000000001', 20000),
  ('0e000000-0000-4000-8000-000000000003', '0f000000-0000-4000-8000-000000000001', 10000);

insert into public.bank_accounts (id, name, last4, active) values
  ('aa000000-0000-4000-8000-000000000001', 'T Joint A', '1234', true),
  ('aa000000-0000-4000-8000-000000000002', 'T Closed B', '5678', false);

-- The receipt each member's claims attach (claims refuse files that weren't uploaded).
insert into storage.objects (bucket_id, name) values
  ('receipts', '0a000000-0000-4000-8000-000000000001/t/r.jpg'),
  ('receipts', '0a000000-0000-4000-8000-000000000002/t/r.jpg'),
  ('receipts', '0b000000-0000-4000-8000-000000000001/t/r.jpg'),
  ('receipts', '0b000000-0000-4000-8000-000000000002/t/r.jpg'),
  ('receipts', '0c000000-0000-4000-8000-000000000001/t/r.jpg'),
  ('receipts', '0c000000-0000-4000-8000-000000000002/t/r.jpg');

-- A claim for each volunteer and for lead l1 (submitted as them: the trigger needs a signed-in member).
select pg_temp.login('0a000000-0000-4000-8000-000000000001');
select pg_temp.submit('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 'T v1 taxi', 2500);
select pg_temp.login('0a000000-0000-4000-8000-000000000002');
select pg_temp.submit('0e000000-0000-4000-8000-000000000002', '0f000000-0000-4000-8000-000000000001', 'T v2 taxi', 1500);
select pg_temp.login('0b000000-0000-4000-8000-000000000001');
select pg_temp.submit('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002', 'T l1 food', 3000);
reset role;

-- ---------- signed out ----------
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok(format('select * from public.%I', t), '42501', null, format('anon cannot read %s', t))
from unnest(array['divisions', 'members', 'division_leads', 'member_payouts', 'categories', 'budgets',
                  'budget_categories', 'budget_guidelines', 'claim_events', 'guideline_totals',
                  'budget_totals', 'bank_accounts', 'bank_entries', 'bank_balances']) t;
select throws_ok($$ select id from public.claims $$, '42501', null, 'anon cannot read claims');
select throws_ok($$ select public.decide_claim(gen_random_uuid(), true) $$, '42501', null, 'anon cannot call functions');
reset role;

-- ---------- volunteer v1 ----------
select pg_temp.login('0a000000-0000-4000-8000-000000000001');

select results_eq($$ select count(*)::int from public.budgets where name like 'T %' $$, $$ values (3) $$,
  'volunteers see budget names');
select results_eq($$ select count(*)::int from public.budget_categories
                     where budget_id::text like '0e000000-%' $$, $$ values (4) $$,
  'volunteers see which categories each budget provisions');
select results_eq($$ select count(*)::int from public.categories where name like 'T %' $$, $$ values (3) $$,
  'volunteers see categories');
select results_eq($$ select count(*)::int from public.divisions where name like 'T %' $$, $$ values (2) $$,
  'volunteers see divisions');
select is_empty($$ select * from public.budget_guidelines $$, 'volunteers see no guidelines');
select is_empty($$ select * from public.budget_totals $$, 'volunteers see no budget totals');
select is_empty($$ select * from public.guideline_totals $$, 'volunteers see no guideline totals');
select results_eq($$ select description from public.claims $$, $$ values ('T v1 taxi') $$,
  'volunteers see only their own claims');
select results_eq($$ select count(*)::int from public.claim_events $$, $$ values (1) $$,
  'volunteers see only their own claims'' history');
select results_eq($$ select id::text from public.members $$, $$ values ('0a000000-0000-4000-8000-000000000001') $$,
  'volunteers see only their own member row');
select is_empty($$ select * from public.division_leads $$, 'volunteers lead nothing');
select is_empty($$ select * from public.bank_accounts $$, 'volunteers see no bank accounts');

select throws_ok($$ insert into public.divisions (name) values ('T Vol Division') $$, '42501', null,
  'volunteers cannot add divisions');
select throws_ok($$ insert into public.categories (name) values ('T Vol Category') $$, '42501', null,
  'volunteers cannot add categories');
select results_eq($$ with u as (update public.budgets set name = 'T Hacked' where name like 'T %' returning 1)
                     select count(*)::int from u $$, $$ values (0) $$, 'volunteers cannot rename budgets');
select results_eq($$ with u as (update public.members set role = 'finance' where id = auth.uid() returning 1)
                     select count(*)::int from u $$, $$ values (0) $$, 'volunteers cannot promote themselves');
select throws_ok($$ select public.save_budget(null, 'T Vol Budget', 'event', '0d000000-0000-4000-8000-000000000001', true,
                     '[{"category_id": "0f000000-0000-4000-8000-000000000001", "guideline_cents": 100}]') $$,
  '42501', null, 'volunteers cannot create budgets');
select throws_ok($$ select public.update_member('0a000000-0000-4000-8000-000000000001', 'finance', true, '{}') $$,
  'P0002', 'That person wasn''t found.', 'volunteers cannot use update_member (RLS hides the row)');
select throws_ok($$ select public.add_member('0a000000-0000-4000-8000-000000000099', 't-new@test.local', 'T New', 'volunteer', '{}') $$,
  '42501', null, 'volunteers cannot add members');
reset role;
select results_eq($$ select role::text from public.members where id = '0a000000-0000-4000-8000-000000000001' $$,
  $$ values ('volunteer') $$, 'the volunteer is still a volunteer');

-- ---------- lead l1 (leads D1) ----------
select pg_temp.login('0b000000-0000-4000-8000-000000000001');

select results_eq($$ select budget_id::text, category_id::text from public.budget_guidelines
                     where budget_id::text like '0e000000-%' order by 1, 2 $$,
  $$ values ('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001'),
            ('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002'),
            ('0e000000-0000-4000-8000-000000000003', '0f000000-0000-4000-8000-000000000001') $$,
  'a lead sees the guidelines of their divisions'' budgets only');
select results_eq($$ select budget_id::text from public.budget_totals where budget_id::text like '0e000000-%' order by 1 $$,
  $$ values ('0e000000-0000-4000-8000-000000000001'), ('0e000000-0000-4000-8000-000000000003') $$,
  'a lead sees the totals of their divisions'' budgets only');
select is_empty($$ select * from public.guideline_totals where budget_id = '0e000000-0000-4000-8000-000000000002' $$,
  'a lead sees no guideline totals for another division');
select results_eq($$ select count(*)::int from public.guideline_totals where budget_id = '0e000000-0000-4000-8000-000000000001' $$,
  $$ values (2) $$, 'a lead sees guideline totals for their division');
select results_eq($$ select description from public.claims order by 1 $$,
  $$ values ('T l1 food'), ('T v1 taxi') $$, 'a lead sees their own and their division''s claims, not another division''s');
select results_eq($$ select id::text from public.members $$, $$ values ('0b000000-0000-4000-8000-000000000001') $$,
  'a lead sees only their own member row');
select results_eq($$ select division_id::text from public.division_leads $$, $$ values ('0d000000-0000-4000-8000-000000000001') $$,
  'a lead sees which divisions they lead');

select is_empty($$ select * from public.bank_accounts $$, 'leads see no bank accounts');
select is_empty($$ select * from public.bank_entries $$, 'leads see no bank entries');
select is_empty($$ select * from public.bank_balances $$, 'leads see no bank balances');
select results_eq($$ with u as (update public.bank_accounts set name = 'T Hacked' returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'leads cannot rename bank accounts');
select throws_ok($$ insert into public.bank_entries (account_id, kind, amount_cents, entry_date, note, actor_name)
                     values ('aa000000-0000-4000-8000-000000000001', 'grant', 100, current_date, 'T grant', 'x') $$,
  '42501', null, 'leads cannot write the ledger directly');
select throws_ok($$ select public.record_bank_entry('aa000000-0000-4000-8000-000000000001', 'grant', 100, null, 'T grant') $$,
  '42501', 'Only Finance can do this.', 'leads cannot record bank entries');
select throws_ok($$ select public.add_bank_account('T Lead Account', 'DBS', '4321', 0, null) $$,
  '42501', 'Only Finance can do this.', 'leads cannot add bank accounts');
select throws_ok($$ select public.transfer_between_accounts('aa000000-0000-4000-8000-000000000001',
                     'aa000000-0000-4000-8000-000000000002', 100, null, null) $$,
  '42501', 'Only Finance can do this.', 'leads cannot transfer between accounts');
select throws_ok($$ select * from public.claim_payout_enc(pg_temp.claim('T v1 taxi')) $$,
  '42501', 'Only Finance can see payout details.', 'leads cannot read payout details');

select throws_ok($$ insert into public.divisions (name) values ('T Lead Division') $$, '42501', null,
  'leads cannot add divisions');
select throws_ok($$ insert into public.categories (name) values ('T Lead Category') $$, '42501', null,
  'leads cannot add categories');
select throws_ok($$ insert into public.budgets (name, division_id) values ('T Lead Budget', '0d000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'leads cannot add budgets');
select results_eq($$ with u as (update public.budget_guidelines set guideline_cents = 1 returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'leads cannot change guidelines');
select results_eq($$ with u as (update public.divisions set name = name || 'x' returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'leads cannot rename divisions');
select throws_ok($$ select public.save_budget('0e000000-0000-4000-8000-000000000001', 'T Budget One', 'event',
                     '0d000000-0000-4000-8000-000000000001', true,
                     '[{"category_id": "0f000000-0000-4000-8000-000000000001", "guideline_cents": 999999}]') $$,
  'P0002', 'That budget wasn''t found.', 'leads cannot save their own budgets (RLS hides the row)');
select throws_ok($$ select public.add_member('0a000000-0000-4000-8000-000000000099', 't-new@test.local', 'T New', 'lead',
                     array['0d000000-0000-4000-8000-000000000001'::uuid]) $$,
  '42501', null, 'leads cannot add members');
select throws_ok($$ select public.update_member('0a000000-0000-4000-8000-000000000001', 'lead', true,
                     array['0d000000-0000-4000-8000-000000000001'::uuid]) $$,
  'P0002', 'That person wasn''t found.', 'leads cannot change members');
select throws_ok($$ insert into public.division_leads (member_id, division_id)
                     values ('0b000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'leads cannot make themselves lead another division');
select results_eq($$ with u as (update public.members set active = false where id = auth.uid() returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'leads cannot change their own access');
reset role;

-- ---------- lead l2 (leads D2) ----------
select pg_temp.login('0b000000-0000-4000-8000-000000000002');
select results_eq($$ select description from public.claims $$, $$ values ('T v2 taxi') $$,
  'the other division''s lead sees only their division''s claims');
select results_eq($$ select budget_id::text from public.budget_totals where budget_id::text like '0e000000-%' $$,
  $$ values ('0e000000-0000-4000-8000-000000000002') $$, 'the other division''s lead sees only their budget''s totals');
reset role;

-- ---------- Finance f1 ----------
select pg_temp.login('0c000000-0000-4000-8000-000000000001');

select results_eq($$ select count(*)::int from public.budget_guidelines where budget_id::text like '0e000000-%' $$,
  $$ values (4) $$, 'Finance sees every guideline');
select results_eq($$ select count(*)::int from public.budget_totals where budget_id::text like '0e000000-%' $$,
  $$ values (3) $$, 'Finance sees every budget''s totals');
select results_eq($$ select count(*)::int from public.guideline_totals where budget_id::text like '0e000000-%' $$,
  $$ values (4) $$, 'Finance sees every guideline total');
select results_eq($$ select count(*)::int from public.claims where description like 'T %' $$,
  $$ values (3) $$, 'Finance sees every claim');
select results_eq($$ select count(*)::int from public.members where email like 't-%@test.local' $$,
  $$ values (6) $$, 'Finance sees every member');
select results_eq($$ select count(*)::int from public.bank_accounts where name like 'T %' $$,
  $$ values (2) $$, 'Finance sees the bank accounts');

select lives_ok($$ insert into public.divisions (id, name) values ('0d000000-0000-4000-8000-000000000003', 'T Division Three') $$,
  'Finance adds divisions');
select lives_ok($$ update public.divisions set name = 'T Division 3' where id = '0d000000-0000-4000-8000-000000000003' $$,
  'Finance renames divisions');
select lives_ok($$ insert into public.categories (id, name) values ('0f000000-0000-4000-8000-000000000004', 'T Printing') $$,
  'Finance adds categories');
select results_eq($$ with u as (update public.categories set active = false where id = '0f000000-0000-4000-8000-000000000004' returning 1)
                     select count(*)::int from u $$, $$ values (1) $$, 'Finance updates categories');
select results_eq($$ with u as (update public.budgets set name = 'T Budget Two (renamed)' where id = '0e000000-0000-4000-8000-000000000002' returning 1)
                     select count(*)::int from u $$, $$ values (1) $$, 'Finance updates budgets');
select lives_ok($$ select public.save_budget(null, 'T New Budget', 'event', '0d000000-0000-4000-8000-000000000003', true,
                     '[{"category_id": "0f000000-0000-4000-8000-000000000001", "guideline_cents": 5000},
                       {"category_id": "0f000000-0000-4000-8000-000000000003", "guideline_cents": 7000}]') $$,
  'Finance creates a budget with its guidelines');
select results_eq($$ select g.guideline_cents from public.budget_guidelines g join public.budgets b on b.id = g.budget_id
                     where b.name = 'T New Budget' order by 1 $$, $$ values (5000::bigint), (7000::bigint) $$,
  'save_budget saves the budget and its guidelines together');
select throws_ok($$ select public.save_budget(null, 'T Empty Budget', 'event', '0d000000-0000-4000-8000-000000000003', true, '[]') $$,
  'P0001', 'Provision at least one spend category.', 'a budget needs at least one category');

select lives_ok($$ select public.add_member('0a000000-0000-4000-8000-000000000099', ' T-New@Test.local ', ' T New ', 'lead',
                     array['0d000000-0000-4000-8000-000000000002'::uuid, '0d000000-0000-4000-8000-000000000002'::uuid]) $$,
  'Finance adds a lead and their divisions together');
select results_eq($$ select m.email, m.name, m.role::text, dl.division_id::text from public.members m
                     join public.division_leads dl on dl.member_id = m.id where m.id = '0a000000-0000-4000-8000-000000000099' $$,
  $$ values ('t-new@test.local', 'T New', 'lead', '0d000000-0000-4000-8000-000000000002') $$,
  'add_member normalises the email and name and saves the division once');
select lives_ok($$ select public.update_member('0a000000-0000-4000-8000-000000000099', 'volunteer', false,
                     array['0d000000-0000-4000-8000-000000000001'::uuid]) $$, 'Finance changes a member');
select results_eq($$ select m.role::text, m.active, (select count(*)::int from public.division_leads dl where dl.member_id = m.id)
                     from public.members m where m.id = '0a000000-0000-4000-8000-000000000099' $$,
  $$ values ('volunteer', false, 0) $$, 'only leads lead divisions');
select throws_ok($$ select public.update_member('0c000000-0000-4000-8000-000000000001', 'volunteer', true, '{}') $$,
  '42501', 'You can''t change your own access.', 'Finance cannot demote itself');
select throws_ok($$ update public.members set active = false where id = '0c000000-0000-4000-8000-000000000001' $$,
  '42501', 'You can''t change your own access.', 'Finance cannot deactivate itself');
select throws_ok($$ update public.members set email = 't-other@test.local' where id = '0a000000-0000-4000-8000-000000000001' $$,
  'P0001', 'A member''s login and email can''t be changed.', 'a member''s email never changes');
select lives_ok($$ select public.update_member('0c000000-0000-4000-8000-000000000002', 'finance', false, '{}') $$,
  'Finance may deactivate another Finance member');
reset role;

-- ---------- a deactivated member sees nothing ----------
select pg_temp.login('0c000000-0000-4000-8000-000000000002');
select is_empty($$ select * from public.members $$, 'deactivated members see no member rows');
select is_empty($$ select * from public.budgets $$, 'deactivated members see no budgets');
select is_empty($$ select id from public.claims $$, 'deactivated members see no claims');
select is_empty($$ select * from public.bank_accounts $$, 'deactivated Finance sees no bank accounts');
reset role;

select * from finish();
rollback;
