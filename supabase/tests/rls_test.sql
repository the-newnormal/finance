-- Who can read and write what, and the claim workflow, through the Data API and Storage.
-- Run: pnpm supabase test db. Builds its own fixtures inside the transaction and rolls back, and
-- works with or without seed.sql (names start with "RLS").
--
-- Fixtures:
--   division D1: core member c1        division D2: core member c2
--   fin   core, finance flag, no division         adm  admin, no finance flag, no division
--   v1, v2 volunteers
--   pools: p1 (D1, budget $1,000), p2 (D2, budget $500), p3 (D1, closed)
--   categories: k1 (active), k2 (hidden)
begin;
select no_plan();

-- ---------- helpers ----------
create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

-- Looks the claim up as the database owner (security definer), whoever is signed in, so a test of a
-- function's refusal really reaches the function instead of passing a null id.
create function pg_temp.claim(p_description text) returns uuid language sql security definer as $$
  select id from public.claims where description = p_description
$$;

-- ---------- fixtures (as the database owner) ----------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000a01', 'adm@test.local'),
  ('00000000-0000-4000-8000-000000000f01', 'fin@test.local'),
  ('00000000-0000-4000-8000-000000000c01', 'c1@test.local'),
  ('00000000-0000-4000-8000-000000000c02', 'c2@test.local'),
  ('00000000-0000-4000-8000-000000000b01', 'v1@test.local'),
  ('00000000-0000-4000-8000-000000000b02', 'v2@test.local');

insert into public.members (id, email, name, role, finance) values
  ('00000000-0000-4000-8000-000000000a01', 'adm@test.local', 'Adm', 'admin', false),
  ('00000000-0000-4000-8000-000000000f01', 'fin@test.local', 'Fin', 'core', true),
  ('00000000-0000-4000-8000-000000000c01', 'c1@test.local', 'Core One', 'core', false),
  ('00000000-0000-4000-8000-000000000c02', 'c2@test.local', 'Core Two', 'core', false),
  ('00000000-0000-4000-8000-000000000b01', 'v1@test.local', 'Vol One', 'volunteer', false),
  ('00000000-0000-4000-8000-000000000b02', 'v2@test.local', 'Vol Two', 'volunteer', false);

insert into public.divisions (id, name) values
  ('10000000-0000-4000-8000-000000000d01', 'Division One'),
  ('10000000-0000-4000-8000-000000000d02', 'Division Two');

insert into public.division_members (member_id, division_id) values
  ('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000d01'),
  ('00000000-0000-4000-8000-000000000c02', '10000000-0000-4000-8000-000000000d02');

insert into public.pools (id, name, division_id, active) values
  ('20000000-0000-4000-8000-000000000e01', 'RLS Pool One', '10000000-0000-4000-8000-000000000d01', true),
  ('20000000-0000-4000-8000-000000000e02', 'RLS Pool Two', '10000000-0000-4000-8000-000000000d02', true),
  ('20000000-0000-4000-8000-000000000e03', 'RLS Pool Closed', '10000000-0000-4000-8000-000000000d01', false);

insert into public.pool_budgets (pool_id, allocated_cents) values
  ('20000000-0000-4000-8000-000000000e01', 100000),
  ('20000000-0000-4000-8000-000000000e02', 50000);

insert into public.categories (id, name, active) values
  ('30000000-0000-4000-8000-000000000001', 'RLS Transport', true),
  ('30000000-0000-4000-8000-000000000002', 'RLS Hidden', false);

-- The receipts each claim below attaches (claims refuse files that weren't uploaded).
insert into storage.objects (bucket_id, name) values
  ('receipts', '00000000-0000-4000-8000-000000000b01/a/r.jpg'),
  ('receipts', '00000000-0000-4000-8000-000000000b02/b/r.jpg'),
  ('receipts', '00000000-0000-4000-8000-000000000c01/c/i.pdf'),
  ('receipts', '00000000-0000-4000-8000-000000000f01/d/r.jpg'),
  ('receipts', '00000000-0000-4000-8000-000000000a01/e/r.jpg');

-- ---------- signed out ----------
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok($$ select id from public.claims $$, '42501', null, 'anon cannot read claims');
select throws_ok($$ select * from public.pools $$, '42501', null, 'anon cannot read pools');
reset role;

-- ---------- volunteer v1 ----------
select pg_temp.login('00000000-0000-4000-8000-000000000b01');

select lives_ok($$
  insert into public.claims (pool_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc)
  values ('20000000-0000-4000-8000-000000000e01', '30000000-0000-4000-8000-000000000001', 'v1 taxi', 2500,
          array['00000000-0000-4000-8000-000000000b01/a/r.jpg'], 'paynow_mobile', 'Mobile •••• 4567', 'v1.a.b.c')
$$, 'a volunteer submits a claim');

select results_eq(
  $$ select status::text, claimant_name, division_id::text from public.claims where description = 'v1 taxi' $$,
  $$ values ('pending_review', 'Vol One', '10000000-0000-4000-8000-000000000d01') $$,
  'the trigger sets status, name and division; volunteers start at division review');

select throws_ok($$
  insert into public.claims (kind, pool_id, category_id, description, amount_cents, vendor_name,
                             attachment_paths, payout_type, payout_masked, payout_enc)
  values ('invoice', '20000000-0000-4000-8000-000000000e01', '30000000-0000-4000-8000-000000000001', 'v1 invoice',
          9000, 'Hall', array['00000000-0000-4000-8000-000000000b01/a/i.pdf'], 'paynow_uen', 'UEN •••• 123A', 'v1.a.b.c')
$$, '42501', 'Only core personnel can submit vendor invoices.', 'volunteers cannot submit invoices');

select throws_ok($$
  insert into public.claims (pool_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc)
  values ('20000000-0000-4000-8000-000000000e03', '30000000-0000-4000-8000-000000000001', 'v1 closed', 100,
          array['00000000-0000-4000-8000-000000000b01/a/r.jpg'], 'bank', 'DBS •••• 1234', 'v1.a.b.c')
$$, 'P0001', 'That budget is not open for claims.', 'closed budgets refuse claims');

select throws_ok($$
  insert into public.claims (pool_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc)
  values ('20000000-0000-4000-8000-000000000e01', '30000000-0000-4000-8000-000000000002', 'v1 hidden cat', 100,
          array['00000000-0000-4000-8000-000000000b01/a/r.jpg'], 'bank', 'DBS •••• 1234', 'v1.a.b.c')
$$, 'P0001', 'Choose a valid category.', 'hidden categories refuse claims');

select throws_ok($$
  insert into public.claims (pool_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc)
  values ('20000000-0000-4000-8000-000000000e01', '30000000-0000-4000-8000-000000000001', 'v1 other file', 100,
          array['00000000-0000-4000-8000-000000000b02/a/r.jpg'], 'bank', 'DBS •••• 1234', 'v1.a.b.c')
$$, '42501', 'Invalid attachment.', 'claims cannot attach someone else''s files');

select throws_ok($$
  insert into public.claims (pool_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc)
  values ('20000000-0000-4000-8000-000000000e01', '30000000-0000-4000-8000-000000000001', 'v1 no file', 100,
          array['00000000-0000-4000-8000-000000000b01/never/uploaded.jpg'], 'bank', 'DBS •••• 1234', 'v1.a.b.c')
$$, 'P0001', 'Upload the receipt first.', 'claims refuse receipts that were never uploaded');

select throws_ok($$
  insert into public.claims (pool_id, category_id, description, amount_cents, expense_date, attachment_paths,
                             payout_type, payout_masked, payout_enc)
  values ('20000000-0000-4000-8000-000000000e01', '30000000-0000-4000-8000-000000000001', 'v1 future', 100,
          (now() + interval '3 days')::date, array['00000000-0000-4000-8000-000000000b01/a/r.jpg'], 'bank', 'DBS •••• 1234', 'v1.a.b.c')
$$, 'P0001', 'The purchase date can''t be in the future.', 'purchases can''t be in the future');

select throws_ok($$ select payout_enc from public.claims $$, '42501', null,
  'payout_enc is not readable through the Data API');
select throws_ok($$ update public.claims set status = 'paid' $$, '42501', null,
  'claims cannot be updated through the Data API');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('v1 taxi'), true) $$, '42501', null,
  'nobody reviews their own claim');
select throws_ok($$ select * from public.mark_paid(pg_temp.claim('v1 taxi'), 'TXN-1') $$, '42501', null,
  'volunteers cannot record payments');
select throws_ok($$ select * from public.claim_payout_enc(pg_temp.claim('v1 taxi')) $$, '42501', null,
  'volunteers cannot read payout details');

select is_empty($$ select * from public.pool_budgets $$, 'volunteers see no budget amounts');
select is_empty($$ select * from public.pool_totals $$, 'volunteers see no budget totals');
select results_eq($$ select count(*)::int from public.pools where name like 'RLS %' $$, $$ values (3) $$, 'volunteers see pool names');
select results_eq($$ select count(*)::int from public.members $$, $$ values (1) $$, 'volunteers see only themselves');

select throws_ok($$ select public.admin_update_member('00000000-0000-4000-8000-000000000b01', 'admin', true, true, '{}') $$,
  'P0002', null, 'non-admins cannot use the admin functions (RLS hides the row)');
update public.members set role = 'admin' where id = '00000000-0000-4000-8000-000000000b01';
reset role;
select results_eq($$ select role::text from public.members where id = '00000000-0000-4000-8000-000000000b01' $$,
  $$ values ('volunteer') $$, 'volunteers cannot promote themselves');

-- ---------- volunteer v2 ----------
select pg_temp.login('00000000-0000-4000-8000-000000000b02');
select lives_ok($$
  insert into public.claims (pool_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc)
  values ('20000000-0000-4000-8000-000000000e02', '30000000-0000-4000-8000-000000000001', 'v2 food', 4000,
          array['00000000-0000-4000-8000-000000000b02/b/r.jpg'], 'bank', 'DBS •••• 9999', 'v1.a.b.c')
$$, 'a second volunteer submits a claim');
select is_empty($$ select id from public.claims where description = 'v1 taxi' $$,
  'volunteers cannot see other people''s claims');
select lives_ok($$
  insert into public.claims (pool_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc, submission_id)
  values ('20000000-0000-4000-8000-000000000e02', '30000000-0000-4000-8000-000000000001', 'v2 once', 900,
          array['00000000-0000-4000-8000-000000000b02/b/r.jpg'], 'bank', 'DBS •••• 9999', 'v1.a.b.c',
          '60000000-0000-4000-8000-000000000001')
$$, 'a claim with a submission id');
select throws_ok($$
  insert into public.claims (pool_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc, submission_id)
  values ('20000000-0000-4000-8000-000000000e02', '30000000-0000-4000-8000-000000000001', 'v2 once (retry)', 900,
          array['00000000-0000-4000-8000-000000000b02/b/r.jpg'], 'bank', 'DBS •••• 9999', 'v1.a.b.c',
          '60000000-0000-4000-8000-000000000001')
$$, '23505', null, 'a retried submission cannot create a second claim');
reset role;

-- ---------- core c1 (division D1) ----------
select pg_temp.login('00000000-0000-4000-8000-000000000c01');
select results_eq($$ select description from public.claims order by description $$,
  $$ values ('v1 taxi') $$, 'core members see their division''s claims only');
select results_eq($$ select pool_id::text from public.pool_budgets $$,
  $$ values ('20000000-0000-4000-8000-000000000e01') $$, 'core members see their division''s budgets only');
select throws_ok($$ select * from public.claim_payout_enc(pg_temp.claim('v1 taxi')) $$, '42501', null,
  'core members cannot read payout details');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('v2 food'), true) $$, 'P0002', null,
  'core members cannot decide another division''s claims');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('v1 taxi'), null, null) $$, 'P0001',
  'Choose approve or reject.', 'a decision must be approve or reject');
select lives_ok($$ select * from public.decide_claim(pg_temp.claim('v1 taxi'), true) $$,
  'a core member of the division approves a volunteer''s claim');
select results_eq($$ select status::text from public.claims where description = 'v1 taxi' $$,
  $$ values ('pending_finance') $$, 'one division approval sends it to Finance');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('v1 taxi'), true) $$, '42501', null,
  'core members cannot give final approval');

select lives_ok($$
  insert into public.claims (kind, pool_id, category_id, description, amount_cents, vendor_name, due_date,
                             attachment_paths, payout_type, payout_masked, payout_enc)
  values ('invoice', '20000000-0000-4000-8000-000000000e01', '30000000-0000-4000-8000-000000000001', 'c1 venue',
          30000, 'The Hall', '2026-11-01', array['00000000-0000-4000-8000-000000000c01/c/i.pdf'],
          'paynow_uen', 'UEN •••• 123A', 'v1.a.b.c')
$$, 'core members submit vendor invoices');
select results_eq($$ select status::text from public.claims where description = 'c1 venue' $$,
  $$ values ('pending_finance') $$, 'core members'' claims go straight to Finance');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('c1 venue'), true) $$, '42501', null,
  'core members cannot approve their own claims');
reset role;

-- ---------- core c2 (division D2) ----------
select pg_temp.login('00000000-0000-4000-8000-000000000c02');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('v2 food'), false, ' ') $$, 'P0001',
  'Give a reason so the claimant can fix it.', 'rejecting needs a reason');
select lives_ok($$ select * from public.decide_claim(pg_temp.claim('v2 food'), false, 'Receipt unreadable') $$,
  'a core member rejects with a reason');
reset role;
select results_eq($$ select status::text, rejection_reason from public.claims where description = 'v2 food' $$,
  $$ values ('rejected', 'Receipt unreadable') $$, 'the rejection and its reason are stored');

-- ---------- finance fin ----------
select pg_temp.login('00000000-0000-4000-8000-000000000f01');
select results_eq($$ select count(*)::int from public.claims $$, $$ values (4) $$, 'Finance sees every claim');
select results_eq($$ select claimant_id::text, payout_enc from public.claim_payout_enc(pg_temp.claim('v1 taxi')) $$,
  $$ values ('00000000-0000-4000-8000-000000000b01', 'v1.a.b.c') $$, 'Finance reads payout details to pay');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('v2 food'), true) $$, 'P0001',
  'This claim has already been decided.', 'a decided claim cannot be decided again');
select lives_ok($$ select * from public.decide_claim(pg_temp.claim('v1 taxi'), true) $$, 'Finance approves');
select throws_ok($$ select * from public.mark_paid(pg_temp.claim('v1 taxi'), 'x') $$, 'P0001',
  'Enter the bank transaction reference.', 'paying needs a reference');
select results_eq($$ select claimant_id::text, status::text from public.mark_paid(pg_temp.claim('v1 taxi'), 'TXN-123') $$,
  $$ values ('00000000-0000-4000-8000-000000000b01', 'paid') $$, 'Finance marks it paid; the claimant''s id comes back, never their email');
select results_eq($$ select allocated_cents from public.pool_totals where pool_id = '20000000-0000-4000-8000-000000000e03' $$,
  $$ values (0::bigint) $$, 'a budget with no amount yet still shows in the totals');
select results_eq($$ select allocated_cents, pending_cents, approved_cents, paid_cents from public.pool_totals
                     where pool_id = '20000000-0000-4000-8000-000000000e01' $$,
  $$ values (100000::bigint, 30000::bigint, 0::bigint, 2500::bigint) $$, 'budget totals are computed from claims');
select lives_ok($$
  insert into public.claims (pool_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc)
  values ('20000000-0000-4000-8000-000000000e02', '30000000-0000-4000-8000-000000000001', 'fin lunch', 1500,
          array['00000000-0000-4000-8000-000000000f01/d/r.jpg'], 'paynow_mobile', 'Mobile •••• 1111', 'v1.a.b.c')
$$, 'Finance submits a claim');
select lives_ok($$ select * from public.decide_claim(pg_temp.claim('fin lunch'), true) $$,
  'Finance members may approve their own claims');
reset role;

-- ---------- admin adm (no finance flag) ----------
select pg_temp.login('00000000-0000-4000-8000-000000000a01');
select lives_ok($$
  insert into public.claims (pool_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc)
  values ('20000000-0000-4000-8000-000000000e01', '30000000-0000-4000-8000-000000000001', 'adm stamps', 800,
          array['00000000-0000-4000-8000-000000000a01/e/r.jpg'], 'paynow_mobile', 'Mobile •••• 2222', 'v1.a.b.c')
$$, 'an admin submits a claim');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('adm stamps'), true) $$, '42501', null,
  'admins without the finance flag cannot approve their own claims');
select throws_ok($$ update public.members set role = 'volunteer' where id = '00000000-0000-4000-8000-000000000a01' $$,
  '42501', 'You can''t change your own access.', 'admins cannot change their own access');
select throws_ok($$ update public.pools set division_id = '10000000-0000-4000-8000-000000000d02'
                    where id = '20000000-0000-4000-8000-000000000e01' $$, 'P0001', null,
  'a budget with claims cannot move to another division');
select lives_ok($$ update public.pools set division_id = '10000000-0000-4000-8000-000000000d02'
                   where id = '20000000-0000-4000-8000-000000000e03' $$, 'a budget without claims can move');
select throws_ok($$ select public.admin_update_member('00000000-0000-4000-8000-000000000c01', 'core', false, true,
                    array['10000000-0000-4000-8000-000000000d02', '99999999-0000-4000-8000-000000000000']::uuid[]) $$,
  '23503', null, 'an unknown division fails the whole update');
select results_eq($$ select division_id::text from public.division_members where member_id = '00000000-0000-4000-8000-000000000c01' $$,
  $$ values ('10000000-0000-4000-8000-000000000d01') $$, 'so nothing changed: divisions stay as they were');
select lives_ok($$ select public.admin_update_member('00000000-0000-4000-8000-000000000c01', 'core', false, true,
                   array['10000000-0000-4000-8000-000000000d01', '10000000-0000-4000-8000-000000000d01']::uuid[]) $$,
  'duplicate divisions are saved once');
select lives_ok($$ select public.admin_update_member('00000000-0000-4000-8000-000000000b02', 'volunteer', false, false, '{}') $$,
  'admins deactivate members');
reset role;

-- ---------- deactivated v2 ----------
select pg_temp.login('00000000-0000-4000-8000-000000000b02');
select is_empty($$ select id from public.claims $$, 'deactivated members see no claims');
select is_empty($$ select * from public.pools $$, 'deactivated members see no pools');
select is_empty($$ select * from public.members $$, 'deactivated members no longer read even their own row');
select throws_ok($$
  insert into public.claims (pool_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc)
  values ('20000000-0000-4000-8000-000000000e02', '30000000-0000-4000-8000-000000000001', 'v2 again', 100,
          array['00000000-0000-4000-8000-000000000b02/b/r.jpg'], 'bank', 'DBS •••• 9999', 'v1.a.b.c')
$$, '42501', 'Your account is not active.', 'deactivated members cannot claim');
reset role;

-- ---------- receipts storage ----------
select pg_temp.login('00000000-0000-4000-8000-000000000b01');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('receipts', '00000000-0000-4000-8000-000000000b01/z/new.jpg') $$,
  'members upload into their own folder');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('receipts', '00000000-0000-4000-8000-000000000b02/x/r.jpg') $$,
  '42501', null, 'members cannot upload into someone else''s folder');
select results_eq($$ select action from public.claim_events where claim_id = pg_temp.claim('v1 taxi') order by at, id $$,
  $$ values ('submitted'), ('reviewed'), ('approved'), ('paid') $$, 'claimants see their claim''s history');
reset role;

select pg_temp.login('00000000-0000-4000-8000-000000000c01');
select results_eq($$ select name from storage.objects where bucket_id = 'receipts' order by name $$,
  $$ values ('00000000-0000-4000-8000-000000000a01/e/r.jpg'), ('00000000-0000-4000-8000-000000000b01/a/r.jpg'),
            ('00000000-0000-4000-8000-000000000c01/c/i.pdf') $$,
  'reviewers read their own files and the receipts of claims they can see, nothing else');
reset role;

select pg_temp.login('00000000-0000-4000-8000-000000000c02');
select is_empty($$ select * from storage.objects where name = '00000000-0000-4000-8000-000000000b01/a/r.jpg' $$,
  'other divisions cannot read those receipts');
reset role;

select * from finish();
rollback;
