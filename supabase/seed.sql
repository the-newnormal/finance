-- Local development only (supabase db reset). Sign in at /login as admin@example.com and open the
-- link from Mailpit at http://127.0.0.1:54324. The admin has the Finance flag too.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000ad01', 'authenticated',
  'authenticated', 'admin@example.com', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
  '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-4000-8000-00000000ad01', '00000000-0000-4000-8000-00000000ad01',
  '{"sub": "00000000-0000-4000-8000-00000000ad01", "email": "admin@example.com"}', 'email', now(), now(), now());

insert into public.members (id, email, name, role, finance)
values ('00000000-0000-4000-8000-00000000ad01', 'admin@example.com', 'Local Admin', 'admin', true);

insert into public.divisions (id, name) values ('10000000-0000-4000-8000-00000000d001', 'Community');

insert into public.categories (name) values
  ('Venue costs'), ('Logistics'), ('Food & beverages'), ('Printing & materials'), ('Transport'), ('Others');

insert into public.pools (id, name, kind, division_id)
values ('20000000-0000-4000-8000-00000000e001', 'Community Iftar 2026', 'event', '10000000-0000-4000-8000-00000000d001');
insert into public.pool_budgets (pool_id, allocated_cents) values ('20000000-0000-4000-8000-00000000e001', 150000);
