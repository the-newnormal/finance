-- Editing ledger entries (0009): Finance only, always with a reason, every edit logged; a payout's
-- edit corrects its claim (amount, reference, paid date) and the claim's history, which never names
-- the account; a transfer's two sides move together; opening balances and transfers stay on their
-- accounts; closed accounts are refused. Run: pnpm supabase test db.
begin;
select no_plan();

create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
-- Looked up as the database owner, so a refusal really reaches the function.
create function pg_temp.entry(p_note text) returns bigint language sql security definer as $$
  select id from public.bank_entries where note = p_note
$$;
create function pg_temp.claim(p_description text) returns uuid language sql security definer as $$
  select id from public.claims where description = p_description
$$;
create function pg_temp.payout(p_description text) returns bigint language sql security definer as $$
  select e.id from public.bank_entries e join public.claims c on c.id = e.claim_id where c.description = p_description
$$;

-- f: Finance; l: lead of the division; v: volunteer. Accounts: E Joint (opened 1 Jan 2026),
-- E Second (opened 1 Mar 2026).
insert into auth.users (id, email) values
  ('0f100000-0000-4000-8000-000000000001', 'e-fin@test.local'),
  ('0f100000-0000-4000-8000-000000000002', 'e-lead@test.local'),
  ('0f100000-0000-4000-8000-000000000003', 'e-vol@test.local');
insert into public.members (id, email, name, role) values
  ('0f100000-0000-4000-8000-000000000001', 'e-fin@test.local', 'E Fin', 'finance'),
  ('0f100000-0000-4000-8000-000000000002', 'e-lead@test.local', 'E Lead', 'lead'),
  ('0f100000-0000-4000-8000-000000000003', 'e-vol@test.local', 'E Vol', 'volunteer');
insert into public.divisions (id, name) values ('0f200000-0000-4000-8000-000000000001', 'E Division');
insert into public.division_leads (member_id, division_id) values
  ('0f100000-0000-4000-8000-000000000002', '0f200000-0000-4000-8000-000000000001');
insert into public.categories (id, name) values ('0f300000-0000-4000-8000-000000000001', 'E Food');
insert into public.budgets (id, name, division_id) values
  ('0f400000-0000-4000-8000-000000000001', 'E Budget', '0f200000-0000-4000-8000-000000000001');
insert into public.budget_categories (budget_id, category_id) values
  ('0f400000-0000-4000-8000-000000000001', '0f300000-0000-4000-8000-000000000001');
insert into public.budget_guidelines (budget_id, category_id, guideline_cents) values
  ('0f400000-0000-4000-8000-000000000001', '0f300000-0000-4000-8000-000000000001', 10000);
insert into public.bank_accounts (id, name, last4) values
  ('0f500000-0000-4000-8000-000000000001', 'E Joint', '1111'),
  ('0f500000-0000-4000-8000-000000000002', 'E Second', '2222');
insert into public.bank_entries (account_id, kind, amount_cents, entry_date, note, actor_name) values
  ('0f500000-0000-4000-8000-000000000001', 'opening', 100000, '2026-01-01', 'Opening balance', 'E Fin'),
  ('0f500000-0000-4000-8000-000000000002', 'opening', 50000, '2026-03-01', 'Opening balance', 'E Fin');
insert into storage.objects (bucket_id, name) values ('receipts', '0f100000-0000-4000-8000-000000000003/t/r.jpg');

select pg_temp.login('0f100000-0000-4000-8000-000000000001');
select public.record_bank_entry('0f500000-0000-4000-8000-000000000001', 'grant', 20000, '2026-02-01', 'E grant');
select public.record_bank_entry('0f500000-0000-4000-8000-000000000001', 'adjustment', -500, '2026-02-02', 'E fee');
select public.transfer_between_accounts('0f500000-0000-4000-8000-000000000001', '0f500000-0000-4000-8000-000000000002',
  10000, '2026-04-01', 'E move');
select public.import_paid_claims(jsonb_build_array(jsonb_build_object('email', 'e-vol@test.local', 'budget', 'E Budget',
  'category', 'E Food', 'description', 'E imported', 'amount_cents', 2500, 'expense_date', '2026-02-05',
  'paid_on', '2026-02-10', 'reference', 'TXN-001', 'account', 'E Joint')));

-- ---------- only Finance, and always with a reason ----------
select pg_temp.login('0f100000-0000-4000-8000-000000000002');
select throws_ok($$ select public.edit_bank_entry(pg_temp.entry('E grant'), null, 30000, null, null, null, 'E typo') $$,
  '42501', 'Only Finance can do this.', 'leads can''t edit the ledger');
select pg_temp.login('0f100000-0000-4000-8000-000000000001');
select throws_ok($$ select public.edit_bank_entry(pg_temp.entry('E grant'), null, 30000, null, null, null, ' ') $$,
  'P0001', 'Say why you''re changing it.', 'an edit needs a reason');
select throws_ok($$ select public.edit_bank_entry(-1, null, 30000, null, null, null, 'E typo') $$,
  'P0002', 'Entry not found.', 'an unknown entry is refused');
select throws_ok($$ select public.edit_bank_entry(pg_temp.entry('E grant'), null, 20000, '2026-02-01', 'E grant', null, 'E typo') $$,
  'P0001', 'Nothing has changed.', 'an edit that changes nothing is refused');

-- ---------- a grant: amount, date and note, logged ----------
select lives_ok($$ select public.edit_bank_entry(pg_temp.entry('E grant'), null, 30000, '2026-02-03', 'E grant (tranche 1)', null, 'E typo in amount') $$,
  'Finance corrects a grant''s amount, date and note');
select results_eq($$ select amount_cents, entry_date::text from public.bank_entries where note = 'E grant (tranche 1)' $$,
  $$ values (30000::bigint, '2026-02-03') $$, 'the entry changes');
select is((select balance_cents from public.bank_balances where name = 'E Joint'), 117000::bigint,
  'and the expected balance follows (1,000 + 300 - 5 - 100 - 25 dollars)');
select results_eq(
  $$ select actor_name, reason, (before ->> 'amount_cents')::bigint, (after ->> 'amount_cents')::bigint,
            before ->> 'entry_date', after ->> 'note'
     from public.bank_entry_edits where entry_id = pg_temp.entry('E grant (tranche 1)') $$,
  $$ values ('E Fin', 'E typo in amount', 20000::bigint, 30000::bigint, '2026-02-01', 'E grant (tranche 1)') $$,
  'the edit is logged: who, why, before and after');
select throws_ok($$ select public.edit_bank_entry(pg_temp.entry('E grant (tranche 1)'), null, -30000, null, null, null, 'E typo') $$,
  'P0001', 'Enter a valid amount.', 'a grant stays money in');
select throws_ok($$ select public.edit_bank_entry(pg_temp.entry('E grant (tranche 1)'), null, null, null, 'E', null, 'E typo') $$,
  'P0001', 'Add a note saying what this is.', 'a grant keeps a note');
select throws_ok($$ select public.edit_bank_entry(pg_temp.entry('E grant (tranche 1)'), null, null, current_date + 40, null, null, 'E typo') $$,
  'P0001', 'The date can''t be in the future.', 'and isn''t dated in the future');

-- ---------- an adjustment can change direction, never to zero ----------
select lives_ok($$ select public.edit_bank_entry(pg_temp.entry('E fee'), null, 700, null, null, null, 'E it was interest') $$,
  'an adjustment changes direction');
select throws_ok($$ select public.edit_bank_entry(pg_temp.entry('E fee'), null, 0, null, null, null, 'E typo') $$,
  'P0001', 'Enter a valid amount.', 'but never to zero');

-- ---------- moving an entry to another account ----------
select throws_ok($$ select public.edit_bank_entry(pg_temp.entry('E grant (tranche 1)'), '0f500000-0000-4000-8000-000000000002', null, null, null, null, 'E wrong account') $$,
  'P0001', 'The date is before E Second''s opening balance (01 Mar 2026), which already includes it.',
  'an entry moved to another account is still dated after that account''s opening balance');
select lives_ok($$ select public.edit_bank_entry(pg_temp.entry('E grant (tranche 1)'), '0f500000-0000-4000-8000-000000000002', null, '2026-03-05', null, null, 'E wrong account') $$,
  'Finance moves a grant to the account it really went to');
select results_eq($$ select name, balance_cents from public.bank_balances where name like 'E %' order by name $$,
  $$ values ('E Joint', 88200::bigint), ('E Second', 90000::bigint) $$, 'both balances follow');

-- ---------- a transfer: both sides together, on their accounts ----------
select lives_ok($$ select public.edit_bank_entry(e.id, null, -15000, '2026-04-02', null, null, 'E it was 150')
     from public.bank_entries e where e.note = 'E move' and e.kind = 'transfer_out' $$,
  'Finance corrects a transfer''s amount and date');
select results_eq($$ select kind::text, amount_cents, entry_date::text, note from public.bank_entries
     where note = 'E move' order by kind $$,
  $$ values ('transfer_in', 15000::bigint, '2026-04-02', 'E move'), ('transfer_out', -15000::bigint, '2026-04-02', 'E move') $$,
  'editing one side of a transfer edits the other with it');
select is((select count(*) from public.bank_entry_edits where reason = 'E it was 150'), 2::bigint, 'both sides'' edits are logged');
-- Each side keeps its own note unless the note changes (the form always sends the current one).
select public.transfer_between_accounts('0f500000-0000-4000-8000-000000000001', '0f500000-0000-4000-8000-000000000002',
  2000, '2026-04-03', null);
select lives_ok($$ select public.edit_bank_entry(e.id, null, -2500, null, 'Transfer to E Second', null, 'E it was 25')
     from public.bank_entries e where e.note = 'Transfer to E Second' $$, 'a transfer''s amount changes, its note sent unchanged');
select results_eq($$ select kind::text, amount_cents, note from public.bank_entries where entry_date = '2026-04-03' order by kind $$,
  $$ values ('transfer_in', 2500::bigint, 'Transfer from E Joint'), ('transfer_out', -2500::bigint, 'Transfer to E Second') $$,
  'and each side keeps its own note');
select lives_ok($$ select public.edit_bank_entry(e.id, null, null, null, 'E top-up', null, 'E name it')
     from public.bank_entries e where e.note = 'Transfer from E Joint' $$, 'a typed note');
select results_eq($$ select note from public.bank_entries where entry_date = '2026-04-03' order by kind $$,
  $$ values ('E top-up'), ('E top-up') $$, 'goes on both sides');
select lives_ok($$ select public.edit_bank_entry(e.id, null, null, null, '', null, 'E unname it')
     from public.bank_entries e where e.note = 'E top-up' and e.kind = 'transfer_out' $$, 'a cleared note');
select results_eq($$ select note from public.bank_entries where entry_date = '2026-04-03' order by kind $$,
  $$ values ('Transfer from E Joint'), ('Transfer to E Second') $$, 'gives each side its default again');
select throws_ok($$ select public.edit_bank_entry(e.id, '0f500000-0000-4000-8000-000000000002', null, null, null, null, 'E typo')
     from public.bank_entries e where e.note = 'E move' and e.kind = 'transfer_out' $$,
  'P0001', 'An opening balance or a transfer stays on its account.', 'a transfer stays on its accounts');

-- ---------- an opening balance ----------
select lives_ok($$ select public.edit_bank_entry(e.id, null, 120000, null, null, null, 'E opening typo')
     from public.bank_entries e where e.kind = 'opening' and e.account_id = '0f500000-0000-4000-8000-000000000001' $$,
  'Finance corrects an opening balance');
select throws_ok($$ select public.edit_bank_entry(e.id, null, null, '2026-02-15', null, null, 'E typo')
     from public.bank_entries e where e.kind = 'opening' and e.account_id = '0f500000-0000-4000-8000-000000000001' $$,
  'P0001', 'The opening balance must be dated on or before the account''s first entry.',
  'but not to after the account''s first entry');

-- ---------- a payout corrects its claim ----------
select lives_ok($$ select public.edit_bank_entry(pg_temp.payout('E imported'), null, -3000, '2026-02-12', null, 'TXN-002', 'E paid 30 not 25') $$,
  'Finance corrects a payout''s amount, date and reference');
select results_eq($$ select amount_cents, payment_reference, (created_at at time zone 'Asia/Singapore')::date::text
     from public.claims where description = 'E imported' $$,
  $$ values (3000::bigint, 'TXN-002', '2026-02-12') $$,
  'the claim''s amount and reference follow (and an imported claim stays dated the day it was paid)');
select results_eq($$ select amount_cents, entry_date::text, note from public.bank_entries where id = pg_temp.payout('E imported') $$,
  $$ values (-3000::bigint, '2026-02-12', 'E Vol · TXN-002 (imported)') $$, 'the payout''s note names the new reference');
select is((select paid_cents from public.guideline_totals where budget_id = '0f400000-0000-4000-8000-000000000001'), 3000::bigint,
  'the budget''s spending follows');
select results_eq($$ select action, (at at time zone 'Asia/Singapore')::date::text from public.claim_events
     where claim_id = pg_temp.claim('E imported') and action in ('submitted', 'paid') order by id $$,
  $$ values ('submitted', '2026-02-12'), ('paid', '2026-02-12') $$, 'its history (and the export''s paid date) moves to the new date');
select is((select note from public.claim_events where claim_id = pg_temp.claim('E imported') and action = 'edited'),
  'Amount corrected from $25.00 to $30.00; Paid date corrected from 10 Feb 2026 to 12 Feb 2026; Reference corrected to TXN-002',
  'and says what was corrected');
select throws_ok($$ select public.edit_bank_entry(pg_temp.payout('E imported'), null, 3000, null, null, null, 'E typo') $$,
  'P0001', 'Enter a valid amount.', 'a payout stays money out');
select throws_ok($$ select public.edit_bank_entry(pg_temp.payout('E imported'), null, -100000001, null, null, null, 'E typo') $$,
  'P0001', 'A single claim can be at most $1,000,000.', 'and within a claim''s limit');
select throws_ok($$ select public.edit_bank_entry(pg_temp.payout('E imported'), null, null, '2026-02-01', null, null, 'E typo') $$,
  'P0001', 'The payment date is before the purchase date (05 Feb 2026).', 'and isn''t paid before it was bought');
select lives_ok($$ select public.edit_bank_entry(pg_temp.payout('E imported'), '0f500000-0000-4000-8000-000000000002', null, '2026-03-05', null, null, 'E paid from Second') $$,
  'a payout moves to the account that really paid it');
select is((select note from public.claim_events where claim_id = pg_temp.claim('E imported') and action = 'edited' order by id desc limit 1),
  'Paid date corrected from 12 Feb 2026 to 05 Mar 2026', 'the claim''s history never names the account');

-- An ordinary claim can't be paid before it was submitted.
select pg_temp.login('0f100000-0000-4000-8000-000000000003');
insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths, payout_type, payout_masked, payout_enc, submission_id)
values ('0f400000-0000-4000-8000-000000000001', '0f300000-0000-4000-8000-000000000001', 'E normal', 4000,
        array['0f100000-0000-4000-8000-000000000003/t/r.jpg'], 'paynow_mobile', 'Mobile •••• 4567', 'v1.a.b.c', gen_random_uuid());
select pg_temp.login('0f100000-0000-4000-8000-000000000002');
select public.decide_claim(pg_temp.claim('E normal'), true);
select pg_temp.login('0f100000-0000-4000-8000-000000000001');
select public.decide_claim(pg_temp.claim('E normal'), true);
select public.mark_paid(pg_temp.claim('E normal'), 'TXN-100', '0f500000-0000-4000-8000-000000000001');
select throws_like($$ select public.edit_bank_entry(pg_temp.payout('E normal'), null, null, '2026-05-01', null, null, 'E typo') $$,
  'The payment date is before the claim was submitted (%).', 'an ordinary claim isn''t paid before it was submitted');
select lives_ok($$ select public.edit_bank_entry(pg_temp.payout('E normal'), null, -4500, null, null, null, 'E paid 45') $$,
  'Finance corrects an ordinary claim''s payout');
select is((select amount_cents from public.claims where description = 'E normal'), 4500::bigint, 'and its claim follows');

-- ---------- closed accounts ----------
update public.bank_accounts set active = false where name = 'E Second';
select throws_ok($$ select public.edit_bank_entry(pg_temp.entry('E grant (tranche 1)'), null, 25000, null, null, null, 'E typo') $$,
  'P0001', 'That bank account is closed.', 'entries on a closed account are refused');
select throws_ok($$ select public.edit_bank_entry(pg_temp.entry('E fee'), '0f500000-0000-4000-8000-000000000002', null, '2026-03-05', null, null, 'E typo') $$,
  'P0001', 'That bank account is closed.', 'and nothing moves to one');
update public.bank_accounts set active = true where name = 'E Second';

-- ---------- nobody writes the log or the ledger directly ----------
select throws_ok($$ insert into public.bank_entry_edits (entry_id, actor_name, reason, before, after)
     values (pg_temp.entry('E fee'), 'E Fin', 'E forged', '{}', '{}') $$,
  '42501', null, 'nobody writes the edit log directly');
select throws_ok($$ update public.bank_entry_edits set reason = 'E rewritten' $$, '42501', null, 'nor rewrites it');
select throws_ok($$ update public.bank_entries set amount_cents = 1 where note = 'E fee' $$, '42501', null,
  'entries change only through edit_bank_entry');

-- ---------- who sees what ----------
select pg_temp.login('0f100000-0000-4000-8000-000000000003');
select is((select note from public.claim_events where claim_id = pg_temp.claim('E imported') and action = 'edited' order by id limit 1),
  'Amount corrected from $25.00 to $30.00; Paid date corrected from 10 Feb 2026 to 12 Feb 2026; Reference corrected to TXN-002',
  'the claimant sees what was corrected on their claim');
select is_empty($$ select 1 from public.bank_entry_edits $$, 'but not the ledger''s edits');
select pg_temp.login('0f100000-0000-4000-8000-000000000002');
select is_empty($$ select 1 from public.bank_entry_edits $$, 'nor does a lead');

select * from finish();
rollback;
