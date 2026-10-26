-- Claim items (0012): the claimant sends what the receipts list with the claim; a trigger keeps only
-- well-formed items, and nobody changes them after. Whoever sees a claim sees its items.
-- Run: pnpm supabase test db. Rolls back.
begin;
select no_plan();

create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.submit(p_desc text, p_items jsonb) returns void language sql as $$
  insert into public.claims (budget_id, category_id, description, amount_cents, attachment_paths,
                             payout_type, payout_masked, payout_enc, submission_id, items)
  values ('0e400000-0000-4000-8000-000000000001', '0e300000-0000-4000-8000-000000000001', p_desc, 2180,
          array[auth.uid()::text || '/x/r.jpg'], 'bank', 'DBS •••• 1', 'v1.a.b.c', gen_random_uuid(), p_items)
$$;
create function pg_temp.items(p_desc text) returns jsonb language sql security definer as $$
  select items from public.claims where description = p_desc
$$;

-- v: volunteer in A; o: another volunteer; a: lead of A
insert into auth.users (id, email) values
  ('0e100000-0000-4000-8000-000000000001', 'ci-vol@test.local'),
  ('0e100000-0000-4000-8000-000000000002', 'ci-other@test.local'),
  ('0e100000-0000-4000-8000-000000000003', 'ci-lead@test.local');
insert into public.members (id, email, name, role) values
  ('0e100000-0000-4000-8000-000000000001', 'ci-vol@test.local', 'CI Vol', 'volunteer'),
  ('0e100000-0000-4000-8000-000000000002', 'ci-other@test.local', 'CI Other', 'volunteer'),
  ('0e100000-0000-4000-8000-000000000003', 'ci-lead@test.local', 'CI Lead', 'lead');
insert into public.divisions (id, name) values ('0e200000-0000-4000-8000-000000000001', 'CI Division');
insert into public.division_leads (member_id, division_id) values
  ('0e100000-0000-4000-8000-000000000003', '0e200000-0000-4000-8000-000000000001');
insert into public.categories (id, name, category_group) values
  ('0e300000-0000-4000-8000-000000000001', 'CI Food', 'programme'),
  ('0e300000-0000-4000-8000-000000000002', 'CI Cups', 'programme');
insert into public.budgets (id, name, division_id) values
  ('0e400000-0000-4000-8000-000000000001', 'CI Budget', '0e200000-0000-4000-8000-000000000001');
insert into public.budget_categories (budget_id, category_id) values
  ('0e400000-0000-4000-8000-000000000001', '0e300000-0000-4000-8000-000000000001');
insert into storage.objects (bucket_id, name)
select 'receipts', id::text || '/x/r.jpg' from public.members where email like 'ci-%';

-- ---------- the claimant sends items with the claim ----------
select pg_temp.login('0e100000-0000-4000-8000-000000000001');
select lives_ok($$ select pg_temp.submit('CI itemised', '[
    {"description": "  Bottled water x 24 ", "amount_cents": 1200, "category_id": "0e300000-0000-4000-8000-000000000001", "note": "dropped"},
    {"description": "Paper cups", "amount_cents": 800, "category_id": "0e300000-0000-4000-8000-000000000002"},
    {"description": "Member discount", "amount_cents": -200, "category_id": "not-a-category"},
    {"description": "Ice"}]') $$, 'a claimant sends items with their claim');
select results_eq($$ select pg_temp.items('CI itemised') $$, $$ values ('[
    {"description": "Bottled water x 24", "amount_cents": 1200, "category_id": "0e300000-0000-4000-8000-000000000001"},
    {"description": "Paper cups", "amount_cents": 800, "category_id": "0e300000-0000-4000-8000-000000000002"},
    {"description": "Member discount", "amount_cents": -200, "category_id": null},
    {"description": "Ice", "amount_cents": null, "category_id": null}]'::jsonb) $$,
  'only well-formed fields are kept: a category that doesn''t exist, or an amount not given, is none');
select lives_ok($$ select pg_temp.submit('CI not itemised', null) $$, 'a claim may list no items');
select results_eq($$ select pg_temp.items('CI not itemised') is null $$, $$ values (true) $$, 'and keeps none');

select throws_ok($$ select pg_temp.submit('CI empty list', '[]') $$, 'P0001', 'A claim lists 1 to 100 items, or none.', 'an empty list is refused');
select throws_ok($$ select pg_temp.submit('CI not a list', '{"description": "x"}') $$, 'P0001', 'A claim lists 1 to 100 items, or none.', 'so is anything but a list');
select throws_ok($$ select pg_temp.submit('CI too many', (select jsonb_agg(jsonb_build_object('description', 'Item ' || n)) from generate_series(1, 101) n)) $$,
  'P0001', 'A claim lists 1 to 100 items, or none.', 'and more than 100 items');
select throws_ok($$ select pg_temp.submit('CI no description', '[{"description": "   ", "amount_cents": 100}]') $$,
  'P0001', 'Each item needs a description of up to 200 characters.', 'an item needs a description');
select throws_ok($$ select pg_temp.submit('CI long description', jsonb_build_array(jsonb_build_object('description', repeat('x', 201)))) $$,
  'P0001', 'Each item needs a description of up to 200 characters.', 'of up to 200 characters');
select throws_ok($$ select pg_temp.submit('CI not an object', '["Water"]') $$,
  'P0001', 'Each item needs a description of up to 200 characters.', 'each item is an object');
select throws_ok($$ select pg_temp.submit('CI fractional cents', '[{"description": "Water", "amount_cents": 12.5}]') $$,
  'P0001', 'An item''s amount is a whole number of cents, or none.', 'an amount is whole cents');
select throws_ok($$ select pg_temp.submit('CI text amount', '[{"description": "Water", "amount_cents": "12"}]') $$,
  'P0001', 'An item''s amount is a whole number of cents, or none.', 'and a number');
select throws_ok($$ update public.claims set items = null where description = 'CI itemised' $$, '42501', null,
  'nobody changes a claim''s items');

-- ---------- whoever sees the claim sees its items ----------
select pg_temp.login('0e100000-0000-4000-8000-000000000003');
select results_eq($$ select jsonb_array_length(items) from public.claims where description = 'CI itemised' $$, $$ values (4) $$,
  'the division''s lead reads the items');
select pg_temp.login('0e100000-0000-4000-8000-000000000002');
select is_empty($$ select items from public.claims where description = 'CI itemised' $$, 'another volunteer doesn''t');
reset role;

select * from finish();
rollback;
