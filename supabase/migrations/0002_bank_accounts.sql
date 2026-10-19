-- New Normal's bank accounts (today, two joint-alternate DBS accounts) and an append-only ledger of
-- what goes in and out of them, so Finance can compare the expected balance with DBS iBanking.
--
-- Only Finance and admins (private.is_finance()) can see or change any of it: no other member, not
-- even a claimant, learns which account paid them. Entries are never edited or deleted; a mistake
-- is corrected with an adjustment, so the ledger always explains the balance. Every write goes
-- through the functions below, which check the caller and stamp who did it.

create type public.bank_entry_kind as enum ('opening', 'grant', 'payout', 'adjustment', 'transfer_in', 'transfer_out');

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 80),
  bank text not null default 'DBS' check (length(btrim(bank)) between 1 and 40),
  -- Only the last four digits, enough to tell the accounts apart; never the full number.
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.bank_entries (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.bank_accounts (id),
  kind public.bank_entry_kind not null,
  -- Signed: money in is positive, money out negative.
  amount_cents bigint not null check (abs(amount_cents) <= 100000000000),
  entry_date date not null,
  note text check (length(note) <= 300),
  claim_id uuid unique references public.claims (id), -- payouts only: one per claim
  transfer_id uuid,                                    -- pairs a transfer's two entries
  actor_id uuid references public.members (id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default now(),
  check (case kind
    when 'opening' then amount_cents >= 0
    when 'grant' then amount_cents > 0
    when 'transfer_in' then amount_cents > 0
    when 'payout' then amount_cents < 0
    when 'transfer_out' then amount_cents < 0
    when 'adjustment' then amount_cents <> 0
  end),
  check ((kind = 'payout') = (claim_id is not null)),
  check ((kind in ('transfer_in', 'transfer_out')) = (transfer_id is not null)),
  check (kind not in ('adjustment', 'grant') or length(btrim(note)) >= 3)
);
create unique index bank_entries_one_opening on public.bank_entries (account_id) where kind = 'opening';
create index bank_entries_account_idx on public.bank_entries (account_id, entry_date desc, id desc);

alter table public.bank_accounts enable row level security;
alter table public.bank_entries enable row level security;

revoke all on public.bank_accounts, public.bank_entries from anon, authenticated;
grant select on public.bank_accounts, public.bank_entries to authenticated;
grant update (name, active) on public.bank_accounts to authenticated;

create policy bank_accounts_finance on public.bank_accounts for select to authenticated using (private.is_finance());
create policy bank_accounts_rename on public.bank_accounts for update to authenticated
  using (private.is_finance()) with check (private.is_finance());
create policy bank_entries_finance on public.bank_entries for select to authenticated using (private.is_finance());

-- Expected balance: the sum of the ledger, never stored. security_invoker, so the policies above
-- decide (everyone but Finance and admins gets no rows).
create view public.bank_balances with (security_invoker = true) as
select a.id as account_id, a.name, a.bank, a.last4, a.active,
       coalesce(sum(e.amount_cents), 0)::bigint as balance_cents,
       max(e.entry_date) as last_entry_date
from public.bank_accounts a
left join public.bank_entries e on e.account_id = a.id
group by a.id;

revoke all on public.bank_balances from anon, authenticated;
grant select on public.bank_balances to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------------------------

-- The signed-in Finance member or admin, or an error.
create function private.finance_me() returns public.members
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.members := private.me();
begin
  if v_me.id is null or not private.is_finance() then
    raise exception 'Only Finance can manage bank accounts.' using errcode = '42501';
  end if;
  return v_me;
end $$;

create function private.sg_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Singapore')::date
$$;

create function private.active_account(p_account uuid) returns public.bank_accounts
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.bank_accounts;
begin
  select * into v from public.bank_accounts a where a.id = p_account;
  if v.id is null then
    raise exception 'Choose a bank account.' using errcode = 'P0002';
  end if;
  if not v.active then
    raise exception 'That bank account is closed.';
  end if;
  return v;
end $$;

revoke all on function private.finance_me(), private.sg_today(), private.active_account(uuid) from public, authenticated;

-- Adds an account and its opening balance together.
create function public.add_bank_account(p_name text, p_bank text, p_last4 text, p_opening_cents bigint, p_as_of date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_id uuid;
begin
  if p_opening_cents is null or p_opening_cents < 0 then
    raise exception 'Enter the opening balance.';
  end if;
  insert into public.bank_accounts (name, bank, last4)
  values (btrim(p_name), coalesce(nullif(btrim(p_bank), ''), 'DBS'), btrim(p_last4))
  returning id into v_id;
  insert into public.bank_entries (account_id, kind, amount_cents, entry_date, note, actor_id, actor_name)
  values (v_id, 'opening', p_opening_cents, coalesce(p_as_of, private.sg_today()), 'Opening balance', v_me.id, v_me.name);
  return v_id;
end $$;

-- Money in (a grant or other income) or a correction to match the bank. Both need a note.
create function public.record_bank_entry(p_account uuid, p_kind public.bank_entry_kind, p_amount_cents bigint,
  p_date date, p_note text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_account public.bank_accounts := private.active_account(p_account);
  v_id bigint;
begin
  if p_kind not in ('grant', 'adjustment') then
    raise exception 'Record grants and adjustments here; payouts and transfers have their own steps.';
  end if;
  if p_amount_cents is null or p_amount_cents = 0 or (p_kind = 'grant' and p_amount_cents < 0) then
    raise exception 'Enter a valid amount.';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Add a note saying what this is.';
  end if;
  if p_date > private.sg_today() then
    raise exception 'The date can''t be in the future.';
  end if;
  insert into public.bank_entries (account_id, kind, amount_cents, entry_date, note, actor_id, actor_name)
  values (v_account.id, p_kind, p_amount_cents, coalesce(p_date, private.sg_today()), btrim(p_note), v_me.id, v_me.name)
  returning id into v_id;
  return v_id;
end $$;

-- Moves money from one account to the other: two entries sharing a transfer_id.
create function public.transfer_between_accounts(p_from uuid, p_to uuid, p_amount_cents bigint, p_date date, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_from public.bank_accounts := private.active_account(p_from);
  v_to public.bank_accounts := private.active_account(p_to);
  v_transfer uuid := gen_random_uuid();
  v_date date := coalesce(p_date, private.sg_today());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_from.id = v_to.id then
    raise exception 'Choose two different accounts.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Enter a valid amount.';
  end if;
  if v_date > private.sg_today() then
    raise exception 'The date can''t be in the future.';
  end if;
  insert into public.bank_entries (account_id, kind, amount_cents, entry_date, note, transfer_id, actor_id, actor_name) values
    (v_from.id, 'transfer_out', -p_amount_cents, v_date, coalesce(v_note, 'Transfer to ' || v_to.name), v_transfer, v_me.id, v_me.name),
    (v_to.id, 'transfer_in', p_amount_cents, v_date, coalesce(v_note, 'Transfer from ' || v_from.name), v_transfer, v_me.id, v_me.name);
  return v_transfer;
end $$;

-- Paying a claim now says which account the money left, and takes it off that account's balance in
-- the same transaction. The claim's own history (which its claimant and reviewers see) gets only the
-- bank reference, never the account.
drop function public.mark_paid(uuid, text);

create function public.mark_paid(p_claim uuid, p_reference text, p_account uuid)
returns table (claimant_email text, claimant_name text, amount_cents bigint, pool_name text, status public.claim_status)
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members;
  v_claim public.claims;
  v_account public.bank_accounts;
  v_ref text := btrim(coalesce(p_reference, ''));
begin
  v_me := private.me();
  if v_me.id is null or not private.is_finance() then
    raise exception 'Only Finance can record payments.' using errcode = '42501';
  end if;
  select * into v_claim from public.claims c where c.id = p_claim for update;
  if v_claim.id is null then
    raise exception 'Claim not found.' using errcode = 'P0002';
  end if;
  if v_claim.status <> 'approved' then
    raise exception 'Only approved claims can be marked as paid.';
  end if;
  if length(v_ref) < 3 or length(v_ref) > 100 then
    raise exception 'Enter the bank transaction reference.';
  end if;
  v_account := private.active_account(p_account);

  update public.claims c set status = 'paid', payment_reference = v_ref, updated_at = now()
   where c.id = v_claim.id;
  insert into public.claim_events (claim_id, actor_id, actor_name, action, note)
  values (v_claim.id, v_me.id, v_me.name, 'paid', v_ref);
  insert into public.bank_entries (account_id, kind, amount_cents, entry_date, note, claim_id, actor_id, actor_name)
  values (v_account.id, 'payout', -v_claim.amount_cents, private.sg_today(),
          left(v_claim.claimant_name || ' · ' || v_ref, 300), v_claim.id, v_me.id, v_me.name);

  return query
    select m.email, v_claim.claimant_name, v_claim.amount_cents, p.name, 'paid'::public.claim_status
    from public.members m, public.pools p
    where m.id = v_claim.claimant_id and p.id = v_claim.pool_id;
end $$;

revoke all on function public.add_bank_account(text, text, text, bigint, date),
  public.record_bank_entry(uuid, public.bank_entry_kind, bigint, date, text),
  public.transfer_between_accounts(uuid, uuid, bigint, date, text),
  public.mark_paid(uuid, text, uuid) from public, anon;
grant execute on function public.add_bank_account(text, text, text, bigint, date),
  public.record_bank_entry(uuid, public.bank_entry_kind, bigint, date, text),
  public.transfer_between_accounts(uuid, uuid, bigint, date, text),
  public.mark_paid(uuid, text, uuid) to authenticated;
