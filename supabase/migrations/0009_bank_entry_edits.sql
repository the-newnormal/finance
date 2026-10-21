-- Part 9: Finance edits ledger entries, and a payout's edit corrects its claim.
--
-- Until now the ledger (0004) was append-only: a mistake was corrected with an adjustment. Finance
-- can now correct an entry itself: its amount, date, note and account, and a payout's bank
-- reference. Every edit needs a reason and is kept in bank_entry_edits (what it was, what it
-- became, who, when, why), which nobody changes, so the ledger still explains every balance.
--
-- A payout is its claim's payment, so editing one corrects the claim too: its amount (the budget's
-- spending follows, as it is computed from claims), its payment reference and its paid date. The
-- claim's history, which its claimant and leads see, says what changed but never which account
-- paid it. A transfer's two entries are edited together. An opening balance and a transfer stay on
-- their accounts. Entries on a closed account, or moved to one, are refused: reopen it first.

create table public.bank_entry_edits (
  id bigint generated always as identity primary key,
  entry_id bigint not null references public.bank_entries (id),
  actor_id uuid references public.members (id) on delete set null,
  actor_name text not null,
  reason text not null check (length(btrim(reason)) between 3 and 300),
  -- The entry's account_id, amount_cents, entry_date and note before and after.
  before jsonb not null,
  after jsonb not null,
  at timestamptz not null default now()
);
create index bank_entry_edits_entry_idx on public.bank_entry_edits (entry_id, at);

alter table public.bank_entry_edits enable row level security;
revoke all on public.bank_entry_edits from anon, authenticated;
grant select on public.bank_entry_edits to authenticated;
create policy bank_entry_edits_finance on public.bank_entry_edits for select to authenticated using (private.is_finance());

-- The claim's history records the correction.
alter table public.claim_events drop constraint claim_events_action_check;
alter table public.claim_events add constraint claim_events_action_check
  check (action in ('submitted', 'reviewed', 'approved', 'rejected', 'paid', 'edited'));

create function private.sgd(p_cents bigint) returns text
language sql stable set search_path = '' as $$
  select '$' || to_char(p_cents / 100.0, 'FM999,999,999,990.00')
$$;

-- Moves a claim event to another day, keeping its time of day (in Singapore).
create function private.on_day(p_at timestamptz, p_day date) returns timestamptz
language sql stable set search_path = '' as $$
  select (p_day + (p_at at time zone 'Asia/Singapore')::time) at time zone 'Asia/Singapore'
$$;

revoke all on function private.sgd(bigint), private.on_day(timestamptz, date) from public, authenticated;

-- Edits one entry (and a transfer's other entry with it). p_amount_cents is signed, as stored:
-- money in positive, money out negative. Nulls keep what the entry has. p_reference is for payouts
-- only: their note is the claimant's name and the reference, as mark_paid writes it. Returns the
-- payout's claim, if any, so the server can refresh its page.
create function public.edit_bank_entry(p_entry bigint, p_account uuid, p_amount_cents bigint, p_date date,
  p_note text, p_reference text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_entry public.bank_entries;
  v_transfer uuid;
  v_pair public.bank_entries;
  v_pair_before public.bank_entries;
  v_account public.bank_accounts;
  v_pair_account public.bank_accounts;
  v_claim public.claims;
  v_amount bigint;
  v_date date;
  v_note text;
  v_ref text;
  v_changes text[] := '{}';
begin
  if length(v_reason) not between 3 and 300 then
    raise exception 'Say why you''re changing it.';
  end if;
  -- A transfer's two entries are locked together, the lower id first, so editing its two sides at
  -- once can't deadlock. (transfer_id never changes, so reading it unlocked is safe.)
  select e.transfer_id into v_transfer from public.bank_entries e where e.id = p_entry;
  if v_transfer is not null then
    perform 1 from public.bank_entries e where e.transfer_id = v_transfer order by e.id for update;
    select * into v_pair from public.bank_entries e where e.transfer_id = v_transfer and e.id <> p_entry;
  end if;
  select * into v_entry from public.bank_entries e where e.id = p_entry for update;
  if v_entry.id is null then
    raise exception 'Entry not found.' using errcode = 'P0002';
  end if;

  -- Both accounts open (and locked FOR SHARE until this commits, like every other write).
  v_account := private.active_account(v_entry.account_id);
  if p_account is not null and p_account <> v_entry.account_id then
    if v_entry.kind in ('opening', 'transfer_in', 'transfer_out') then
      raise exception 'An opening balance or a transfer stays on its account.';
    end if;
    v_account := private.active_account(p_account);
  end if;
  if v_pair.id is not null then
    v_pair_account := private.active_account(v_pair.account_id);
  end if;

  v_amount := coalesce(p_amount_cents, v_entry.amount_cents);
  -- In parentheses: PL/pgSQL would otherwise end the IF's condition at the CASE's first THEN.
  if (case v_entry.kind
        when 'opening' then v_amount < 0
        when 'grant' then v_amount <= 0
        when 'transfer_in' then v_amount <= 0
        when 'payout' then v_amount >= 0
        when 'transfer_out' then v_amount >= 0
        when 'adjustment' then v_amount = 0
      end) or abs(v_amount) > 100000000000 then
    raise exception 'Enter a valid amount.';
  end if;

  v_date := coalesce(p_date, v_entry.entry_date);
  if v_entry.kind = 'opening' then
    if v_date > private.sg_today() then
      raise exception 'The date can''t be in the future.';
    end if;
    if exists (select 1 from public.bank_entries e
               where e.account_id = v_entry.account_id and e.id <> v_entry.id and e.entry_date < v_date) then
      raise exception 'The opening balance must be dated on or before the account''s first entry.';
    end if;
  else
    perform private.check_entry_date(v_account, v_date);
    if v_pair.id is not null then
      perform private.check_entry_date(v_pair_account, v_date);
    end if;
  end if;

  if v_entry.kind = 'payout' then
    select * into v_claim from public.claims c where c.id = v_entry.claim_id for update;
    if -v_amount > 100000000 then
      raise exception 'A single claim can be at most $1,000,000.';
    end if;
    if v_date < v_claim.expense_date then
      raise exception 'The payment date is before the purchase date (%).', to_char(v_claim.expense_date, 'DD Mon YYYY');
    end if;
    if not v_claim.imported and v_date < (v_claim.created_at at time zone 'Asia/Singapore')::date then
      raise exception 'The payment date is before the claim was submitted (%).',
        to_char((v_claim.created_at at time zone 'Asia/Singapore')::date, 'DD Mon YYYY');
    end if;
    v_ref := coalesce(nullif(btrim(coalesce(p_reference, '')), ''), v_claim.payment_reference);
    if length(coalesce(v_ref, '')) not between 3 and 100 then
      raise exception 'Enter the bank transaction reference.';
    end if;
    v_note := left(v_claim.claimant_name || ' · ' || v_ref || case when v_claim.imported then ' (imported)' else '' end, 300);
  elsif v_entry.kind = 'opening' then
    v_note := v_entry.note;
  elsif v_entry.kind in ('transfer_in', 'transfer_out') then
    -- A blank note gives each side its default, as transfer_between_accounts does.
    v_note := coalesce(nullif(btrim(coalesce(p_note, v_entry.note)), ''),
      case v_entry.kind when 'transfer_out' then 'Transfer to ' else 'Transfer from ' end
        || (select a.name from public.bank_accounts a where a.id = v_pair.account_id));
  else
    v_note := btrim(coalesce(p_note, v_entry.note, ''));
    if length(v_note) < 3 then
      raise exception 'Add a note saying what this is.';
    end if;
  end if;
  if length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters.';
  end if;

  if v_account.id = v_entry.account_id and v_amount = v_entry.amount_cents and v_date = v_entry.entry_date
     and v_note is not distinct from v_entry.note then
    raise exception 'Nothing has changed.';
  end if;

  update public.bank_entries e set account_id = v_account.id, amount_cents = v_amount, entry_date = v_date, note = v_note
   where e.id = v_entry.id;
  insert into public.bank_entry_edits (entry_id, actor_id, actor_name, reason, before, after)
  values (v_entry.id, v_me.id, v_me.name, v_reason,
    jsonb_build_object('account_id', v_entry.account_id, 'amount_cents', v_entry.amount_cents, 'entry_date', v_entry.entry_date, 'note', v_entry.note),
    jsonb_build_object('account_id', v_account.id, 'amount_cents', v_amount, 'entry_date', v_date, 'note', v_note));

  -- The other side of a transfer: the same amount the other way and the same date. Its note changes
  -- only if this side's did: to its own default if the note was cleared, or else to the new note
  -- (as transfer_between_accounts gives both sides a typed note).
  if v_pair.id is not null then
    v_pair_before := v_pair;
    update public.bank_entries e
       set amount_cents = -v_amount, entry_date = v_date,
           note = case when v_note is not distinct from v_entry.note then e.note
                       when nullif(btrim(coalesce(p_note, '')), '') is null
                         then case e.kind when 'transfer_out' then 'Transfer to ' else 'Transfer from ' end || v_account.name
                       else v_note end
     where e.id = v_pair.id
    returning * into v_pair;
    insert into public.bank_entry_edits (entry_id, actor_id, actor_name, reason, before, after)
    values (v_pair.id, v_me.id, v_me.name, v_reason,
      jsonb_build_object('account_id', v_pair_before.account_id, 'amount_cents', v_pair_before.amount_cents,
        'entry_date', v_pair_before.entry_date, 'note', v_pair_before.note),
      jsonb_build_object('account_id', v_pair.account_id, 'amount_cents', v_pair.amount_cents,
        'entry_date', v_pair.entry_date, 'note', v_pair.note));
  end if;

  if v_claim.id is not null then
    if -v_amount <> v_claim.amount_cents then
      v_changes := v_changes || format('Amount corrected from %s to %s', private.sgd(v_claim.amount_cents), private.sgd(-v_amount));
    end if;
    if v_date <> v_entry.entry_date then
      v_changes := v_changes || format('Paid date corrected from %s to %s', to_char(v_entry.entry_date, 'DD Mon YYYY'), to_char(v_date, 'DD Mon YYYY'));
      update public.claim_events e set at = private.on_day(e.at, v_date) where e.claim_id = v_claim.id and e.action = 'paid';
      -- An imported claim is dated the day it was paid (0005), so it moves with it.
      if v_claim.imported then
        update public.claim_events e set at = private.on_day(e.at, v_date) where e.claim_id = v_claim.id and e.action = 'submitted';
        update public.claims c set created_at = private.on_day(c.created_at, v_date) where c.id = v_claim.id;
      end if;
    end if;
    if v_ref is distinct from v_claim.payment_reference then
      v_changes := v_changes || format('Reference corrected to %s', v_ref);
    end if;
    update public.claims c set amount_cents = -v_amount, payment_reference = v_ref, updated_at = now() where c.id = v_claim.id;
    -- The account is never named here: the claim's history is the claimant's to see.
    if cardinality(v_changes) > 0 then
      insert into public.claim_events (claim_id, actor_id, actor_name, action, note)
      values (v_claim.id, v_me.id, v_me.name, 'edited', array_to_string(v_changes, '; '));
    end if;
  end if;
  return v_claim.id;
end $$;

revoke all on function public.edit_bank_entry(bigint, uuid, bigint, date, text, text, text) from public, anon;
grant execute on function public.edit_bank_entry(bigint, uuid, bigint, date, text, text, text) to authenticated;
