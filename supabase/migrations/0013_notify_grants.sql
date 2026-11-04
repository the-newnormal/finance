-- Part 13: let the server's notification lookups read what they need.
--
-- src/lib/notify.ts emails a claim's claimant and whoever must review it next. Neither decide_claim
-- nor mark_paid returns an address (reviewers may not read other members' rows), so the server
-- looks them up with the service role (src/lib/supabase/admin.ts, server-only). Hosted Supabase
-- gives new tables no privileges for service_role either (local Supabase grants them, so tests never
-- noticed), so every lookup was refused ("notify lookup failed") and no claim email was ever sent.
--
-- Read only, and only these tables and columns: the service role never writes here. Revoked first,
-- so local Supabase (which grants it everything) ends up exactly like the hosted project.

grant usage on schema public to service_role;
revoke all on public.members, public.division_leads, public.budgets, public.claims from service_role;
grant select (id, email, name, role, active) on public.members to service_role;
grant select (member_id, division_id) on public.division_leads to service_role;
grant select (id, name) on public.budgets to service_role;
grant select (id, status, division_id, claimant_id, claimant_name, amount_cents, kind, description, vendor_name, budget_id)
  on public.claims to service_role;
