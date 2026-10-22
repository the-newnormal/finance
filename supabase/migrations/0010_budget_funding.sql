-- Part 10: funding budgets. Grants, loans from the reserve, and repayments.
--
-- A budget is usually backed by grant monies the government has committed to Normal, but they take
-- time to reach our accounts. So each budget now keeps a virtual balance: a number we track, not a
-- bank account. What it can spend (available) is:
--
--   grants received + loans from the reserve − repayments to the reserve − approved − disbursed
--
-- budget_funds is its append-only list of grants, loans and repayments, written only by Finance
-- through the functions below:
--   record_grant          grant monies arrive: into one of our bank accounts (a 'grant' bank entry,
--                         as before) and onto the budget's balance. Correcting that bank entry
--                         (edit_bank_entry) corrects the grant too.
--   loan_from_reserve     the reserve lends a budget money until its grant arrives.
--   repay_reserve         the budget pays its loans back once it can.
-- A budget also records the grant committed to it (grant_committed_cents), to show what's still due.
--
-- From now on money leaves the reserve only through a claim or a loan: additions to it must be
-- positive (a mistake is corrected by a loan repaid, never a negative addition). Its available
-- funds are its additions, less its approved and disbursed claims, less what it has lent and not
-- had back. Claims are never blocked by a short balance: Finance is warned (src/app) instead.

alter table public.budgets add column grant_committed_cents bigint not null default 0
  check (grant_committed_cents >= 0 and grant_committed_cents <= 100000000000);

-- Do not expose commitments through the ordinary budget table.  They are available through
-- budget_totals, whose purview filter below is the funding visibility boundary.
revoke select on public.budgets from authenticated;
grant select (id, name, kind, division_id, active, created_at, is_reserve) on public.budgets to authenticated;

create type public.budget_fund_kind as enum ('grant', 'loan', 'repayment');

create table public.budget_funds (
  id bigint generated always as identity primary key,
  budget_id uuid not null references public.budgets (id),
  kind public.budget_fund_kind not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  entry_date date not null,
  note text not null check (length(btrim(note)) between 3 and 300),
  -- Grants only: the bank entry the money arrived as.
  bank_entry_id bigint unique references public.bank_entries (id),
  actor_id uuid references public.members (id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default now(),
  check ((kind = 'grant') = (bank_entry_id is not null))
);
create index budget_funds_budget_idx on public.budget_funds (budget_id, entry_date, id);

alter table public.budget_funds enable row level security;
revoke all on public.budget_funds from anon, authenticated;
grant select on public.budget_funds to authenticated;
-- The division's leads and Finance, like the budget's other amounts.
create policy budget_funds_select on public.budget_funds for select to authenticated
  using (private.budget_in_purview(budget_id));

-- Reserve additions are money in only, from now on. (NOT VALID: earlier corrections stay as they were.)
alter table public.reserve_additions add constraint reserve_additions_money_in check (amount_cents > 0) not valid;

-- Corrections are separate, audited entries: additions remain immutable and money-in only.
create table public.reserve_addition_corrections (
  id bigint generated always as identity primary key,
  addition_id bigint not null references public.reserve_additions (id),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  corrected_on date not null,
  note text not null check (length(btrim(note)) between 3 and 300),
  actor_id uuid references public.members (id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default now()
);
alter table public.reserve_addition_corrections enable row level security;
revoke all on public.reserve_addition_corrections from anon, authenticated;
grant select on public.reserve_addition_corrections to authenticated;
create policy reserve_addition_corrections_finance on public.reserve_addition_corrections
  for select to authenticated using (private.is_finance());

create function public.correct_reserve_addition(p_addition_id bigint, p_amount_cents bigint,
  p_date date, p_note text) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_addition public.reserve_additions;
  v_corrected bigint;
  v_id bigint;
begin
  select * into v_addition from public.reserve_additions where id = p_addition_id for update;
  if v_addition.id is null then raise exception 'That reserve addition was not found.'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Enter a valid correction amount.'; end if;
  select coalesce(sum(amount_cents), 0) into v_corrected
    from public.reserve_addition_corrections where addition_id = p_addition_id;
  if p_amount_cents > v_addition.amount_cents - v_corrected then
    raise exception 'The correction is larger than the remaining addition.';
  end if;
  if coalesce(p_date, private.sg_today()) > private.sg_today() then raise exception 'The date can''t be in the future.'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Add a note explaining the correction.'; end if;
  insert into public.reserve_addition_corrections (addition_id, amount_cents, corrected_on, note, actor_id, actor_name)
  values (p_addition_id, p_amount_cents, coalesce(p_date, private.sg_today()), left(btrim(p_note), 300), v_me.id, v_me.name)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.correct_reserve_addition(bigint, bigint, date, text) from public, anon;
grant execute on function public.correct_reserve_addition(bigint, bigint, date, text) to authenticated;

create or replace function public.add_to_reserve(p_amount_cents bigint, p_date date, p_note text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_date date := coalesce(p_date, private.sg_today());
  v_id bigint;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Enter a valid amount. Money leaves the reserve only through a claim or a loan.';
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

-- ---------------------------------------------------------------------------------------------
-- Balances. Each function locks what it reads FOR UPDATE, so two loans (or two repayments) can't
-- both pass the same check.
-- ---------------------------------------------------------------------------------------------
-- A budget's available balance (see the top of this file).
create function private.budget_available(p_budget uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(case f.kind when 'repayment' then -f.amount_cents else f.amount_cents end)
                   from public.budget_funds f where f.budget_id = p_budget), 0)
       - coalesce((select sum(c.amount_cents) from public.claims c
                   where c.budget_id = p_budget and c.status in ('approved', 'paid')), 0)
$$;

-- What a budget still owes the reserve.
create function private.budget_owed(p_budget uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case f.kind when 'loan' then f.amount_cents when 'repayment' then -f.amount_cents else 0 end), 0)
  from public.budget_funds f where f.budget_id = p_budget
$$;

-- The reserve's available funds: additions, less its approved and disbursed claims, less loans out.
create function private.reserve_available() returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(r.amount_cents) from public.reserve_additions r), 0)
       - coalesce((select sum(x.amount_cents) from public.reserve_addition_corrections x), 0)
       - coalesce((select sum(c.amount_cents) from public.claims c join public.budgets b on b.id = c.budget_id
                   where b.is_reserve and c.status in ('approved', 'paid')), 0)
       - coalesce((select sum(case f.kind when 'loan' then f.amount_cents else -f.amount_cents end)
                   from public.budget_funds f where f.kind in ('loan', 'repayment')), 0)
$$;

revoke all on function private.budget_available(uuid), private.budget_owed(uuid), private.reserve_available()
  from public, authenticated;

-- The budget to fund: an ordinary one (the reserve is funded by additions), locked FOR UPDATE.
create function private.fundable_budget(p_budget uuid) returns public.budgets
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.budgets;
begin
  select * into v from public.budgets b where b.id = p_budget for update;
  if v.id is null then
    raise exception 'Choose a budget.' using errcode = 'P0002';
  end if;
  if v.is_reserve then
    raise exception 'The reserve is funded by additions on the Reserve page.';
  end if;
  return v;
end $$;

create function private.check_fund(p_amount bigint, p_date date, p_note text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter a valid amount.';
  end if;
  if p_date > private.sg_today() then
    raise exception 'The date can''t be in the future.';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Add a note saying what this is.';
  end if;
end $$;

revoke all on function private.fundable_budget(uuid), private.check_fund(bigint, date, text) from public, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Writes (Finance only)
-- ---------------------------------------------------------------------------------------------
create function public.set_grant_commitment(p_budget uuid, p_cents bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_budget public.budgets := private.fundable_budget(p_budget);
begin
  if p_cents is null or p_cents < 0 or p_cents > 100000000000 then
    raise exception 'Enter a valid amount.';
  end if;
  update public.budgets b set grant_committed_cents = p_cents where b.id = v_budget.id;
end $$;

-- Link a grant already entered in the Bank ledger (including grants from before this migration).
-- This credits the budget without creating a second bank entry.
create function public.link_grant(p_budget uuid, p_bank_entry bigint, p_note text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_budget public.budgets := private.fundable_budget(p_budget);
  v_entry public.bank_entries;
  v_id bigint;
begin
  select * into v_entry from public.bank_entries where id = p_bank_entry for update;
  if v_entry.id is null or v_entry.kind <> 'grant' then raise exception 'Choose an unlinked grant bank entry.'; end if;
  if exists (select 1 from public.budget_funds where bank_entry_id = v_entry.id) then raise exception 'That grant is already linked to a budget.'; end if;
  perform private.check_fund(v_entry.amount_cents, v_entry.entry_date, p_note);
  insert into public.budget_funds (budget_id, kind, amount_cents, entry_date, note, bank_entry_id, actor_id, actor_name)
  values (v_budget.id, 'grant', v_entry.amount_cents, v_entry.entry_date, left(btrim(p_note), 300), v_entry.id, v_me.id, v_me.name)
  returning id into v_id;
  return v_id;
end $$;

-- Grant monies arrive: a 'grant' entry on the bank account, and a grant on the budget, together.
create function public.record_grant(p_budget uuid, p_account uuid, p_amount_cents bigint, p_date date, p_note text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_budget public.budgets := private.fundable_budget(p_budget);
  v_account public.bank_accounts := private.active_account(p_account);
  v_date date := coalesce(p_date, private.sg_today());
  v_entry bigint;
  v_id bigint;
begin
  perform private.check_fund(p_amount_cents, v_date, p_note);
  perform private.check_entry_date(v_account, v_date);
  insert into public.bank_entries (account_id, kind, amount_cents, entry_date, note, actor_id, actor_name)
  values (v_account.id, 'grant', p_amount_cents, v_date, left('Grant for ' || v_budget.name || ' · ' || btrim(p_note), 300),
          v_me.id, v_me.name)
  returning id into v_entry;
  insert into public.budget_funds (budget_id, kind, amount_cents, entry_date, note, bank_entry_id, actor_id, actor_name)
  values (v_budget.id, 'grant', p_amount_cents, v_date, left(btrim(p_note), 300), v_entry, v_me.id, v_me.name)
  returning id into v_id;
  return v_id;
end $$;

-- The reserve lends a budget money. Refused if the reserve doesn't have it available.
create function public.loan_from_reserve(p_budget uuid, p_amount_cents bigint, p_date date, p_note text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_budget public.budgets;
  v_date date := coalesce(p_date, private.sg_today());
  v_available bigint;
  v_id bigint;
begin
  -- The reserve first, so every loan waits for the one before it.
  perform 1 from public.budgets b where b.is_reserve for update;
  v_budget := private.fundable_budget(p_budget);
  perform private.check_fund(p_amount_cents, v_date, p_note);
  v_available := private.reserve_available();
  if p_amount_cents > v_available then
    raise exception 'The reserve has only % available to lend.', private.sgd(greatest(v_available, 0));
  end if;
  insert into public.budget_funds (budget_id, kind, amount_cents, entry_date, note, actor_id, actor_name)
  values (v_budget.id, 'loan', p_amount_cents, v_date, left(btrim(p_note), 300), v_me.id, v_me.name)
  returning id into v_id;
  return v_id;
end $$;

-- A budget repays the reserve: no more than it owes, nor more than it has available.
create function public.repay_reserve(p_budget uuid, p_amount_cents bigint, p_date date, p_note text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_budget public.budgets;
  v_date date := coalesce(p_date, private.sg_today());
  v_owed bigint;
  v_available bigint;
  v_id bigint;
begin
  perform 1 from public.budgets b where b.is_reserve for update;
  v_budget := private.fundable_budget(p_budget);
  perform private.check_fund(p_amount_cents, v_date, p_note);
  v_owed := private.budget_owed(v_budget.id);
  if v_owed <= 0 then
    raise exception 'This budget owes the reserve nothing.';
  end if;
  if p_amount_cents > v_owed then
    raise exception 'This budget owes the reserve only %.', private.sgd(v_owed);
  end if;
  v_available := private.budget_available(v_budget.id);
  if p_amount_cents > v_available then
    raise exception 'This budget has only % available to repay with.', private.sgd(greatest(v_available, 0));
  end if;
  insert into public.budget_funds (budget_id, kind, amount_cents, entry_date, note, actor_id, actor_name)
  values (v_budget.id, 'repayment', p_amount_cents, v_date, left(btrim(p_note), 300), v_me.id, v_me.name)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.set_grant_commitment(uuid, bigint),
  public.link_grant(uuid, bigint, text),
  public.record_grant(uuid, uuid, bigint, date, text),
  public.loan_from_reserve(uuid, bigint, date, text),
  public.repay_reserve(uuid, bigint, date, text) from public, anon;
grant execute on function public.set_grant_commitment(uuid, bigint),
  public.link_grant(uuid, bigint, text),
  public.record_grant(uuid, uuid, bigint, date, text),
  public.loan_from_reserve(uuid, bigint, date, text),
  public.repay_reserve(uuid, bigint, date, text) to authenticated;

-- Correcting a grant's bank entry (edit_bank_entry, 0009) corrects the grant on its budget too.
create function private.bank_entries_sync_grant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.budget_funds f set amount_cents = new.amount_cents, entry_date = new.entry_date
   where f.bank_entry_id = new.id and (f.amount_cents, f.entry_date) is distinct from (new.amount_cents, new.entry_date);
  return null;
end $$;
revoke all on function private.bank_entries_sync_grant() from public, authenticated;

create trigger bank_entries_sync_grant after update on public.bank_entries
  for each row when (new.kind = 'grant') execute function private.bank_entries_sync_grant();

-- ---------------------------------------------------------------------------------------------
-- budget_totals gains the funding columns (appended, so the view can be replaced in place):
--   grant_committed_cents  granted_cents  loaned_cents  repaid_cents
--   available_cents        what the budget (or the reserve) can still spend
--   lent_out_cents         the reserve only: loans out, not yet repaid
-- ---------------------------------------------------------------------------------------------
create or replace view public.budget_totals with (security_invoker = false) as
select
  b.id as budget_id, b.name, b.kind, b.division_id, b.active,
  coalesce(g.guideline_cents, 0)::bigint as guideline_cents,
  coalesce(c.pending_cents, 0)::bigint as pending_cents,
  coalesce(c.approved_cents, 0)::bigint as approved_cents,
  coalesce(c.paid_cents, 0)::bigint as paid_cents,
  b.is_reserve,
  case when b.is_reserve then coalesce((select sum(r.amount_cents) from public.reserve_additions r), 0)
       - coalesce((select sum(x.amount_cents) from public.reserve_addition_corrections x), 0) else 0 end::bigint as funded_cents,
  b.grant_committed_cents,
  coalesce(f.granted_cents, 0)::bigint as granted_cents,
  coalesce(f.loaned_cents, 0)::bigint as loaned_cents,
  coalesce(f.repaid_cents, 0)::bigint as repaid_cents,
  (case when b.is_reserve
        then coalesce((select sum(r.amount_cents) from public.reserve_additions r), 0)
       - coalesce((select sum(x.amount_cents) from public.reserve_addition_corrections x), 0) - coalesce(o.lent_out_cents, 0)
        else coalesce(f.granted_cents, 0) + coalesce(f.loaned_cents, 0) - coalesce(f.repaid_cents, 0) end
   - coalesce(c.approved_cents, 0) - coalesce(c.paid_cents, 0))::bigint as available_cents,
  case when b.is_reserve then coalesce(o.lent_out_cents, 0) else 0 end::bigint as lent_out_cents
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
left join (
  select budget_id,
    sum(amount_cents) filter (where kind = 'grant') as granted_cents,
    sum(amount_cents) filter (where kind = 'loan') as loaned_cents,
    sum(amount_cents) filter (where kind = 'repayment') as repaid_cents
  from public.budget_funds group by budget_id
) f on f.budget_id = b.id
cross join (
  select sum(case kind when 'loan' then amount_cents else -amount_cents end) as lent_out_cents
  from public.budget_funds where kind in ('loan', 'repayment')
) o
where private.in_purview(b.division_id);
