-- AI receipt checks (0008): only a reviewer who could decide a claim now records a check on it,
-- never its claimant (Finance excepted), and each reviewer reads only their own. Run:
-- pnpm supabase test db.
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
-- The claim form told the claimant about the AI check unless p_told is false.
create function pg_temp.submit(p_desc text, p_told boolean default true) returns void language sql as $$
  insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc, submission_id, ai_check_notice)
  values ('0d400000-0000-4000-8000-000000000001', '0d300000-0000-4000-8000-000000000001', p_desc, 2540,
          array[auth.uid()::text || '/x/r.jpg'], 'bank', 'DBS •••• 1', 'v1.a.b.c', gen_random_uuid(), p_told)
$$;
create function pg_temp.record(p_desc text, p_summary text default 'The receipt matches.') returns void language sql as $$
  select public.record_receipt_check(pg_temp.claim(p_desc), 'looks_right', p_summary, '{"documents": []}', 1, 'claude-haiku-5-5')
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
select pg_temp.submit('RC untold claim', false);
select pg_temp.login('0d100000-0000-4000-8000-000000000002');
select pg_temp.submit('RC lead claim');
select pg_temp.login('0d100000-0000-4000-8000-000000000001');
select pg_temp.submit('RC fin claim');

-- ---------- who records a check ----------
select pg_temp.login('0d100000-0000-4000-8000-000000000004');
select throws_ok($$ select pg_temp.record('RC vol claim', 'Fine!') $$, 'P0002', 'Claim not found.',
  'the claimant can''t record a check on their own claim');
select throws_ok($$ insert into public.receipt_checks (claim_id, checked_by, verdict, summary, findings, files_checked, model)
  values (pg_temp.claim('RC vol claim'), auth.uid(), 'looks_right', 'Fine!', '{}', 1, 'x') $$, '42501', null,
  'nor write one directly');

select pg_temp.login('0d100000-0000-4000-8000-000000000003');
select throws_ok($$ select pg_temp.record('RC vol claim') $$, 'P0002', 'Claim not found.', 'nor a lead of another division');

select pg_temp.login('0d100000-0000-4000-8000-000000000002');
select lives_ok($$ select pg_temp.record('RC vol claim', 'Lead: fine.') $$, 'a lead of the claim''s division records one');
select throws_ok($$ select pg_temp.record('RC untold claim') $$, 'P0001',
  'This claim was made before claimants were told about the AI check, so it isn''t checked.',
  'but not on a claim whose claimant wasn''t told about the check');
select throws_ok($$ select pg_temp.record('RC lead claim') $$, '42501', 'You can''t check your own claim.',
  'but not on their own claim');

select pg_temp.login('0d100000-0000-4000-8000-000000000001');
select lives_ok($$ select pg_temp.record('RC fin claim') $$, 'Finance records one on its own claim (it may finalise it)');
select lives_ok($$ select pg_temp.record('RC lead claim', 'Finance: fine.') $$, 'and on a lead''s claim');
select lives_ok($$ select pg_temp.record('RC vol claim', 'Finance: first.') $$, 'and on a volunteer''s');
select lives_ok($$ select pg_temp.record('RC vol claim', 'Finance: rechecked.') $$, 'and re-checks it');
select results_eq($$ select summary from public.receipt_checks where claim_id = pg_temp.claim('RC vol claim') $$,
  $$ values ('Finance: rechecked.') $$, 'a re-check replaces Finance''s own check, and Finance sees only its own');

-- Once a claim awaits final approval, only Finance can decide it, so only Finance checks it.
select lives_ok($$ select public.decide_claim(pg_temp.claim('RC vol claim'), true) $$, 'Finance gives the preliminary approval');
select pg_temp.login('0d100000-0000-4000-8000-000000000002');
select throws_ok($$ select pg_temp.record('RC vol claim') $$, '42501', 'Only Finance checks a claim awaiting final approval.',
  'the lead no longer records one');
select results_eq($$ select summary from public.receipt_checks where claim_id = pg_temp.claim('RC vol claim') $$,
  $$ values ('Lead: fine.') $$, 'the lead reads only their own check, never Finance''s');
select pg_temp.login('0d100000-0000-4000-8000-000000000001');

-- Only while the claim awaits a decision.
select lives_ok($$ select public.decide_claim(pg_temp.claim('RC lead claim'), true) $$, 'Finance approves the lead''s claim');
select throws_ok($$ select pg_temp.record('RC lead claim') $$, 'P0001', 'Only claims awaiting a decision are checked.',
  'a decided claim isn''t checked');

-- ---------- who reads them ----------
select pg_temp.login('0d100000-0000-4000-8000-000000000002');
select is_empty($$ select 1 from public.receipt_checks where claim_id = pg_temp.claim('RC lead claim') $$,
  'a lead can''t read the check Finance ran on the lead''s own claim');
select pg_temp.login('0d100000-0000-4000-8000-000000000003');
select is_empty($$ select 1 from public.receipt_checks $$, 'a lead of another division reads none');
select pg_temp.login('0d100000-0000-4000-8000-000000000004');
select is_empty($$ select 1 from public.receipt_checks $$, 'the claimant reads none, not even their own claim''s');

-- A lead who no longer leads the division no longer reads their checks on its claims.
select pg_temp.login('0d100000-0000-4000-8000-000000000002');
select isnt_empty($$ select 1 from public.receipt_checks $$, 'the division''s lead reads their own check');
select pg_temp.login('0d100000-0000-4000-8000-000000000001');
delete from public.division_leads where member_id = '0d100000-0000-4000-8000-000000000002';
select pg_temp.login('0d100000-0000-4000-8000-000000000002');
select is_empty($$ select 1 from public.receipt_checks $$, 'but not once they no longer lead it, though still active');

select * from finish();
rollback;
