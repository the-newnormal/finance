-- Part 6: the reserve, New Normal's one perpetual budget outside every division.
--
-- Only Finance sees it, claims against it, or tops it up. It has no guidelines: its funds are the
-- sum of the additions Finance records (reserve_additions), and what's available is that less what
-- has been approved or paid from it. It provisions every category, including ones added later, so
-- there is nothing to set up. Its claims belong to no division (division_id is null), which
-- private.in_purview already reads as "Finance only".

alter table public.budgets add column is_reserve boolean not null default false;
alter table public.budgets alter column division_id drop not null;
alter table public.budgets add constraint budgets_reserve_has_no_division check (is_reserve = (division_id is null));
create unique index budgets_one_reserve on public.budgets (is_reserve) where is_reserve;

alter table public.claims alter column division_id drop not null;

insert into public.budgets (name, kind, division_id, is_reserve) values ('Reserve', 'general', null, true);
insert into public.budget_categories (budget_id, category_id)
select b.id, c.id from public.budgets b cross join public.categories c where b.is_reserve;

-- Whether the signed-in member may see a budget at all: every active member sees the ordinary
-- ones (to claim against them); only Finance sees the reserve.
create function private.budget_visible(p_budget uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active() and exists (
    select 1 from public.budgets b where b.id = p_budget and (not b.is_reserve or private.is_finance()))
$$;
revoke all on function private.budget_visible(uuid) from public;
grant execute on function private.budget_visible(uuid) to authenticated;

drop policy budgets_select on public.budgets;
create policy budgets_select on public.budgets for select to authenticated
  using (private.is_active() and (not is_reserve or private.is_finance()));
drop policy budget_categories_select on public.budget_categories;
create policy budget_categories_select on public.budget_categories for select to authenticated
  using (private.budget_visible(budget_id));

-- The reserve stays the reserve: it never gains a division, and no budget becomes it.
create or replace function private.budgets_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_reserve <> old.is_reserve or (old.is_reserve and new.division_id is not null) then
    raise exception 'The reserve can''t become an ordinary budget, nor a budget the reserve.';
  end if;
  if old.is_reserve and not new.active then
    raise exception 'The reserve is always open.';
  end if;
  if new.division_id <> old.division_id and exists (select 1 from public.claims c where c.budget_id = old.id) then
    raise exception 'This budget already has claims, so it can''t move to another division. Close it and create a new one there.';
  end if;
  return new;
end $$;
revoke all on function private.budgets_before_update() from public, authenticated;

-- Every new category is provisioned on the reserve.
create function private.categories_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.budget_categories (budget_id, category_id)
  select b.id, new.id from public.budgets b where b.is_reserve;
  return null;
end $$;
revoke all on function private.categories_after_insert() from public, authenticated;

create trigger categories_after_insert after insert on public.categories
  for each row execute function private.categories_after_insert();

-- Only Finance claims against the reserve. (Others can't see it; this is the database's own check.)
create function private.claims_check_reserve() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.budgets b where b.id = new.budget_id and b.is_reserve)
     and not private.is_finance() then
    raise exception 'Only Finance can claim against the reserve.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.claims_check_reserve() from public, authenticated;

-- Before-insert triggers fire in name order, so claims_before_insert has already checked the
-- budget is open and the category provisioned.
create trigger claims_check_reserve before insert on public.claims
  for each row execute function private.claims_check_reserve();

-- save_budget is for ordinary budgets; the reserve has nothing to set up.
create or replace function public.save_budget(p_id uuid, p_name text, p_kind public.budget_kind, p_division uuid,
  p_active boolean, p_guidelines jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_g jsonb;
  v_keep uuid[] := '{}';
  v_cat uuid;
begin
  if exists (select 1 from public.budgets b where b.id = p_id and b.is_reserve) then
    raise exception 'The reserve takes every category and has no guidelines, so there is nothing to set up.';
  end if;
  if p_division is null then
    raise exception 'Choose a division.';
  end if;
  if jsonb_typeof(p_guidelines) is distinct from 'array' or jsonb_array_length(p_guidelines) not between 1 and 100 then
    raise exception 'Provision at least one spend category.';
  end if;
  if v_id is null then
    insert into public.budgets (name, kind, division_id, active)
    values (btrim(p_name), p_kind, p_division, coalesce(p_active, true))
    returning id into v_id;
  else
    update public.budgets b set name = btrim(p_name), kind = p_kind, division_id = p_division,
      active = coalesce(p_active, true)
     where b.id = v_id;
    if not found then
      raise exception 'That budget wasn''t found.' using errcode = 'P0002';
    end if;
  end if;

  for v_g in select * from jsonb_array_elements(p_guidelines) loop
    v_cat := (v_g ->> 'category_id')::uuid;
    if v_cat = any (v_keep) then
      raise exception 'Each category can be provisioned once per budget.';
    end if;
    insert into public.budget_categories (budget_id, category_id) values (v_id, v_cat) on conflict do nothing;
    insert into public.budget_guidelines (budget_id, category_id, guideline_cents)
    values (v_id, v_cat, (v_g ->> 'guideline_cents')::bigint)
    on conflict (budget_id, category_id) do update set guideline_cents = excluded.guideline_cents;
    v_keep := v_keep || v_cat;
  end loop;

  begin
    delete from public.budget_categories bc where bc.budget_id = v_id and not (bc.category_id = any (v_keep));
  exception when foreign_key_violation then
    raise exception 'A category you removed already has claims against this budget. Keep it, or set its guideline to 0.';
  end;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Topping up the reserve: an append-only list of additions (a negative one corrects a mistake or
-- moves funds out). Finance only; never edited or deleted.
-- ---------------------------------------------------------------------------------------------
create table public.reserve_additions (
  id bigint generated always as identity primary key,
  amount_cents bigint not null check (amount_cents <> 0 and abs(amount_cents) <= 100000000000),
  added_on date not null,
  note text not null check (length(btrim(note)) between 3 and 300),
  actor_id uuid references public.members (id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default now()
);
alter table public.reserve_additions enable row level security;
revoke all on public.reserve_additions from anon, authenticated;
grant select on public.reserve_additions to authenticated;
create policy reserve_additions_finance on public.reserve_additions for select to authenticated using (private.is_finance());

create function public.add_to_reserve(p_amount_cents bigint, p_date date, p_note text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_date date := coalesce(p_date, private.sg_today());
  v_id bigint;
begin
  if p_amount_cents is null or p_amount_cents = 0 then
    raise exception 'Enter a valid amount.';
  end if;
  if v_date > private.sg_today() then
    raise exception 'The date can''t be in the future.';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Add a note saying where the funds come from.';
  end if;
  insert into public.reserve_additions (amount_cents, added_on, note, actor_id, actor_name)
  values (p_amount_cents, v_date, left(btrim(p_note), 300), v_me.id, v_me.name)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.add_to_reserve(bigint, date, text) from public, anon;
grant execute on function public.add_to_reserve(bigint, date, text) to authenticated;

-- budget_totals gains whether a row is the reserve and, for the reserve, its funds (the sum of its
-- additions; 0 for every other budget). in_purview(null) is Finance only, so only Finance gets it.
create or replace view public.budget_totals with (security_invoker = true) as
select
  b.id as budget_id, b.name, b.kind, b.division_id, b.active,
  coalesce(g.guideline_cents, 0)::bigint as guideline_cents,
  coalesce(c.pending_cents, 0)::bigint as pending_cents,
  coalesce(c.approved_cents, 0)::bigint as approved_cents,
  coalesce(c.paid_cents, 0)::bigint as paid_cents,
  b.is_reserve,
  case when b.is_reserve then coalesce((select sum(r.amount_cents) from public.reserve_additions r), 0) else 0 end::bigint as funded_cents
from public.budgets b
left join (select budget_id, sum(guideline_cents) as guideline_cents from public.budget_guidelines group by budget_id) g
  on g.budget_id = b.id
left join (
  select budget_id,
    sum(amount_cents) filter (where status in ('pending_review', 'pending_finance')) as pending_cents,
    sum(amount_cents) filter (where status = 'approved') as approved_cents,
    sum(amount_cents) filter (where status = 'paid') as paid_cents
  from public.claims group by budget_id
) c on c.budget_id = b.id
where private.in_purview(b.division_id);

-- The reserve's provisions are kept by the triggers above and its guidelines don't exist, so Finance's
-- direct writes to both tables apply to ordinary budgets only.
create function private.is_reserve(p_budget uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.budgets b where b.id = p_budget and b.is_reserve)
$$;
revoke all on function private.is_reserve(uuid) from public;
grant execute on function private.is_reserve(uuid) to authenticated;

drop policy budget_categories_finance on public.budget_categories;
create policy budget_categories_finance on public.budget_categories for all to authenticated
  using (private.is_finance() and not private.is_reserve(budget_id))
  with check (private.is_finance() and not private.is_reserve(budget_id));
drop policy budget_guidelines_finance on public.budget_guidelines;
create policy budget_guidelines_finance on public.budget_guidelines for all to authenticated
  using (private.is_finance() and not private.is_reserve(budget_id))
  with check (private.is_finance() and not private.is_reserve(budget_id));
