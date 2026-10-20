-- Importing past paid claims (0005): Finance only, all or nothing, rows named in errors, each claim
-- paid and counted against its guideline, its payout taken off the named account (never before the
-- account's opening balance), and receipts attachable afterwards. Run: pnpm supabase test db.
begin;
select no_plan();

create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.claim(p_description text) returns uuid language sql security definer as $$
  select id from public.claims where description = p_description
$$;
create function pg_temp.row(p_email text, p_desc text, p_paid text, p_budget text default 'I Budget',
  p_category text default 'I Food', p_account text default 'I Joint') returns jsonb language sql as $$
  select jsonb_build_object('email', p_email, 'budget', p_budget, 'category', p_category, 'description', p_desc,
    'amount_cents', 2500, 'expense_date', null, 'paid_on', p_paid, 'reference', 'TXN-001', 'account', p_account)
$$;

-- f: Finance; l: lead of the division; v: volunteer
insert into auth.users (id, email) values
  ('0a100000-0000-4000-8000-000000000001', 'i-fin@test.local'),
  ('0a100000-0000-4000-8000-000000000002', 'i-lead@test.local'),
  ('0a100000-0000-4000-8000-000000000003', 'i-vol@test.local');
insert into public.members (id, email, name, role) values
  ('0a100000-0000-4000-8000-000000000001', 'i-fin@test.local', 'I Fin', 'finance'),
  ('0a100000-0000-4000-8000-000000000002', 'i-lead@test.local', 'I Lead', 'lead'),
  ('0a100000-0000-4000-8000-000000000003', 'i-vol@test.local', 'I Vol', 'volunteer');
insert into public.divisions (id, name) values ('0a200000-0000-4000-8000-000000000001', 'I Division');
insert into public.division_leads (member_id, division_id) values
  ('0a100000-0000-4000-8000-000000000002', '0a200000-0000-4000-8000-000000000001');
insert into public.categories (id, name) values
  ('0a300000-0000-4000-8000-000000000001', 'I Food'),
  ('0a300000-0000-4000-8000-000000000002', 'I Venue');
insert into public.budgets (id, name, division_id) values
  ('0a400000-0000-4000-8000-000000000001', 'I Budget', '0a200000-0000-4000-8000-000000000001');
insert into public.budget_categories (budget_id, category_id) values
  ('0a400000-0000-4000-8000-000000000001', '0a300000-0000-4000-8000-000000000001');
insert into public.budget_guidelines (budget_id, category_id, guideline_cents) values
  ('0a400000-0000-4000-8000-000000000001', '0a300000-0000-4000-8000-000000000001', 10000);
insert into public.bank_accounts (id, name, last4) values ('0a500000-0000-4000-8000-000000000001', 'I Joint', '1111');
insert into public.bank_entries (account_id, kind, amount_cents, entry_date, note, actor_name) values
  ('0a500000-0000-4000-8000-000000000001', 'opening', 100000, '2026-01-01', 'Opening balance', 'I Fin');
insert into storage.objects (bucket_id, name) values
  ('receipts', '0a100000-0000-4000-8000-000000000001/x/r.pdf'),
  ('receipts', '0a100000-0000-4000-8000-000000000003/x/r.pdf');

-- ---------- only Finance ----------
select pg_temp.login('0a100000-0000-4000-8000-000000000002');
select throws_ok($$ select public.import_paid_claims(jsonb_build_array(pg_temp.row('i-vol@test.local', 'I lead try', '2026-02-01'))) $$,
  '42501', 'Only Finance can do this.', 'leads can''t import');
select throws_ok($$ insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths, submission_id, imported)
  values ('0a400000-0000-4000-8000-000000000001', '0a300000-0000-4000-8000-000000000001', 'I direct', 100, '{}', gen_random_uuid(), true) $$,
  '42501', null, 'nobody marks a claim imported through the API');

-- ---------- refusals name the row, and save nothing ----------
select pg_temp.login('0a100000-0000-4000-8000-000000000001');
select throws_ok($$ select public.import_paid_claims(jsonb_build_array(
    pg_temp.row('i-vol@test.local', 'I ok one', '2026-02-01'),
    pg_temp.row('nobody@test.local', 'I bad member', '2026-02-01'))) $$,
  'P0001', 'Row 2: no member has the email nobody@test.local. Add them on the People page first.', 'unknown members are refused by row');
select is_empty($$ select 1 from public.claims where description = 'I ok one' $$, 'and nothing from the batch is saved');
select throws_ok($$ select public.import_paid_claims(jsonb_build_array(pg_temp.row('i-vol@test.local', 'I x', '2026-02-01', 'Nope'))) $$,
  'P0001', 'Row 1: no budget is called "Nope".', 'unknown budgets are refused');
select throws_ok($$ select public.import_paid_claims(jsonb_build_array(pg_temp.row('i-vol@test.local', 'I x', '2026-02-01', 'I Budget', 'I Venue'))) $$,
  'P0001', 'Row 1: the budget "I Budget" doesn''t provide for the category "I Venue".', 'unprovisioned categories are refused');
select throws_ok($$ select public.import_paid_claims(jsonb_build_array(pg_temp.row('i-vol@test.local', 'I x', '2026-02-01', 'I Budget', 'I Food', 'Nope'))) $$,
  'P0001', 'Row 1: no bank account is called "Nope".', 'unknown accounts are refused');
select throws_ok($$ select public.import_paid_claims(jsonb_build_array(pg_temp.row('i-vol@test.local', 'I early', '2025-12-31'))) $$,
  'P0001', 'Row 1: The date is before I Joint''s opening balance (01 Jan 2026), which already includes it.',
  'payments before the opening balance are refused (they''re already in it)');
select throws_ok($$ select public.import_paid_claims('[]'::jsonb) $$,
  'P0001', 'Import between 1 and 1,000 rows at a time.', 'an empty import is refused');

-- ---------- a good import ----------
select is(public.import_paid_claims(jsonb_build_array(
    pg_temp.row('I-VOL@test.local', 'I imported one', '2026-02-01'),
    pg_temp.row('i-lead@test.local', 'I imported two', '2026-02-02'))), 2, 'imports every row (emails in any case) and says how many');
select is(public.import_paid_claims(jsonb_build_array(pg_temp.row('i-vol@test.local', 'I imported three', '2026-02-03'))), 1,
  'returns the count');
select results_eq(
  $$ select status::text, claimant_name, division_id::text, imported, payment_reference, payout_type is null
     from public.claims where description = 'I imported one' $$,
  $$ values ('paid', 'I Vol', '0a200000-0000-4000-8000-000000000001', true, 'TXN-001', true) $$,
  'each row becomes a paid, imported claim credited to its member, with no payout details');
select results_eq(
  $$ select amount_cents, entry_date::text from public.bank_entries
     where claim_id = pg_temp.claim('I imported one') $$,
  $$ values (-2500::bigint, '2026-02-01') $$, 'its payout comes off the named account, on the paid date');
select is((select balance_cents from public.bank_balances where name = 'I Joint'), 92500::bigint,
  'the expected balance follows');
select is((select paid_cents from public.guideline_totals where budget_id = '0a400000-0000-4000-8000-000000000001'), 7500::bigint,
  'and the spending counts against the guideline');
select results_eq($$ select action, (at at time zone 'Asia/Singapore')::date::text from public.claim_events
     where claim_id = pg_temp.claim('I imported one') order by id $$,
  $$ values ('submitted', '2026-02-01'), ('paid', '2026-02-01') $$, 'its history shows it submitted and paid, on the paid date');
select throws_ok($$ select public.import_paid_claims(jsonb_build_array(pg_temp.row('i-vol@test.local', 'I imported one', '2026-02-01'))) $$,
  'P0001', 'Row 1: this claim has already been imported.', 'importing the same row again is refused, not paid twice');

-- Names must be unambiguous, and the account open.
insert into public.budgets (id, name, division_id) values
  ('0a400000-0000-4000-8000-000000000002', 'i budget', '0a200000-0000-4000-8000-000000000001');
select throws_ok($$ select public.import_paid_claims(jsonb_build_array(pg_temp.row('i-vol@test.local', 'I twin', '2026-02-04'))) $$,
  'P0001', 'Row 1: more than one budget is called "I Budget". Rename one on the Setup page first.', 'an ambiguous budget name is refused');
update public.budgets set name = 'I Other' where id = '0a400000-0000-4000-8000-000000000002';
update public.bank_accounts set active = false where name = 'I Joint';
select throws_ok($$ select public.import_paid_claims(jsonb_build_array(pg_temp.row('i-vol@test.local', 'I closed', '2026-02-04'))) $$,
  'P0001', 'Row 1: That bank account is closed.', 'a closed account is refused');
update public.bank_accounts set active = true where name = 'I Joint';

-- ---------- the member and their lead see it ----------
select pg_temp.login('0a100000-0000-4000-8000-000000000003');
select results_eq($$ select description from public.claims where imported order by description $$,
  $$ values ('I imported one'), ('I imported three') $$, 'the member sees their imported claims');
select pg_temp.login('0a100000-0000-4000-8000-000000000002');
select is((select count(*) from public.claims where imported), 3::bigint, 'the division''s lead sees them all');

-- ---------- receipts afterwards ----------
select throws_ok($$ select public.attach_claim_files(pg_temp.claim('I imported one'), array['0a100000-0000-4000-8000-000000000002/x/r.pdf']) $$,
  '42501', 'Only Finance can do this.', 'leads can''t attach files');
select pg_temp.login('0a100000-0000-4000-8000-000000000001');
select throws_ok($$ select public.attach_claim_files(pg_temp.claim('I imported one'), array['0a100000-0000-4000-8000-000000000003/x/r.pdf']) $$,
  '42501', 'Invalid attachment.', 'Finance attaches only its own uploads');
select throws_ok($$ select public.attach_claim_files(pg_temp.claim('I imported one'), array['0a100000-0000-4000-8000-000000000001/x/missing.pdf']) $$,
  'P0001', 'Upload the file first.', 'and only files that were uploaded');
select lives_ok($$ select public.attach_claim_files(pg_temp.claim('I imported one'), array['0a100000-0000-4000-8000-000000000001/x/r.pdf']) $$,
  'Finance attaches a receipt to an imported claim');
select is((select attachment_paths from public.claims where description = 'I imported one'),
  array['0a100000-0000-4000-8000-000000000001/x/r.pdf'], 'the claim now has the file');
select pg_temp.login('0a100000-0000-4000-8000-000000000003');
select isnt_empty($$ select 1 from storage.objects where name = '0a100000-0000-4000-8000-000000000001/x/r.pdf' $$,
  'the claimant can read the attached file');

-- Ordinary claims still need receipts and payout details, and can't have files added later.
select pg_temp.login('0a100000-0000-4000-8000-000000000003');
select throws_ok($$ insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths, submission_id)
  values ('0a400000-0000-4000-8000-000000000001', '0a300000-0000-4000-8000-000000000001', 'I no payout', 100,
          array['0a100000-0000-4000-8000-000000000003/x/r.pdf'], gen_random_uuid()) $$,
  'P0001', 'Enter your payout details.', 'ordinary claims still need payout details');
select throws_ok($$ insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths,
    payout_type, payout_masked, payout_enc, submission_id)
  values ('0a400000-0000-4000-8000-000000000001', '0a300000-0000-4000-8000-000000000001', 'I no file', 100, '{}',
          'bank', 'DBS •••• 1', 'v1.a.b.c', gen_random_uuid()) $$,
  '23514', null, 'and at least one receipt');
select lives_ok($$ insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths,
    payout_type, payout_masked, payout_enc, submission_id)
  values ('0a400000-0000-4000-8000-000000000001', '0a300000-0000-4000-8000-000000000001', 'I ordinary', 100,
          array['0a100000-0000-4000-8000-000000000003/x/r.pdf'], 'bank', 'DBS •••• 1', 'v1.a.b.c', gen_random_uuid()) $$,
  'an ordinary claim still goes in');
select pg_temp.login('0a100000-0000-4000-8000-000000000001');
select throws_ok($$ select public.attach_claim_files(pg_temp.claim('I ordinary'), array['0a100000-0000-4000-8000-000000000001/x/r.pdf']) $$,
  'P0001', 'Only imported claims can have files added later.', 'only imported claims take files later');

-- The reserve (0006): Finance can import a paid claim against it for anyone. That is how someone
-- outside Finance is reimbursed from it, since they can't submit a claim against it themselves.
select is(public.import_paid_claims(jsonb_build_array(pg_temp.row('i-vol@test.local', 'I vol reserve', '2026-02-01', 'Reserve'))), 1,
  'Finance imports a volunteer''s reimbursement from the reserve');
select results_eq($$ select status::text, division_id from public.claims where description = 'I vol reserve' $$,
  $$ values ('paid', null::uuid) $$, 'it is paid and belongs to no division');
select pg_temp.login('0a100000-0000-4000-8000-000000000003');
select isnt_empty($$ select 1 from public.claims where description = 'I vol reserve' $$, 'the volunteer sees their claim');
select is_empty($$ select 1 from public.budgets where is_reserve $$, 'but still not the reserve itself');

select * from finish();
rollback;
