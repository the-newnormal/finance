-- Part 11: category groups. Five groups over the spend categories, so spending can be reported by
-- kind (a year's food or transport, say) as well as by category.
--
-- The groups are fixed here (another one is another migration), in this order: Venue & Production,
-- Programme, People, Marketing & Brand, Operations & Admin. Their labels are in src/lib/types.ts.
-- Claims are still made against a category; its group comes with it.
--
-- Every category written from now on has a group. Categories from before this part have none until
-- Finance gives them one on the Setup page (and must, before hiding one), so what was claimed
-- against them is counted in a group too. The categories below are Normal's list; any that already
-- exists by name is put in its group and shown.

create type public.category_group as enum ('venue_production', 'programme', 'people', 'marketing', 'operations');

alter table public.categories add column category_group public.category_group;

create function private.categories_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.category_group is null then
    raise exception 'Choose a group for the category first, so reports count its spending.';
  end if;
  return new;
end $$;
revoke all on function private.categories_before_write() from public, authenticated;

create trigger categories_before_write before insert or update on public.categories
  for each row execute function private.categories_before_write();

insert into public.categories (name, category_group) values
  ('Venue & Rental', 'venue_production'),
  ('Production & AV', 'venue_production'),
  ('Equipment (Capital)', 'venue_production'),
  ('Materials & Consumables', 'programme'),
  ('F&B – Participants', 'programme'),
  ('Prizes & Gifts', 'programme'),
  ('Manpower – External', 'people'),
  ('Honoraria & Team Payments', 'people'),
  ('F&B – Team', 'people'),
  ('Marketing & Content', 'marketing'),
  ('Merch & Wristbands', 'marketing'),
  ('Transport & Logistics', 'operations'),
  ('Software & Subscriptions', 'operations'),
  ('Admin & Fees', 'operations'),
  ('Miscellaneous', 'operations')
on conflict (name) do update set category_group = excluded.category_group, active = true;
