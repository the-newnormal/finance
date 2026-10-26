-- Local development only (supabase db reset). Sign in at /login as finance@example.com and open the
-- link from Mailpit at http://127.0.0.1:54324. They are Finance.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000ad01', 'authenticated',
  'authenticated', 'finance@example.com', now(), '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
  '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-4000-8000-00000000ad01', '00000000-0000-4000-8000-00000000ad01',
  '{"sub": "00000000-0000-4000-8000-00000000ad01", "email": "finance@example.com"}', 'email', now(), now(), now());

insert into public.members (id, email, name, role)
values ('00000000-0000-4000-8000-00000000ad01', 'finance@example.com', 'Local Finance', 'finance');

insert into public.divisions (id, name) values ('10000000-0000-4000-8000-00000000d001', 'Community');

-- The categories, in their groups, come from migration 0011.

insert into public.budgets (id, name, kind, division_id)
values ('20000000-0000-4000-8000-00000000e001', 'Community Iftar 2026', 'event', '10000000-0000-4000-8000-00000000d001');
-- Provision three categories, each with a guideline. (The reserve provisions every category itself,
-- and has no guidelines.)
insert into public.budget_categories (budget_id, category_id)
select '20000000-0000-4000-8000-00000000e001', id from public.categories
where name in ('Venue & Rental', 'F&B – Participants', 'Transport & Logistics');
insert into public.budget_guidelines (budget_id, category_id, guideline_cents)
select budget_id, category_id, 50000 from public.budget_categories
where budget_id = '20000000-0000-4000-8000-00000000e001';
