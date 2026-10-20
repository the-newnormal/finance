-- Claim rules (0007): every active member reads the rules shown on the claim form; only Finance
-- sees hidden ones and adds, edits or removes any. Run: pnpm supabase test db. Rolls back.
begin;
select no_plan();

create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

insert into auth.users (id, email) values
  ('0c100000-0000-4000-8000-000000000001', 'cr-fin@test.local'),
  ('0c100000-0000-4000-8000-000000000002', 'cr-vol@test.local'),
  ('0c100000-0000-4000-8000-000000000003', 'cr-gone@test.local');
insert into public.members (id, email, name, role, active) values
  ('0c100000-0000-4000-8000-000000000001', 'cr-fin@test.local', 'CR Fin', 'finance', true),
  ('0c100000-0000-4000-8000-000000000002', 'cr-vol@test.local', 'CR Vol', 'volunteer', true),
  ('0c100000-0000-4000-8000-000000000003', 'cr-gone@test.local', 'CR Gone', 'volunteer', false);
insert into public.claim_rules (id, title, body, active) values
  ('0c200000-0000-4000-8000-000000000001', 'CR shown', 'Shown to everyone.', true),
  ('0c200000-0000-4000-8000-000000000002', 'CR hidden', 'Finance only.', false);

-- The migration starts with TRP's notices: the declaration for each kind of claim, and the PDPA notice for both.
select results_eq($$ select applies_to::text from public.claim_rules
    where title in ('Accuracy and processing time', 'Personal data') order by applies_to::text $$,
  $$ values ('all'), ('invoice'), ('reimbursement') $$, 'the starting rules are there');

-- ---------- volunteers read shown rules, and change nothing ----------
select pg_temp.login('0c100000-0000-4000-8000-000000000002');
select isnt_empty($$ select 1 from public.claim_rules where title = 'CR shown' $$, 'a volunteer reads a shown rule');
select is_empty($$ select 1 from public.claim_rules where title = 'CR hidden' $$, 'but not a hidden one');
select throws_ok($$ insert into public.claim_rules (title, body) values ('CR vol', 'x') $$, '42501', null,
  'volunteers can''t add rules');
select results_eq($$ with u as (update public.claim_rules set body = 'changed' returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'nor edit them');
select results_eq($$ with d as (delete from public.claim_rules returning 1) select count(*)::int from d $$,
  $$ values (0) $$, 'nor delete them');

select pg_temp.login('0c100000-0000-4000-8000-000000000003');
select is_empty($$ select 1 from public.claim_rules $$, 'deactivated members read none');

-- ---------- Finance manages them ----------
select pg_temp.login('0c100000-0000-4000-8000-000000000001');
select isnt_empty($$ select 1 from public.claim_rules where title = 'CR hidden' $$, 'Finance reads hidden rules');
select lives_ok($$ insert into public.claim_rules (title, body, applies_to, link_label, link_url)
  values ('CR new', 'A rule.', 'reimbursement', 'Our policy', 'https://example.org/policy') $$, 'Finance adds a rule with a link');
select lives_ok($$ update public.claim_rules set active = false where title = 'CR shown' $$, 'Finance hides a rule');
select results_eq($$ with d as (delete from public.claim_rules where title = 'CR new' returning 1) select count(*)::int from d $$,
  $$ values (1) $$, 'Finance deletes a rule');
select throws_ok($$ insert into public.claim_rules (title, body, link_label, link_url) values ('CR bad', 'x', 'Click', 'javascript:alert(1)') $$,
  '23514', null, 'a link must be https');
select throws_ok($$ insert into public.claim_rules (title, body, link_url) values ('CR half', 'x', 'https://example.org') $$,
  '23514', null, 'a link needs its text');
select throws_ok($$ insert into public.claim_rules (title, body) values ('  ', 'x') $$, '23514', null, 'a rule needs a title');

select * from finish();
rollback;
