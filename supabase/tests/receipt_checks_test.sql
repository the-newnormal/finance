-- AI receipt checks (0008): only a claim's reviewers record or read one, never its claimant
-- (Finance excepted), and only while the claim awaits a decision. Run: pnpm supabase test db.
begin;
select no_plan();

create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.claim(p_desc text) returns uuid language sql security definer as $$
  select id from public.claims where description = p_desc
$$;
create function pg_temp.submit(p_desc text) returns void language sql as $$
  insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc, submission_id)
  values ('0d400000-0000-4000-8000-000000000001', '0d300000-0000-4000-8000-000000000001', p_desc, 2540,
          array[auth.uid()::text || '/x/r.jpg'], 'bank', 'DBS •••• 1', 'v1.a.b.c', gen_random_uuid())
$$;
create function pg_temp.record(p_desc text, p_summary text default 'The receipt matches.') returns void language sql security definer as $$
  select public.record_receipt_check(pg_temp.claim(p_desc), auth.uid(), 'looks_right', p_summary, '{"documents": []}', 1, 'claude-haiku-5-5')
$$;

-- f: Finance; a: lead of division A; b: lead of division B; v: volunteer in A
insert into auth.users (id, email) values
  ('0d100000-0000-4000-8000-000000000001', 'rc-fin@test.local'),
  ('0d100000-0000-4000-8000-000000000002', 'rc-lead-a@test.local'),
  ('0d100000-0000-4000-8000-000000000003', 'rc-lead-b@test.local'),
  ('0d100000-0000-4000-8000-000000000004', 'rc-vol@test.local');
insert into public.members (id, email, name, role) values
  ('0d100000-0000-4000-8000-000000000001', 'rc-fin@test.local', 'RC Fin', 'finance'),
  ('0d100000-0000-4000-8000-000000000002', 'rc-lead-a@test.local', 'RC Lead A', 'lead'),
  ('0d100000-0000-4000-8000-000000000003', 'rc-lead-b@test.local', 'RC Lead B', 'lead'),
  ('0d100000-0000-4000-8000-000000000004', 'rc-vol@test.local', 'RC Vol', 'volunteer');
insert into public.divisions (id, name) values
  ('0d200000-0000-4000-8000-000000000001', 'RC Division A'),
  ('0d200000-0000-4000-8000-000000000002', 'RC Division B');
insert into public.division_leads (member_id, division_id) values
  ('0d100000-0000-4000-8000-000000000002', '0d200000-0000-4000-8000-000000000001'),
  ('0d100000-0000-4000-8000-000000000003', '0d200000-0000-4000-8000-000000000002');
insert into public.categories (id, name) values ('0d300000-0000-4000-8000-000000000001', 'RC Transport');
insert into public.budgets (id, name, division_id) values
  ('0d400000-0000-4000-8000-000000000001', 'RC Budget', '0d200000-0000-4000-8000-000000000001');
insert into public.budget_categories (budget_id, category_id) values
  ('0d400000-0000-4000-8000-000000000001', '0d300000-0000-4000-8000-000000000001');
insert into storage.objects (bucket_id, name)
select 'receipts', id::text || '/x/r.jpg' from public.members where email like 'rc-%';

select pg_temp.login('0d100000-0000-4000-8000-000000000004');
select pg_temp.submit('RC vol claim');
select pg_temp.login('0d100000-0000-4000-8000-000000000002');
select pg_temp.submit('RC lead claim');
select pg_temp.login('0d100000-0000-4000-8000-000000000001');
select pg_temp.submit('RC fin claim');

-- ---------- who records a check ----------
select pg_temp.login('0d100000-0000-4000-8000-000000000004');
select throws_ok($$ select pg_temp.record('RC vol claim', 'Fine!') $$, 'P0002', 'Claim not found.',
  'the claimant can''t record a check on their own claim');
select throws_ok($$ insert into public.receipt_checks (claim_id, verdict, summary, findings, files_checked, model, checked_by_name)
  values (pg_temp.claim('RC vol claim'), 'looks_right', 'Fine!', '{}', 1, 'x', 'RC Vol') $$, '42501', null,
  'nor write one directly');

select pg_temp.login('0d100000-0000-4000-8000-000000000003');
select throws_ok($$ select pg_temp.record('RC vol claim') $$, 'P0002', 'Claim not found.', 'nor a lead of another division');

select pg_temp.login('0d100000-0000-4000-8000-000000000002');
select lives_ok($$ select pg_temp.record('RC vol claim') $$, 'a lead of the claim''s division records one');
select throws_ok($$ select pg_temp.record('RC lead claim') $$, '42501', 'You can''t check your own claim.',
  'but not on their own claim');

select pg_temp.login('0d100000-0000-4000-8000-000000000001');
select lives_ok($$ select pg_temp.record('RC fin claim') $$, 'Finance records one on its own claim (it may finalise it)');
select lives_ok($$ select pg_temp.record('RC vol claim', 'Rechecked.') $$, 'and re-checks a claim');
select results_eq($$ select summary, checked_by_name from public.receipt_checks where claim_id = pg_temp.claim('RC vol claim') $$,
  $$ values ('Rechecked.', 'RC Fin') $$, 'a re-check replaces the check and records who ran it');

-- Only while the claim awaits a decision.
select lives_ok($$ select public.decide_claim(pg_temp.claim('RC lead claim'), true) $$, 'Finance approves the lead''s claim');
select throws_ok($$ select pg_temp.record('RC lead claim') $$, 'P0001', 'Only claims awaiting a decision are checked.',
  'a decided claim isn''t checked');

-- ---------- who reads them ----------
select pg_temp.login('0d100000-0000-4000-8000-000000000002');
select isnt_empty($$ select 1 from public.receipt_checks where claim_id = pg_temp.claim('RC vol claim') $$,
  'the division''s lead reads the check');
select pg_temp.login('0d100000-0000-4000-8000-000000000003');
select is_empty($$ select 1 from public.receipt_checks $$, 'a lead of another division reads none');
select pg_temp.login('0d100000-0000-4000-8000-000000000004');
select is_empty($$ select 1 from public.receipt_checks $$, 'the claimant reads none, not even their own claim''s');

select * from finish();
rollback;
