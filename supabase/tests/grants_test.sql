-- Privileges: exactly what the RLS policies are written for, and nothing for anon. Hosted Supabase
-- grants new tables, views and functions nothing (local Supabase grants them), so these must come
-- from the migrations themselves. Run: pnpm supabase test db.
begin;
select no_plan();

-- anon: nothing on any table or view in public.
select ok(not has_table_privilege('anon', c.oid, p), format('anon: no %s on %s', p, c.relname))
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
cross join unnest(array['select', 'insert', 'update', 'delete']) p
where c.relkind in ('r', 'v', 'm', 'p')
  and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');

-- The tables and views this test expects actually exist (so the loop above isn't vacuous).
select has_table('public', t, format('%s exists', t))
from unnest(array['divisions', 'members', 'division_leads', 'member_payouts', 'categories', 'budgets',
                  'budget_categories', 'budget_guidelines', 'claims', 'claim_events', 'bank_accounts',
                  'bank_entries', 'bank_entry_edits', 'reserve_additions', 'claim_rules', 'receipt_checks']) t;
select has_view('public', v, format('%s exists', v))
from unnest(array['guideline_totals', 'budget_totals', 'bank_balances']) v;

-- authenticated: what the policies need, and no more.
select ok(not has_table_privilege('authenticated', 'public.claims', 'update'), 'claims: never updated through the API');
select ok(not has_any_column_privilege('authenticated', 'public.claims', 'update'), 'claims: no column is updatable');
select ok(not has_table_privilege('authenticated', 'public.claims', 'delete'), 'claims: never deleted through the API');
select ok(not has_column_privilege('authenticated', 'public.claims', 'payout_enc', 'select'), 'claims: payout_enc never readable');
select ok(has_column_privilege('authenticated', 'public.claims', 'payout_enc', 'insert'), 'claims: payout_enc is written on submit');
select ok(not has_column_privilege('authenticated', 'public.claims', c, 'insert'), format('claims: %s is not the claimant''s to set', c))
from unnest(array['status', 'claimant_id', 'claimant_name', 'division_id', 'rejection_reason', 'payment_reference',
                  'created_at', 'updated_at']) c;
select ok(not has_table_privilege('authenticated', 'public.claim_events', p), format('claim_events: no %s', p))
from unnest(array['insert', 'update', 'delete']) p;

select ok(not has_table_privilege('authenticated', 'public.bank_entries', p), format('bank_entries: no %s (functions write it)', p))
from unnest(array['insert', 'update', 'delete']) p;
select ok(not has_table_privilege('authenticated', 'public.bank_entry_edits', p), format('bank_entry_edits: no %s (edit_bank_entry writes it; nobody changes it)', p))
from unnest(array['insert', 'update', 'delete']) p;
select ok(not has_table_privilege('authenticated', 'public.bank_accounts', p), format('bank_accounts: no %s', p))
from unnest(array['insert', 'delete']) p;
select ok(not has_column_privilege('authenticated', 'public.bank_accounts', 'last4', 'update'), 'bank_accounts: last4 never changes');

select ok(not has_table_privilege('authenticated', t, 'delete'), format('%s: never deleted through the API', t))
from unnest(array['public.members', 'public.budgets', 'public.categories']) t;
select ok(has_table_privilege('authenticated', 'public.members', 'select'), 'members: read (RLS decides)');
select ok(has_table_privilege('authenticated', 'public.division_leads', 'delete'), 'division_leads: removable (Finance, by RLS)');
select ok(not has_table_privilege('authenticated', 'public.division_leads', 'update'), 'division_leads: not updated');
select ok(has_table_privilege('authenticated', 'public.member_payouts', 'delete'), 'member_payouts: the owner can forget them');
select ok(not has_table_privilege('authenticated', 'public.budget_categories', 'update'), 'budget_categories: not updated');
select ok(has_table_privilege('authenticated', 'public.claim_rules', p), format('claim_rules: %s (Finance only, by RLS)', p))
from unnest(array['select', 'insert', 'update', 'delete']) p;
select ok(not has_table_privilege('authenticated', 'public.receipt_checks', p), format('receipt_checks: no %s (record_receipt_check writes it)', p))
from unnest(array['insert', 'update', 'delete']) p;
select ok(has_table_privilege('authenticated', v, 'select') and not has_table_privilege('authenticated', v, 'insert'),
  format('%s: read-only', v))
from unnest(array['public.guideline_totals', 'public.budget_totals', 'public.bank_balances']) v;

-- Views run as the viewer, so RLS on the underlying tables applies.
select ok(coalesce(c.reloptions @> array['security_invoker=true'], false), format('%s is security_invoker', c.relname))
from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where c.relkind = 'v';

-- RLS is on for every table.
select ok(c.relrowsecurity, format('%s has RLS on', c.relname))
from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where c.relkind in ('r', 'p') and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');

-- Functions: execute revoked from PUBLIC and anon on every function in public (a missing ACL
-- means the default, which grants PUBLIC execute).
select ok(not exists (
    select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  format('public: no execute on %s', p.oid::regprocedure))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
select ok(not has_function_privilege('anon', p.oid, 'execute'), format('anon: no execute on %s', p.oid::regprocedure))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
select ok(has_function_privilege('authenticated', f, 'execute'), format('authenticated: execute on %s', f))
from unnest(array['public.add_member(uuid, text, text, public.member_role, uuid[])',
                  'public.update_member(uuid, public.member_role, boolean, uuid[])',
                  'public.save_budget(uuid, text, public.budget_kind, uuid, boolean, jsonb)',
                  'public.decide_claim(uuid, boolean, text)',
                  'public.claim_payout_enc(uuid)',
                  'public.add_bank_account(text, text, text, bigint, date)',
                  'public.record_bank_entry(uuid, public.bank_entry_kind, bigint, date, text, bigint)',
                  'public.transfer_between_accounts(uuid, uuid, bigint, date, text)',
                  'public.mark_paid(uuid, text, uuid)',
                  'public.edit_bank_entry(bigint, uuid, bigint, date, text, text, text, jsonb)',
                  'public.import_paid_claims(jsonb)',
                  'public.attach_claim_files(uuid, text[])',
                  'public.add_to_reserve(bigint, date, text)',
                  'public.record_receipt_check(uuid, public.receipt_verdict, text, jsonb, integer, text)']) f;

-- The private helpers are unreachable for anon, and the trigger functions for everyone.
select ok(not has_function_privilege('anon', p.oid, 'execute'), format('anon: no execute on %s', p.oid::regprocedure))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'private';
select ok(not has_function_privilege('authenticated', f, 'execute'), format('authenticated: no execute on %s', f))
from unnest(array['private.members_before_update()', 'private.budgets_before_update()',
                  'private.claims_before_insert()', 'private.claims_after_insert()',
                  'private.finance_me()', 'private.me()', 'private.active_account(uuid)',
                  'private.sgd(bigint)', 'private.on_day(timestamp with time zone, date)']) f;

select * from finish();
rollback;
