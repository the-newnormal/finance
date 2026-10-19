-- Part 2: spend categories, budgets, and each budget's spend guidelines.
--
-- Finance creates budgets inside divisions (a division has no money of its own). Each budget
-- provisions the spend categories it allows, each with a guideline amount that spending is
-- monitored against. A claim may only be made against a category its budget provisions: claims
-- reference (budget, category) pairs in budget_categories, so the database itself refuses others.
--
-- Everyone active sees budget names and which categories each provisions (to claim); guideline
-- amounts and spending only the division's leads and Finance.

create type public.budget_kind as enum ('event', 'general');

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 60),
  active boolean not null default true
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  kind public.budget_kind not null default 'event',
  division_id uuid not null references public.divisions (id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index budgets_division_idx on public.budgets (division_id);

-- The categories a budget provisions for.
create table public.budget_categories (
  budget_id uuid not null references public.budgets (id) on delete cascade,
  category_id uuid not null references public.categories (id),
  primary key (budget_id, category_id)
);

-- Each provisioned category's guideline amount, readable only by the division's leads and Finance.
create table public.budget_guidelines (
  budget_id uuid not null,
  category_id uuid not null,
  guideline_cents bigint not null check (guideline_cents >= 0 and guideline_cents <= 100000000000),
  primary key (budget_id, category_id),
  foreign key (budget_id, category_id) references public.budget_categories (budget_id, category_id) on delete cascade
);

-- Whether the signed-in member sees a budget's guidelines and spending.
create function private.budget_in_purview(p_budget uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.in_purview((select b.division_id from public.budgets b where b.id = p_budget))
$$;
revoke all on function private.budget_in_purview(uuid) from public;
grant execute on function private.budget_in_purview(uuid) to authenticated;

-- A claim keeps the division its budget had when it was made (it decides who reviews and sees it),
-- so a budget with claims can't move to another division.
create function private.budgets_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.division_id <> old.division_id and exists (select 1 from public.claims c where c.budget_id = old.id) then
    raise exception 'This budget already has claims, so it can''t move to another division. Close it and create a new one there.';
  end if;
  return new;
end $$;
revoke all on function private.budgets_before_update() from public, authenticated;

create trigger budgets_before_update before update on public.budgets
  for each row execute function private.budgets_before_update();

-- ---------------------------------------------------------------------------------------------
-- Row level security and privileges. Finance writes everything here.
-- ---------------------------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.budgets enable row level security;
alter table public.budget_categories enable row level security;
alter table public.budget_guidelines enable row level security;

revoke all on public.categories, public.budgets, public.budget_categories, public.budget_guidelines from anon, authenticated;
grant select, insert, update on public.categories, public.budgets to authenticated;
grant select, insert, delete on public.budget_categories to authenticated;
grant select, insert, update, delete on public.budget_guidelines to authenticated;

create policy categories_select on public.categories for select to authenticated using (private.is_active());
create policy categories_finance on public.categories for all to authenticated
  using (private.is_finance()) with check (private.is_finance());
create policy budgets_select on public.budgets for select to authenticated using (private.is_active());
create policy budgets_finance on public.budgets for all to authenticated
  using (private.is_finance()) with check (private.is_finance());
create policy budget_categories_select on public.budget_categories for select to authenticated using (private.is_active());
create policy budget_categories_finance on public.budget_categories for all to authenticated
  using (private.is_finance()) with check (private.is_finance());
create policy budget_guidelines_select on public.budget_guidelines for select to authenticated
  using (private.budget_in_purview(budget_id));
create policy budget_guidelines_finance on public.budget_guidelines for all to authenticated
  using (private.is_finance()) with check (private.is_finance());

-- ---------------------------------------------------------------------------------------------
-- A budget and its guidelines are saved together, in one transaction, as Finance (SECURITY INVOKER:
-- RLS decides). p_id null creates one. p_guidelines is a JSON array of {category_id,
-- guideline_cents}, one per provisioned category; a category left out is no longer provisioned,
-- which is refused once claims have been made against it. Returns the budget's id.
-- ---------------------------------------------------------------------------------------------
create function public.save_budget(p_id uuid, p_name text, p_kind public.budget_kind, p_division uuid,
  p_active boolean, p_guidelines jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_g jsonb;
  v_keep uuid[] := '{}';
  v_cat uuid;
begin
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

revoke all on function public.save_budget(uuid, text, public.budget_kind, uuid, boolean, jsonb) from public, anon;
grant execute on function public.save_budget(uuid, text, public.budget_kind, uuid, boolean, jsonb) to authenticated;
