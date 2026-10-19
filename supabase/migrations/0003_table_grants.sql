-- Hosted Supabase gives new tables no privileges for `authenticated` (or `anon`); only local
-- Supabase does. 0001 granted claims, claim_events, the views and the functions explicitly, but
-- relied on the local default for the rest, so on the hosted project signed-in people couldn't
-- even read their own member row. Grant exactly what each table's RLS policies are written for
-- (RLS still decides which rows), the same everywhere: revoke first, then grant.

revoke all on public.divisions, public.categories, public.pools, public.pool_budgets,
  public.members, public.division_members, public.member_payouts from anon, authenticated;

-- Reference data: everyone active reads; admins write (policies *_admin).
grant select, insert, update, delete on public.divisions, public.categories, public.pools,
  public.pool_budgets to authenticated;

-- Members: yourself, Finance and admins read; admins add and update. Never deleted through the API.
grant select, insert, update on public.members to authenticated;

-- Division links: read yours (Finance/admins all); admins add and remove.
grant select, insert, delete on public.division_members to authenticated;

-- Saved payout details: the member's own, all operations.
grant select, insert, update, delete on public.member_payouts to authenticated;
