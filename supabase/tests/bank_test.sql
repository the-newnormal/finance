-- Bank accounts and their ledger (0002): only Finance and admins see or change anything, every write
-- goes through a function that checks the caller, and the balance is the sum of the ledger.
-- Run: pnpm supabase test db. Rolls back.
begin;
select no_plan();

create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.acct(p_name text) returns uuid language sql as $$
  select id from public.bank_accounts where name = p_name
$$;
create function pg_temp.balance(p_name text) returns bigint language sql as $$
  select balance_cents from public.bank_balances where name = p_name
$$;

-- fin: core + Finance flag; adm: admin, no flag; core: core member; vol: volunteer
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000b0f01', 'bank-fin@test.local'),
  ('00000000-0000-4000-8000-0000000b0a01', 'bank-adm@test.local'),
  ('00000000-0000-4000-8000-0000000b0c01', 'bank-core@test.local'),
  ('00000000-0000-4000-8000-0000000b0b01', 'bank-vol@test.local');
insert into public.members (id, email, name, role, finance) values
  ('00000000-0000-4000-8000-0000000b0f01', 'bank-fin@test.local', 'Bank Fin', 'core', true),
  ('00000000-0000-4000-8000-0000000b0a01', 'bank-adm@test.local', 'Bank Adm', 'admin', false),
  ('00000000-0000-4000-8000-0000000b0c01', 'bank-core@test.local', 'Bank Core', 'core', false),
  ('00000000-0000-4000-8000-0000000b0b01', 'bank-vol@test.local', 'Bank Vol', 'volunteer', false);

insert into public.divisions (id, name) values ('10000000-0000-4000-8000-0000000b0d01', 'Bank Division');
insert into public.division_members values ('00000000-0000-4000-8000-0000000b0c01', '10000000-0000-4000-8000-0000000b0d01');
insert into public.pools (id, name, division_id) values ('20000000-0000-4000-8000-0000000b0e01', 'Bank Pool', '10000000-0000-4000-8000-0000000b0d01');
insert into public.categories (id, name) values ('30000000-0000-4000-8000-0000000b0001', 'Bank Category');
insert into storage.objects (bucket_id, name) values ('receipts', '00000000-0000-4000-8000-0000000b0b01/x/r.jpg');

-- ---------- Finance sets up the accounts ----------
select pg_temp.login('00000000-0000-4000-8000-0000000b0f01');
select lives_ok($$ select public.add_bank_account('Bank Joint A', 'DBS', '1111', 500000, '2026-10-01') $$, 'Finance adds an account with its opening balance');
select lives_ok($$ select public.add_bank_account('Bank Joint B', null, '2222', 0, null) $$, 'a second account, opening at zero');
select is(pg_temp.balance('Bank Joint A'), 500000::bigint, 'the balance starts at the opening balance');
select throws_ok($$ select public.add_bank_account('Bank Joint C', 'DBS', '12345678', 0, null) $$, '23514', null, 'only the last four digits are stored');

select lives_ok($$ select public.record_bank_entry(pg_temp.acct('Bank Joint A'), 'grant', 200000, '2026-10-10', 'NAC grant tranche 2') $$, 'Finance records a grant');
select throws_ok($$ select public.record_bank_entry(pg_temp.acct('Bank Joint A'), 'grant', -5, null, 'oops') $$, 'P0001', 'Enter a valid amount.', 'grants are money in');
select throws_ok($$ select public.record_bank_entry(pg_temp.acct('Bank Joint A'), 'adjustment', -150, null, '') $$, 'P0001', 'Add a note saying what this is.', 'adjustments need a reason');
select lives_ok($$ select public.record_bank_entry(pg_temp.acct('Bank Joint A'), 'adjustment', -150, null, 'DBS service fee') $$, 'Finance records an adjustment');
select throws_ok($$ select public.record_bank_entry(pg_temp.acct('Bank Joint A'), 'payout', -100, null, 'sneaky') $$, 'P0001', null, 'payouts only come from paying a claim');
select throws_ok($$ select public.record_bank_entry(pg_temp.acct('Bank Joint A'), 'grant', 100, (now() + interval '7 days')::date, 'Future grant') $$, 'P0001', 'The date can''t be in the future.', 'no future-dated entries');

select throws_ok($$ select public.add_bank_account('Bank Joint Z', 'DBS', '3333', 0, (now() + interval '9 days')::date) $$, 'P0001',
  'The date can''t be in the future.', 'no future opening balance');
select throws_ok($$ select public.record_bank_entry(pg_temp.acct('Bank Joint A'), 'grant', 100, '2026-09-30', 'Old grant') $$, 'P0001',
  'The date is before Bank Joint A''s opening balance (01 Oct 2026), which already includes it.', 'no entries before the opening balance');
select throws_ok($$ select public.record_bank_entry(pg_temp.acct('Bank Joint A'), 'adjustment', 100, null, 'Match DBS balance', 1) $$,
  'P0001', 'The balance has changed since you compared it. Compare with DBS again.', 'a correction made from a stale balance is refused');
select lives_ok($$ select public.record_bank_entry(pg_temp.acct('Bank Joint A'), 'adjustment', 100, null, 'Match DBS balance', 699850) $$,
  'a correction made from the current balance is saved');
select lives_ok($$ select public.record_bank_entry(pg_temp.acct('Bank Joint A'), 'adjustment', -100, null, 'Undo test correction') $$,
  'and corrected back');
select lives_ok($$ select public.transfer_between_accounts(pg_temp.acct('Bank Joint A'), pg_temp.acct('Bank Joint B'), 100000, null, null) $$, 'Finance moves money between accounts');
select throws_ok($$ select public.transfer_between_accounts(pg_temp.acct('Bank Joint A'), pg_temp.acct('Bank Joint A'), 1, null, null) $$, 'P0001', 'Choose two different accounts.', 'a transfer needs two accounts');
select results_eq($$ select pg_temp.balance('Bank Joint A'), pg_temp.balance('Bank Joint B') $$,
  $$ values (599850::bigint, 100000::bigint) $$, 'balances: opening + grant - fee - transfer, and the transfer arrived');

select throws_ok($$ update public.bank_entries set amount_cents = 1 $$, '42501', null, 'ledger entries cannot be edited');
select throws_ok($$ delete from public.bank_entries $$, '42501', null, 'or deleted');
select throws_ok($$ insert into public.bank_entries (account_id, kind, amount_cents, entry_date, actor_name)
                    values (pg_temp.acct('Bank Joint A'), 'grant', 1, current_date, 'x') $$, '42501', null, 'or inserted except through the functions');
reset role;

-- ---------- a volunteer claims; the core member reviews ----------
select pg_temp.login('00000000-0000-4000-8000-0000000b0b01');
insert into public.claims (pool_id, category_id, description, amount_cents, attachment_paths, payout_type, payout_masked, payout_enc)
values ('20000000-0000-4000-8000-0000000b0e01', '30000000-0000-4000-8000-0000000b0001', 'bank taxi', 4200,
        array['00000000-0000-4000-8000-0000000b0b01/x/r.jpg'], 'paynow_mobile', 'Mobile •••• 4567', 'v1.a.b.c');
select is_empty($$ select * from public.bank_accounts $$, 'volunteers see no bank accounts');
select is_empty($$ select * from public.bank_balances $$, 'or balances');
select throws_ok($$ select public.record_bank_entry(null, 'grant', 1, null, 'nope') $$, '42501', null, 'or record anything');
reset role;

select pg_temp.login('00000000-0000-4000-8000-0000000b0c01');
select is_empty($$ select * from public.bank_entries $$, 'core reviewers see no ledger');
select throws_ok($$ select public.add_bank_account('Core acct', 'DBS', '9999', 0, null) $$, '42501', null, 'or add accounts');
select lives_ok($$ select * from public.decide_claim((select id from public.claims where description = 'bank taxi'), true) $$, 'the division approves');
reset role;

-- ---------- Finance approves and pays from account B ----------
select pg_temp.login('00000000-0000-4000-8000-0000000b0f01');
select lives_ok($$ select * from public.decide_claim((select id from public.claims where description = 'bank taxi'), true) $$, 'Finance approves');
select throws_ok($$ select * from public.mark_paid((select id from public.claims where description = 'bank taxi'), 'TXN-9', null) $$,
  'P0002', 'Choose a bank account.', 'paying needs an account');
select lives_ok($$ select * from public.mark_paid((select id from public.claims where description = 'bank taxi'), 'TXN-9', pg_temp.acct('Bank Joint B')) $$,
  'Finance pays from account B');
select is(pg_temp.balance('Bank Joint B'), 95800::bigint, 'the payout comes off that account');
select results_eq($$ select kind::text, amount_cents from public.bank_entries where claim_id = (select id from public.claims where description = 'bank taxi') $$,
  $$ values ('payout', -4200::bigint) $$, 'the payout entry points at the claim');
select lives_ok($$ update public.bank_accounts set active = false where name = 'Bank Joint A' $$, 'Finance closes an account');
select throws_ok($$ select public.record_bank_entry(pg_temp.acct('Bank Joint A'), 'grant', 100, null, 'Late grant') $$,
  'P0001', 'That bank account is closed.', 'closed accounts take no new entries');
reset role;

-- ---------- the claimant's history never names the account ----------
select pg_temp.login('00000000-0000-4000-8000-0000000b0b01');
select results_eq($$ select note from public.claim_events where action = 'paid'
                     and claim_id = (select id from public.claims where description = 'bank taxi') $$,
  $$ values ('TXN-9') $$, 'the claimant sees the reference only');
reset role;

-- ---------- admins (no Finance flag) see and use it too ----------
select pg_temp.login('00000000-0000-4000-8000-0000000b0a01');
select results_eq($$ select count(*)::int from public.bank_balances where name like 'Bank Joint %' $$, $$ values (2) $$, 'admins see the balances');
select lives_ok($$ select public.record_bank_entry(pg_temp.acct('Bank Joint B'), 'grant', 1000, null, 'Donation') $$, 'admins record entries');
reset role;

select * from finish();
rollback;
