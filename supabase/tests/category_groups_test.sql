-- Category groups (0011): every category written from now on has one of the five groups, and older
-- ones get theirs before they can be hidden. Only Finance changes categories, groups included.
-- Run: pnpm supabase test db. Rolls back.
begin;
select no_plan();

create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

insert into auth.users (id, email) values
  ('0c400000-0000-4000-8000-000000000001', 'cg-fin@test.local'),
  ('0c400000-0000-4000-8000-000000000002', 'cg-vol@test.local');
insert into public.members (id, email, name, role) values
  ('0c400000-0000-4000-8000-000000000001', 'cg-fin@test.local', 'CG Fin', 'finance'),
  ('0c400000-0000-4000-8000-000000000002', 'cg-vol@test.local', 'CG Vol', 'volunteer');
-- A category from before 0011, which has no group (written past the trigger, as only the past could).
alter table public.categories disable trigger categories_before_write;
insert into public.categories (id, name) values ('0c500000-0000-4000-8000-000000000001', 'CG Old');
alter table public.categories enable trigger categories_before_write;

-- The migration adds Normal's categories, each in its group, in the groups' order.
select results_eq($$ select category_group::text as group_name, count(*)::int from public.categories
    where name in ('Venue & Rental', 'Production & AV', 'Equipment (Capital)', 'Materials & Consumables',
      'F&B – Participants', 'Prizes & Gifts', 'Manpower – External', 'Honoraria & Team Payments', 'F&B – Team',
      'Marketing & Content', 'Merch & Wristbands', 'Transport & Logistics', 'Software & Subscriptions',
      'Admin & Fees', 'Miscellaneous') and active
    group by category_group order by category_group $$,
  $$ values ('venue_production', 3), ('programme', 3), ('people', 3), ('marketing', 2), ('operations', 4) $$,
  'the five groups hold Normal''s fifteen categories');

-- ---------- volunteers read groups, and change nothing ----------
select pg_temp.login('0c400000-0000-4000-8000-000000000002');
select results_eq($$ select category_group::text from public.categories where name = 'F&B – Team' $$,
  $$ values ('people') $$, 'a volunteer reads a category''s group');
select results_eq($$ with u as (update public.categories set category_group = 'people' where name = 'CG Old' returning 1)
    select count(*)::int from u $$, $$ values (0) $$, 'volunteers can''t group a category');
reset role;

-- ---------- Finance ----------
select pg_temp.login('0c400000-0000-4000-8000-000000000001');
select throws_ok($$ insert into public.categories (name) values ('CG New') $$,
  'P0001', 'Choose a group for the category first, so reports count its spending.', 'a new category needs a group');
select lives_ok($$ insert into public.categories (name, category_group) values ('CG New', 'programme') $$,
  'Finance adds a category in a group');
select throws_ok($$ update public.categories set active = false where id = '0c500000-0000-4000-8000-000000000001' $$,
  'P0001', 'Choose a group for the category first, so reports count its spending.', 'an old category is grouped before it''s hidden');
select lives_ok($$ update public.categories set category_group = 'operations' where id = '0c500000-0000-4000-8000-000000000001' $$,
  'Finance groups an old category');
select lives_ok($$ update public.categories set active = false where id = '0c500000-0000-4000-8000-000000000001' $$,
  'and can hide it then');
select lives_ok($$ update public.categories set category_group = 'people' where name = 'CG New' $$,
  'Finance moves a category to another group');
select throws_ok($$ update public.categories set category_group = null where name = 'CG New' $$,
  'P0001', 'Choose a group for the category first, so reports count its spending.', 'but never out of every group');
select results_eq($$ select name, category_group::text, active from public.categories where name like 'CG %' order by name $$,
  $$ values ('CG New', 'people', true), ('CG Old', 'operations', false) $$, 'what Finance saved');
reset role;

select * from finish();
rollback;
