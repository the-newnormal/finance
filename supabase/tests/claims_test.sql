-- The claim workflow: submitting, preliminary review, final approval, rejection, payment, and the
-- spending totals. Run: pnpm supabase test db. Builds its own fixtures and rolls back; works with or
-- without seed.sql (fixture names start with "T ").
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

insert into public.categories (id, name, category_group) values
  ('0f000000-0000-4000-8000-000000000001', 'T Transport', 'operations'),
  ('0f000000-0000-4000-8000-000000000002', 'T Food', 'programme'),
  ('0f000000-0000-4000-8000-000000000003', 'T Venue', 'venue_production');

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

-- ---------- volunteer v1 submits ----------
select pg_temp.login('0a000000-0000-4000-8000-000000000001');

select lives_ok($$ select pg_temp.submit('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 'T v1 taxi', 2500) $$,
  'a volunteer submits a claim');
select results_eq(
  $$ select status::text, claimant_id::text, claimant_name, division_id::text from public.claims where description = 'T v1 taxi' $$,
  $$ values ('pending_review', '0a000000-0000-4000-8000-000000000001', 'T Vol One', '0d000000-0000-4000-8000-000000000001') $$,
  'a volunteer''s claim starts at pending_review, with the budget''s division and the claimant''s name');
select results_eq($$ select action from public.claim_events where claim_id = pg_temp.claim('T v1 taxi') $$,
  $$ values ('submitted') $$, 'submitting is logged');
select lives_ok($$ select pg_temp.submit('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 'T v1 bus', 1000) $$,
  'a second claim (stays pending)');
select lives_ok($$ select pg_temp.submit('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 'T v1 snacks', 700) $$,
  'a third claim (to be rejected)');

select throws_ok($$ select pg_temp.submit('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000003', 'T v1 venue', 100) $$,
  'P0001', 'This budget doesn''t provide for that category. Choose one of its categories.',
  'a category the budget does not provision is refused');
select throws_ok($$ select pg_temp.submit('0e000000-0000-4000-8000-000000000003', '0f000000-0000-4000-8000-000000000001', 'T v1 closed', 100) $$,
  'P0001', 'That budget is not open for claims.', 'a closed budget refuses claims');
select throws_ok($$ select pg_temp.submit('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 'T v1 invoice', 9000,
                     'invoice', 'T Hall') $$,
  '42501', 'Only division leads and Finance can submit vendor invoices.', 'volunteers cannot submit invoices');
select throws_ok($$
  insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc, submission_id)
  values ('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 'T v1 other file', 100,
          array['0a000000-0000-4000-8000-000000000002/t/r.jpg'], 'bank', 'DBS •••• 1234', 'v1.a.b.c', gen_random_uuid())
$$, '42501', 'Invalid attachment.', 'a claim cannot attach someone else''s receipt');
select throws_ok($$
  insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc, submission_id)
  values ('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 'T v1 no file', 100,
          array['0a000000-0000-4000-8000-000000000001/never/uploaded.jpg'], 'bank', 'DBS •••• 1234', 'v1.a.b.c', gen_random_uuid())
$$, 'P0001', 'Upload the receipt first.', 'a claim cannot attach a receipt that was never uploaded');
select throws_ok($$
  insert into public.claims (budget_id, category_id, description, amount_cents, expense_date, attachment_paths,
                             payout_type, payout_masked, payout_enc, submission_id)
  values ('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 'T v1 future', 100,
          (now() + interval '3 days')::date, array['0a000000-0000-4000-8000-000000000001/t/r.jpg'], 'bank', 'DBS •••• 1234',
          'v1.a.b.c', gen_random_uuid())
$$, 'P0001', 'The purchase date can''t be in the future.', 'purchases can''t be in the future');
select lives_ok($$
  insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc, submission_id)
  values ('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 'T v1 once', 100,
          array['0a000000-0000-4000-8000-000000000001/t/r.jpg'], 'bank', 'DBS •••• 1234', 'v1.a.b.c',
          '60000000-0000-4000-8000-000000000001')
$$, 'a claim with a submission id');
select throws_ok($$
  insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc, submission_id)
  values ('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 'T v1 once (retry)', 100,
          array['0a000000-0000-4000-8000-000000000001/t/r.jpg'], 'bank', 'DBS •••• 1234', 'v1.a.b.c',
          '60000000-0000-4000-8000-000000000001')
$$, '23505', null, 'a retried submission cannot create a second claim');
select throws_ok($$
  insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc)
  values ('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 'T v1 no id', 100,
          array['0a000000-0000-4000-8000-000000000001/t/r.jpg'], 'bank', 'DBS •••• 1234', 'v1.a.b.c')
$$, '23502', null, 'every claim needs a submission id');
select throws_ok($$
  insert into public.claims (status, budget_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc, submission_id)
  values ('approved', '0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 'T v1 status', 100,
          array['0a000000-0000-4000-8000-000000000001/t/r.jpg'], 'bank', 'DBS •••• 1234', 'v1.a.b.c', gen_random_uuid())
$$, '42501', null, 'claimants cannot choose a claim''s status');

select throws_ok($$ select payout_enc from public.claims $$, '42501', null, 'payout_enc is not selectable');
select throws_ok($$ update public.claims set status = 'paid' $$, '42501', null, 'claims cannot be updated directly');
select throws_ok($$ update public.claims set amount_cents = 1 where description = 'T v1 taxi' $$, '42501', null,
  'claimants cannot edit their claims');
select throws_ok($$ delete from public.claims $$, '42501', null, 'claims cannot be deleted');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('T v1 taxi'), true) $$,
  '42501', 'You can''t decide this claim.', 'the claimant cannot review their own claim');
select throws_ok($$ select * from public.mark_paid(pg_temp.claim('T v1 taxi'), 'TXN-1', 'aa000000-0000-4000-8000-000000000001') $$,
  '42501', 'Only Finance can record payments.', 'volunteers cannot record payments');
reset role;

-- ---------- lead l1 (leads D1) submits, and reviews ----------
select pg_temp.login('0b000000-0000-4000-8000-000000000001');

select lives_ok($$ select pg_temp.submit('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002', 'T l1 food', 3000) $$,
  'a lead submits a claim');
select lives_ok($$ select pg_temp.submit('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002', 'T l1 hall', 4000,
                     'invoice', 'T Hall Pte Ltd') $$, 'a lead submits a vendor invoice');
select results_eq($$ select description, status::text from public.claims where claimant_id = auth.uid() order by 1 $$,
  $$ values ('T l1 food', 'pending_finance'), ('T l1 hall', 'pending_finance') $$,
  'a lead''s claims start at pending_finance');

select throws_ok($$ select * from public.decide_claim(pg_temp.claim('T v1 snacks'), false, '  ') $$,
  'P0001', 'Give a reason so the claimant can fix it.', 'rejecting needs a reason');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('T v1 snacks'), null) $$,
  'P0001', 'Choose approve or reject.', 'a decision must be approve or reject');
select results_eq($$ select status::text, claimant_name, amount_cents, budget_name
                     from public.decide_claim(pg_temp.claim('T v1 taxi'), true) $$,
  $$ values ('pending_finance', 'T Vol One', 2500::bigint, 'T Budget One') $$,
  'a lead of the division gives the preliminary approval (to Finance)');
select results_eq($$ select status::text from public.decide_claim(pg_temp.claim('T v1 snacks'), false, 'Not a claimable expense') $$,
  $$ values ('rejected') $$, 'a lead of the division rejects with a reason');
select results_eq($$ select status::text, rejection_reason from public.claims where description = 'T v1 snacks' $$,
  $$ values ('rejected', 'Not a claimable expense') $$, 'the rejection reason is kept');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('T v1 snacks'), true) $$,
  'P0001', 'This claim has already been decided.', 'a rejected claim stays rejected');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('T v1 taxi'), true) $$,
  '42501', 'You can''t decide this claim.', 'only Finance gives final approval');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('T l1 food'), true) $$,
  '42501', 'You can''t decide this claim.', 'a lead cannot approve their own claim');
select results_eq($$ select action from public.claim_events where claim_id = pg_temp.claim('T v1 taxi') order by id $$,
  $$ values ('submitted'), ('reviewed') $$, 'the preliminary approval is logged');
select throws_ok($$ select * from public.claim_payout_enc(pg_temp.claim('T v1 taxi')) $$,
  '42501', 'Only Finance can see payout details.', 'leads cannot read payout details');
reset role;

-- ---------- lead l2 (another division) ----------
select pg_temp.login('0b000000-0000-4000-8000-000000000002');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('T v1 bus'), true) $$,
  'P0002', 'Claim not found.', 'a lead of another division cannot review the claim');
select throws_ok($$ select * from public.decide_claim(pg_temp.claim('T v1 bus'), false, 'Not ours to judge') $$,
  'P0002', 'Claim not found.', 'nor reject it');
reset role;
select results_eq($$ select status::text from public.claims where description = 'T v1 bus' $$,
  $$ values ('pending_review') $$, 'the claim is untouched');

-- ---------- Finance f1 ----------
select pg_temp.login('0c000000-0000-4000-8000-000000000001');

select lives_ok($$ select pg_temp.submit('0e000000-0000-4000-8000-000000000002', '0f000000-0000-4000-8000-000000000001', 'T f1 cab', 400) $$,
  'Finance submits a claim');
select results_eq($$ select status::text from public.claims where description = 'T f1 cab' $$,
  $$ values ('pending_finance') $$, 'Finance''s claims start at pending_finance');
select results_eq($$ select status::text from public.decide_claim(pg_temp.claim('T f1 cab'), true) $$,
  $$ values ('approved') $$, 'Finance may finalise its own claim');

select results_eq($$ select claimant_id::text, payout_enc from public.claim_payout_enc(pg_temp.claim('T v1 taxi')) $$,
  $$ values ('0a000000-0000-4000-8000-000000000001', 'v1.a.b.c') $$, 'Finance reads payout details through claim_payout_enc');
select throws_ok($$ select payout_enc from public.claims $$, '42501', null, 'not even Finance selects payout_enc');
select throws_ok($$ update public.claims set status = 'paid' where description = 'T v1 taxi' $$, '42501', null,
  'not even Finance updates claims directly');

select results_eq($$ select status::text from public.decide_claim(pg_temp.claim('T v1 taxi'), true) $$,
  $$ values ('approved') $$, 'Finance gives final approval');
select results_eq($$ select status::text from public.decide_claim(pg_temp.claim('T l1 food'), true) $$,
  $$ values ('approved') $$, 'Finance approves a lead''s claim');
select results_eq($$ select status::text from public.decide_claim(pg_temp.claim('T l1 hall'), false, 'Wrong invoice attached') $$,
  $$ values ('rejected') $$, 'Finance rejects at final review');
select results_eq($$ select action from public.claim_events where claim_id = pg_temp.claim('T v1 taxi') order by id $$,
  $$ values ('submitted'), ('reviewed'), ('approved') $$, 'final approval is logged');
select is_empty($$ select * from public.claim_payout_enc(pg_temp.claim('T v1 bus')) $$,
  'payout details are not handed out before a claim reaches Finance');

-- mark_paid
select throws_ok($$ select * from public.mark_paid(pg_temp.claim('T v1 bus'), 'TXN-1', 'aa000000-0000-4000-8000-000000000001') $$,
  'P0001', 'Only approved claims can be marked as paid.', 'only approved claims are paid');
select throws_ok($$ select * from public.mark_paid(pg_temp.claim('T v1 taxi'), ' x ', 'aa000000-0000-4000-8000-000000000001') $$,
  'P0001', 'Enter the bank transaction reference.', 'paying needs a reference');
select throws_ok($$ select * from public.mark_paid(pg_temp.claim('T v1 taxi'), 'TXN-1', null) $$,
  'P0002', 'Choose a bank account.', 'paying needs a bank account');
select throws_ok($$ select * from public.mark_paid(pg_temp.claim('T v1 taxi'), 'TXN-1', 'aa000000-0000-4000-8000-000000000002') $$,
  'P0001', 'That bank account is closed.', 'paying needs an active bank account');
select throws_ok($$ select * from public.mark_paid(gen_random_uuid(), 'TXN-1', 'aa000000-0000-4000-8000-000000000001') $$,
  'P0002', 'Claim not found.', 'paying an unknown claim');
select results_eq($$ select status::text, amount_cents from public.mark_paid(pg_temp.claim('T v1 taxi'), ' TXN-0001 ', 'aa000000-0000-4000-8000-000000000001') $$,
  $$ values ('paid', 2500::bigint) $$, 'Finance marks an approved claim paid');
select results_eq($$ select status::text, payment_reference from public.claims where description = 'T v1 taxi' $$,
  $$ values ('paid', 'TXN-0001') $$, 'the claim is paid with its reference');
select results_eq($$ select account_id::text, kind::text, amount_cents, actor_name from public.bank_entries
                     where claim_id = pg_temp.claim('T v1 taxi') $$,
  $$ values ('aa000000-0000-4000-8000-000000000001', 'payout', -2500::bigint, 'T Fin One') $$,
  'paying writes a negative payout entry on the account paid from');
select results_eq($$ select balance_cents from public.bank_balances where account_id = 'aa000000-0000-4000-8000-000000000001' $$,
  $$ values (-2500::bigint) $$, 'the payout comes off the account''s balance');
select results_eq($$ select action, note from public.claim_events where claim_id = pg_temp.claim('T v1 taxi') and action = 'paid' $$,
  $$ values ('paid', 'TXN-0001') $$, 'payment is logged with the reference only');
select throws_ok($$ select * from public.mark_paid(pg_temp.claim('T v1 taxi'), 'TXN-0002', 'aa000000-0000-4000-8000-000000000001') $$,
  'P0001', 'Only approved claims can be marked as paid.', 'a claim is paid once');

-- Spending against each guideline. B1: K1 has 'T v1 bus' 1000 pending, 'T v1 taxi' 2500 paid, 'T v1 once'
-- 100 pending and 'T v1 snacks' rejected (not counted); K2 has 'T l1 food' 3000 approved, 'T l1 hall' rejected.
select results_eq($$ select category_name, guideline_cents, pending_cents, approved_cents, paid_cents
                     from public.guideline_totals where budget_id = '0e000000-0000-4000-8000-000000000001' order by 1 $$,
  $$ values ('T Food', 50000::bigint, 0::bigint, 3000::bigint, 0::bigint),
            ('T Transport', 100000::bigint, 1100::bigint, 0::bigint, 2500::bigint) $$,
  'guideline_totals sums pending, approved and paid claims per category');
select results_eq($$ select guideline_cents, pending_cents, approved_cents, paid_cents
                     from public.budget_totals where budget_id = '0e000000-0000-4000-8000-000000000001' $$,
  $$ values (150000::bigint, 1100::bigint, 3000::bigint, 2500::bigint) $$, 'budget_totals sums the whole budget');
select results_eq($$ select approved_cents from public.guideline_totals where budget_id = '0e000000-0000-4000-8000-000000000002' $$,
  $$ values (400::bigint) $$, 'Finance''s own approved claim counts against its budget');

-- save_budget and claims
select throws_ok($$ select public.save_budget('0e000000-0000-4000-8000-000000000001', 'T Budget One', 'event',
                     '0d000000-0000-4000-8000-000000000001', true,
                     '[{"category_id": "0f000000-0000-4000-8000-000000000001", "guideline_cents": 100000}]') $$,
  'P0001', 'A category you removed already has claims against this budget. Keep it, or set its guideline to 0.',
  'save_budget refuses to unprovision a category that has claims');
select lives_ok($$ select public.save_budget('0e000000-0000-4000-8000-000000000001', 'T Budget One', 'event',
                     '0d000000-0000-4000-8000-000000000001', true,
                     '[{"category_id": "0f000000-0000-4000-8000-000000000001", "guideline_cents": 120000},
                       {"category_id": "0f000000-0000-4000-8000-000000000002", "guideline_cents": 0},
                       {"category_id": "0f000000-0000-4000-8000-000000000003", "guideline_cents": 5000}]') $$,
  'save_budget keeps a used category at 0 and provisions a new one');
select results_eq($$ select category_id::text, guideline_cents from public.budget_guidelines
                     where budget_id = '0e000000-0000-4000-8000-000000000001' order by 1 $$,
  $$ values ('0f000000-0000-4000-8000-000000000001', 120000::bigint), ('0f000000-0000-4000-8000-000000000002', 0::bigint),
            ('0f000000-0000-4000-8000-000000000003', 5000::bigint) $$, 'the guidelines are saved');
select throws_ok($$ select public.save_budget('0e000000-0000-4000-8000-000000000001', 'T Budget One', 'event',
                     '0d000000-0000-4000-8000-000000000001', true,
                     '[{"category_id": "0f000000-0000-4000-8000-000000000001", "guideline_cents": 1},
                       {"category_id": "0f000000-0000-4000-8000-000000000001", "guideline_cents": 2}]') $$,
  'P0001', 'Each category can be provisioned once per budget.', 'a category is provisioned once per budget');
select throws_ok($$ select public.save_budget('0e000000-0000-4000-8000-000000000001', 'T Budget One', 'event',
                     '0d000000-0000-4000-8000-000000000002', true,
                     '[{"category_id": "0f000000-0000-4000-8000-000000000001", "guideline_cents": 100000},
                       {"category_id": "0f000000-0000-4000-8000-000000000002", "guideline_cents": 50000}]') $$,
  'P0001', 'This budget already has claims, so it can''t move to another division. Close it and create a new one there.',
  'a budget with claims cannot move division');
select throws_ok($$ update public.budgets set division_id = '0d000000-0000-4000-8000-000000000002'
                     where id = '0e000000-0000-4000-8000-000000000001' $$,
  'P0001', 'This budget already has claims, so it can''t move to another division. Close it and create a new one there.',
  'nor by a direct update');
select lives_ok($$ update public.budgets set division_id = '0d000000-0000-4000-8000-000000000002'
                     where id = '0e000000-0000-4000-8000-000000000003' $$,
  'a budget without claims can move division');
select lives_ok($$ select public.save_budget('0e000000-0000-4000-8000-000000000001', 'T Budget One', 'event',
                     '0d000000-0000-4000-8000-000000000001', false,
                     '[{"category_id": "0f000000-0000-4000-8000-000000000001", "guideline_cents": 120000},
                       {"category_id": "0f000000-0000-4000-8000-000000000002", "guideline_cents": 0}]') $$,
  'Finance closes a budget (and unprovisions a category without claims)');
reset role;

select pg_temp.login('0a000000-0000-4000-8000-000000000001');
select throws_ok($$ select pg_temp.submit('0e000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001', 'T v1 late', 100) $$,
  'P0001', 'That budget is not open for claims.', 'a closed budget takes no more claims');
select results_eq($$ select status::text, payment_reference from public.claims where description = 'T v1 taxi' $$,
  $$ values ('paid', 'TXN-0001') $$, 'the claimant sees their claim paid');
select is_empty($$ select * from public.bank_entries $$, 'the claimant never sees which account paid them');
reset role;

select * from finish();
rollback;
