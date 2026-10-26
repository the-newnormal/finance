-- Funding budgets (0010): grants, loans from the reserve and repayments, written only by Finance;
-- seen by the division's leads and Finance; available = granted + loaned − repaid − approved − disbursed.
-- Claims are never blocked by a short balance. Run: pnpm supabase test db. Rolls back.
begin;
select no_plan();

create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
-- Looked up as the database owner, so a refusal really reaches the function.
create function pg_temp.reserve() returns uuid language sql security definer as $$
  select id from public.budgets where is_reserve
$$;
create function pg_temp.entry(p_note text) returns bigint language sql security definer as $$
  select id from public.bank_entries where note = p_note
$$;
create function pg_temp.claim_id(p_desc text) returns uuid language sql security definer as $$
  select id from public.claims where description = p_desc
$$;
create function pg_temp.sgd(p_cents bigint) returns text language sql security definer as $$
  select private.sgd(p_cents)
$$;
-- Submitted by whoever is logged in.
create function pg_temp.claim(p_budget uuid, p_desc text, p_cents bigint) returns void language sql as $$
  insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc, submission_id)
  values (p_budget, '0c300000-0000-4000-8000-000000000001', p_desc, p_cents,
          array[auth.uid()::text || '/f/r.pdf'], 'bank', 'DBS •••• 1', 'v1.a.b.c', gen_random_uuid())
$$;
create function pg_temp.avail(p_budget uuid) returns bigint language sql as $$
  select available_cents from public.budget_totals where budget_id = p_budget
$$;

-- f: Finance; l: lead of F Division; o: lead of F Other only; v: volunteer.
insert into auth.users (id, email) values
  ('0c100000-0000-4000-8000-000000000001', 'f-fin@test.local'),
  ('0c100000-0000-4000-8000-000000000002', 'f-lead@test.local'),
  ('0c100000-0000-4000-8000-000000000003', 'f-other@test.local'),
  ('0c100000-0000-4000-8000-000000000004', 'f-vol@test.local');
insert into public.members (id, email, name, role) values
  ('0c100000-0000-4000-8000-000000000001', 'f-fin@test.local', 'F Fin', 'finance'),
  ('0c100000-0000-4000-8000-000000000002', 'f-lead@test.local', 'F Lead', 'lead'),
  ('0c100000-0000-4000-8000-000000000003', 'f-other@test.local', 'F Other', 'lead'),
  ('0c100000-0000-4000-8000-000000000004', 'f-vol@test.local', 'F Vol', 'volunteer');
insert into public.divisions (id, name) values
  ('0c200000-0000-4000-8000-000000000001', 'F Division'),
  ('0c200000-0000-4000-8000-000000000002', 'F Other Division');
insert into public.division_leads (member_id, division_id) values
  ('0c100000-0000-4000-8000-000000000002', '0c200000-0000-4000-8000-000000000001'),
  ('0c100000-0000-4000-8000-000000000003', '0c200000-0000-4000-8000-000000000002');
insert into public.categories (id, name, category_group) values ('0c300000-0000-4000-8000-000000000001', 'F Food', 'programme');
insert into public.budgets (id, name, division_id) values
  ('0c400000-0000-4000-8000-000000000001', 'F Budget', '0c200000-0000-4000-8000-000000000001'),
  ('0c400000-0000-4000-8000-000000000002', 'F Budget 2', '0c200000-0000-4000-8000-000000000001');
insert into public.budget_categories (budget_id, category_id) values
  ('0c400000-0000-4000-8000-000000000001', '0c300000-0000-4000-8000-000000000001'),
  ('0c400000-0000-4000-8000-000000000002', '0c300000-0000-4000-8000-000000000001');
insert into public.budget_guidelines (budget_id, category_id, guideline_cents) values
  ('0c400000-0000-4000-8000-000000000001', '0c300000-0000-4000-8000-000000000001', 10000),
  ('0c400000-0000-4000-8000-000000000002', '0c300000-0000-4000-8000-000000000001', 10000);
insert into public.bank_accounts (id, name, last4) values ('0c500000-0000-4000-8000-000000000001', 'F Joint', '1111');
insert into public.bank_entries (account_id, kind, amount_cents, entry_date, note, actor_name) values
  ('0c500000-0000-4000-8000-000000000001', 'opening', 100000, '2026-01-01', 'Opening balance', 'F Fin');
insert into storage.objects (bucket_id, name) values
  ('receipts', '0c100000-0000-4000-8000-000000000001/f/r.pdf'),
  ('receipts', '0c100000-0000-4000-8000-000000000004/f/r.pdf');

-- ---------- only Finance writes ----------
select pg_temp.login('0c100000-0000-4000-8000-000000000002');
select throws_ok($$ select public.set_grant_commitment('0c400000-0000-4000-8000-000000000001', 100) $$,
  '42501', 'Only Finance can do this.', 'leads can''t set a grant commitment');
select throws_ok($$ select public.record_grant('0c400000-0000-4000-8000-000000000001', '0c500000-0000-4000-8000-000000000001', 100, null, 'F try') $$,
  '42501', 'Only Finance can do this.', 'nor record a grant');
select throws_ok($$ select public.loan_from_reserve('0c400000-0000-4000-8000-000000000001', 100, null, 'F try') $$,
  '42501', 'Only Finance can do this.', 'nor borrow from the reserve');
select throws_ok($$ select public.repay_reserve('0c400000-0000-4000-8000-000000000001', 100, null, 'F try') $$,
  '42501', 'Only Finance can do this.', 'nor repay it');
select pg_temp.login('0c100000-0000-4000-8000-000000000004');
select throws_ok($$ select public.record_grant('0c400000-0000-4000-8000-000000000001', '0c500000-0000-4000-8000-000000000001', 100, null, 'F try') $$,
  '42501', 'Only Finance can do this.', 'volunteers can''t record a grant');
select throws_ok($$ select public.loan_from_reserve('0c400000-0000-4000-8000-000000000001', 100, null, 'F try') $$,
  '42501', 'Only Finance can do this.', 'nor borrow from the reserve');

-- ---------- the reserve isn't funded this way; its additions are money in only ----------
select pg_temp.login('0c100000-0000-4000-8000-000000000001');
select throws_ok($$ select public.set_grant_commitment(pg_temp.reserve(), 100) $$,
  'P0001', 'The reserve is funded by additions on the Reserve page.', 'the reserve has no grant commitment');
select throws_ok($$ select public.record_grant(pg_temp.reserve(), '0c500000-0000-4000-8000-000000000001', 100, null, 'F try') $$,
  'P0001', 'The reserve is funded by additions on the Reserve page.', 'nor grants');
select throws_ok($$ select public.loan_from_reserve(pg_temp.reserve(), 100, null, 'F try') $$,
  'P0001', 'The reserve is funded by additions on the Reserve page.', 'nor lends to itself');
select throws_ok($$ select public.repay_reserve(pg_temp.reserve(), 100, null, 'F try') $$,
  'P0001', 'The reserve is funded by additions on the Reserve page.', 'nor repays itself');
select throws_ok($$ select public.add_to_reserve(0, null, 'F nothing') $$, 'P0001',
  'Enter a valid amount. Money leaves the reserve only through a claim or a loan.', 'an addition can''t be zero');
select throws_ok($$ select public.add_to_reserve(-500, null, 'F correction') $$, 'P0001',
  'Enter a valid amount. Money leaves the reserve only through a claim or a loan.', 'nor negative');

-- ---------- grant commitment and grants ----------
select throws_ok($$ select public.set_grant_commitment('0c400000-0000-4000-8000-000000000001', -1) $$,
  'P0001', 'Enter a valid amount.', 'a commitment can''t be negative');
select lives_ok($$ select public.set_grant_commitment('0c400000-0000-4000-8000-000000000001', 500000) $$,
  'Finance sets the grant committed to a budget');
select throws_ok($$ select public.record_grant('0c400000-0000-4000-8000-000000000001', '0c500000-0000-4000-8000-000000000001', 0, null, 'F zero') $$,
  'P0001', 'Enter a valid amount.', 'a grant needs an amount');
select lives_ok($$ select public.record_grant('0c400000-0000-4000-8000-000000000001', '0c500000-0000-4000-8000-000000000001', 30000, null, 'F tranche 1') $$,
  'Finance records a grant');
select results_eq($$ select account_id, kind::text, amount_cents from public.bank_entries where note = 'Grant for F Budget · F tranche 1' $$,
  $$ values ('0c500000-0000-4000-8000-000000000001'::uuid, 'grant', 30000::bigint) $$, 'it is a grant entry on the account');
select results_eq($$ select kind::text, amount_cents, bank_entry_id from public.budget_funds where budget_id = '0c400000-0000-4000-8000-000000000001' $$,
  $$ values ('grant', 30000::bigint, pg_temp.entry('Grant for F Budget · F tranche 1')) $$, 'and a grant on the budget, linked to it');
select results_eq($$ select grant_committed_cents, granted_cents, available_cents from public.budget_totals
  where budget_id = '0c400000-0000-4000-8000-000000000001' $$,
  $$ values (500000::bigint, 30000::bigint, 30000::bigint) $$, 'the budget''s totals follow');

select lives_ok($$ select public.edit_bank_entry(pg_temp.entry('Grant for F Budget · F tranche 1'), null, 35000, null, null, null, 'F typo') $$,
  'Finance corrects the grant''s bank entry');
select is((select amount_cents from public.budget_funds where budget_id = '0c400000-0000-4000-8000-000000000001' and kind = 'grant'),
  35000::bigint, 'and the grant on the budget is corrected with it');
select is(pg_temp.avail('0c400000-0000-4000-8000-000000000001'), 35000::bigint, 'so is its available balance');

-- ---------- loans from the reserve ----------
select lives_ok($$ select public.add_to_reserve(20000, null, 'F top up') $$, 'Finance adds to the reserve');
select set_config('f.base', (select available_cents from public.budget_totals where is_reserve)::text, false);
select set_config('f.lent', (select lent_out_cents from public.budget_totals where is_reserve)::text, false);
select throws_ok(format($$ select public.loan_from_reserve('0c400000-0000-4000-8000-000000000001', %s, null, 'F too much') $$,
    current_setting('f.base')::bigint + 1),
  'P0001', format('The reserve has only %s available to lend.', pg_temp.sgd(greatest(current_setting('f.base')::bigint, 0))),
  'a loan beyond the reserve''s available funds is refused');
select lives_ok($$ select public.loan_from_reserve('0c400000-0000-4000-8000-000000000001', 10000, null, 'F bridge') $$,
  'the reserve lends a budget money');
select results_eq($$ select available_cents, lent_out_cents from public.budget_totals where is_reserve $$,
  format($$ values (%s::bigint, %s::bigint) $$, current_setting('f.base')::bigint - 10000, current_setting('f.lent')::bigint + 10000),
  'the reserve''s available funds fall and its loans out rise');
select results_eq($$ select loaned_cents, available_cents from public.budget_totals where budget_id = '0c400000-0000-4000-8000-000000000001' $$,
  $$ values (10000::bigint, 45000::bigint) $$, 'the budget can spend the loan');

-- ---------- approved and disbursed claims count against the balance ----------
select pg_temp.claim('0c400000-0000-4000-8000-000000000001', 'F approved', 4000);
select lives_ok($$ select public.decide_claim(pg_temp.claim_id('F approved'), true) $$, 'Finance approves a claim');
select is(pg_temp.avail('0c400000-0000-4000-8000-000000000001'), 41000::bigint, 'an approved claim counts against it');
select pg_temp.claim('0c400000-0000-4000-8000-000000000001', 'F paid', 2000);
select public.decide_claim(pg_temp.claim_id('F paid'), true);
select lives_ok($$ select public.mark_paid(pg_temp.claim_id('F paid'), 'F-TXN-1', '0c500000-0000-4000-8000-000000000001') $$,
  'Finance pays a claim');
select is(pg_temp.avail('0c400000-0000-4000-8000-000000000001'), 39000::bigint, 'a disbursed claim counts against it');

-- ---------- repayments ----------
select throws_ok($$ select public.repay_reserve('0c400000-0000-4000-8000-000000000002', 100, null, 'F repay') $$,
  'P0001', 'This budget owes the reserve nothing.', 'a budget that owes nothing can''t repay');
select throws_ok($$ select public.repay_reserve('0c400000-0000-4000-8000-000000000001', 10001, null, 'F repay') $$,
  'P0001', 'This budget owes the reserve only $100.00.', 'nor repay more than it owes');
select lives_ok($$ select public.repay_reserve('0c400000-0000-4000-8000-000000000001', 5000, null, 'F repay half') $$,
  'a budget repays part of its loan');
select results_eq($$ select granted_cents, loaned_cents, repaid_cents, approved_cents, paid_cents, available_cents
  from public.budget_totals where budget_id = '0c400000-0000-4000-8000-000000000001' $$,
  $$ values (35000::bigint, 10000::bigint, 5000::bigint, 4000::bigint, 2000::bigint, 34000::bigint) $$,
  'available = granted + loaned - repaid - approved - disbursed');
select results_eq($$ select available_cents, lent_out_cents from public.budget_totals where is_reserve $$,
  format($$ values (%s::bigint, %s::bigint) $$, current_setting('f.base')::bigint - 5000, current_setting('f.lent')::bigint + 5000),
  'the repayment returns to the reserve');

select public.loan_from_reserve('0c400000-0000-4000-8000-000000000002', 5000, null, 'F bridge 2');
select pg_temp.claim('0c400000-0000-4000-8000-000000000002', 'F spend 2', 3000);
select public.decide_claim(pg_temp.claim_id('F spend 2'), true);
select throws_ok($$ select public.repay_reserve('0c400000-0000-4000-8000-000000000002', 3000, null, 'F repay') $$,
  'P0001', 'This budget has only $20.00 available to repay with.', 'nor repay more than it has available');

-- ---------- a short balance warns, never blocks ----------
select pg_temp.login('0c100000-0000-4000-8000-000000000004');
select lives_ok($$ select pg_temp.claim('0c400000-0000-4000-8000-000000000002', 'F vol big', 100000) $$,
  'a volunteer claims more than the budget has available');
select pg_temp.login('0c100000-0000-4000-8000-000000000001');
select lives_ok($$ select pg_temp.claim('0c400000-0000-4000-8000-000000000002', 'F fin big', 50000) $$,
  'so does Finance');
select lives_ok($$ select public.decide_claim(pg_temp.claim_id('F fin big'), true) $$, 'and Finance can approve it');
select is(pg_temp.avail('0c400000-0000-4000-8000-000000000002'), -48000::bigint, 'the balance goes negative');
select throws_ok($$ select public.repay_reserve('0c400000-0000-4000-8000-000000000002', 1, null, 'F repay') $$,
  'P0001', 'This budget has only $0.00 available to repay with.', 'and it can''t repay from a negative balance');

-- ---------- who sees the funding ----------
select pg_temp.login('0c100000-0000-4000-8000-000000000002');
select is((select count(*) from public.budget_funds where budget_id = '0c400000-0000-4000-8000-000000000001'), 3::bigint,
  'the division''s lead sees its budget''s grants, loans and repayments');
select results_eq($$ select grant_committed_cents, granted_cents, loaned_cents, repaid_cents, available_cents
  from public.budget_totals where budget_id = '0c400000-0000-4000-8000-000000000001' $$,
  $$ values (500000::bigint, 35000::bigint, 10000::bigint, 5000::bigint, 34000::bigint) $$, 'and its funding totals');
select is_empty($$ select 1 from public.budget_totals where is_reserve $$, 'but not the reserve''s');
select pg_temp.login('0c100000-0000-4000-8000-000000000003');
select is_empty($$ select 1 from public.budget_funds where budget_id in ('0c400000-0000-4000-8000-000000000001', '0c400000-0000-4000-8000-000000000002') $$,
  'another division''s lead doesn''t see them');
select is_empty($$ select 1 from public.budget_totals where budget_id = '0c400000-0000-4000-8000-000000000001' $$,
  'nor the budget''s totals');
select pg_temp.login('0c100000-0000-4000-8000-000000000004');
select is_empty($$ select 1 from public.budget_funds $$, 'volunteers see no funding');
select is_empty($$ select 1 from public.budget_totals where budget_id = '0c400000-0000-4000-8000-000000000001' $$,
  'nor any totals');
select throws_ok($$ insert into public.budget_funds (budget_id, kind, amount_cents, entry_date, note, actor_name)
  values ('0c400000-0000-4000-8000-000000000001', 'loan', 100, current_date, 'F sneak', 'F Vol') $$,
  '42501', null, 'nobody writes budget_funds directly');

-- ---------- review fixes: commitments, assigned grants, reversals, closed budgets ----------
select pg_temp.login('0c100000-0000-4000-8000-000000000004');
select is_empty($$ select 1 from public.budget_commitments $$, 'volunteers can''t read grant commitments');
select pg_temp.login('0c100000-0000-4000-8000-000000000002');
select isnt_empty($$ select 1 from public.budget_commitments where budget_id = '0c400000-0000-4000-8000-000000000001' $$,
  'the division''s lead reads its commitment');

select pg_temp.login('0c100000-0000-4000-8000-000000000001');
-- A grant recorded on the Bank page, then assigned to a budget whole.
select lives_ok($$ select public.record_bank_entry('0c500000-0000-4000-8000-000000000001', 'grant', 7000, null, 'F bank-page grant') $$,
  'a grant is recorded on the Bank page');
select lives_ok($$ select public.assign_grant(pg_temp.entry('F bank-page grant'), '0c400000-0000-4000-8000-000000000002', 'F tranche on bank page') $$,
  'and assigned to a budget');
select is((select granted_cents from public.budget_totals where budget_id = '0c400000-0000-4000-8000-000000000002'), 7000::bigint,
  'the budget gets the whole grant');
select throws_ok($$ select public.assign_grant(pg_temp.entry('F bank-page grant'), '0c400000-0000-4000-8000-000000000001', 'F twice') $$,
  'P0001', 'That grant is already assigned to a budget.', 'a grant is assigned only once');

-- An addition entered by mistake is reversed, once, with a reason.
select lives_ok($$ select public.add_to_reserve(1234, null, 'F typo addition') $$, 'Finance adds to the reserve');
select throws_ok($$ select public.reverse_reserve_addition((select id from public.reserve_additions where note = 'F typo addition'), 'x') $$,
  'P0001', 'Say why it''s being reversed.', 'a reversal needs a reason');
select lives_ok($$ select public.reverse_reserve_addition((select id from public.reserve_additions where note = 'F typo addition'), 'Entered by mistake') $$,
  'and reverses a mistaken addition');
select is((select amount_cents from public.reserve_additions where note = 'Reversal: Entered by mistake'), -1234::bigint,
  'the reversal is the opposite amount');
select throws_ok($$ select public.reverse_reserve_addition((select id from public.reserve_additions where note = 'F typo addition'), 'Again') $$,
  'P0001', 'This addition has already been reversed.', 'an addition is reversed only once');

-- No loans to a closed budget.
update public.budgets set active = false where id = '0c400000-0000-4000-8000-000000000002';
select throws_ok($$ select public.loan_from_reserve('0c400000-0000-4000-8000-000000000002', 100, null, 'F closed loan') $$,
  'P0001', 'That budget is closed. Reopen it on the Setup page to lend to it.', 'closed budgets get no loans');

select * from finish();
rollback;
