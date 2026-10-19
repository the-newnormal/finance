-- Table privileges (0003): exactly what the RLS policies are written for, and nothing for anon.
-- Hosted Supabase grants nothing by default, so these must come from the migrations themselves.
begin;
select no_plan();

select ok(has_table_privilege('authenticated', 'public.members', 'select'), 'members: read');
select ok(has_table_privilege('authenticated', 'public.members', 'insert'), 'members: add (admins, by RLS)');
select ok(not has_table_privilege('authenticated', 'public.members', 'delete'), 'members: never deleted through the API');
select ok(has_table_privilege('authenticated', 'public.division_members', 'delete'), 'division links: removable (admins)');
select ok(not has_table_privilege('authenticated', 'public.division_members', 'update'), 'division links: not updated');
select ok(has_table_privilege('authenticated', 'public.pools', 'select'), 'pools: read');
select ok(has_table_privilege('authenticated', 'public.member_payouts', 'delete'), 'saved payouts: the owner can forget them');
select ok(not has_table_privilege('authenticated', 'public.claims', 'update'), 'claims: never updated through the API');
select ok(not has_column_privilege('authenticated', 'public.claims', 'payout_enc', 'select'), 'claims: payout_enc never readable');
select ok(not has_table_privilege('authenticated', 'public.bank_entries', 'insert'), 'bank ledger: written only by functions');

select ok(not has_table_privilege('anon', t, p), format('anon: no %s on %s', p, t))
from unnest(array['public.members', 'public.divisions', 'public.categories', 'public.pools', 'public.pool_budgets',
                  'public.division_members', 'public.member_payouts', 'public.claims', 'public.claim_events',
                  'public.bank_accounts', 'public.bank_entries']) t,
     unnest(array['select', 'insert', 'update', 'delete']) p;

select * from finish();
rollback;
