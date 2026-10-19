-- Part 5: importing claims that were paid before this app existed.
--
-- Finance imports a batch of past, already-paid claims (from a spreadsheet) in one transaction:
-- each becomes a paid claim credited to its member, counts against its budget's guideline, and
-- takes its payout off the bank account it was paid from (dated the day it was paid). A payment
-- dated before that account's opening balance is refused: it's already in that balance.
--
-- Imported claims carry no payout details (they were never needed here) and may start without
-- receipts; Finance can attach files to them later with attach_claim_files.

alter table public.claims add column imported boolean not null default false;

-- Imported claims may have no files and no payout details; every other claim still must.
alter table public.claims drop constraint claims_attachment_paths_check;
alter table public.claims add constraint claims_attachment_paths_check
  check (cardinality(attachment_paths) <= 5 and (imported or cardinality(attachment_paths) >= 1));
alter table public.claims alter column payout_type drop not null,
  alter column payout_masked drop not null, alter column payout_enc drop not null;
alter table public.claims add constraint claims_payout_present
  check (imported or (payout_type is not null and payout_masked is not null and payout_enc is not null));

-- Everyone who reads claims reads the flag; nobody sets it through the API (no insert grant), so a
-- claimant can't skip the checks below.
grant select (imported) on public.claims to authenticated;

-- The claim trigger fills and checks what a claimant submits. An imported claim is inserted by
-- import_paid_claims, which has already checked and filled everything itself.
create or replace function private.claims_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.me();
  v_budget public.budgets;
  v_path text;
begin
  if new.imported then
    if v_me.id is null or v_me.role <> 'finance' then
      raise exception 'Only Finance can import claims.' using errcode = '42501';
    end if;
    return new;
  end if;
  if v_me.id is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if new.kind = 'invoice' and v_me.role = 'volunteer' then
    raise exception 'Only division leads and Finance can submit vendor invoices.' using errcode = '42501';
  end if;

  -- FOR SHARE: a concurrent move of this budget to another division waits for this claim, then
  -- budgets_before_update sees it and refuses; or the move goes first and this claim takes the new one.
  select * into v_budget from public.budgets b where b.id = new.budget_id for share;
  if v_budget.id is null or not v_budget.active then
    raise exception 'That budget is not open for claims.';
  end if;
  -- FOR SHARE: the category can't be unprovisioned until this claim is in (then the foreign key
  -- keeps it).
  perform 1 from public.budget_categories bc
   where bc.budget_id = new.budget_id and bc.category_id = new.category_id for share;
  if not found or not exists (select 1 from public.categories c where c.id = new.category_id and c.active) then
    raise exception 'This budget doesn''t provide for that category. Choose one of its categories.';
  end if;
  if new.expense_date > private.sg_today() then
    raise exception 'The purchase date can''t be in the future.';
  end if;
  if new.payout_type is null or new.payout_masked is null or new.payout_enc is null then
    raise exception 'Enter your payout details.';
  end if;

  foreach v_path in array new.attachment_paths loop
    if v_path not like v_me.id::text || '/%' or v_path like '%..%' then
      raise exception 'Invalid attachment.' using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'receipts' and o.name = v_path) then
      raise exception 'Upload the receipt first.';
    end if;
  end loop;

  new.claimant_id := v_me.id;
  new.claimant_name := v_me.name;
  new.division_id := v_budget.division_id;
  new.status := case when v_me.role = 'volunteer' then 'pending_review' else 'pending_finance' end;
  new.rejection_reason := null;
  new.payment_reference := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.claims_before_insert() from public, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Imports a batch of paid claims, all or nothing. p_rows is a JSON array of
-- {email, budget, category, description, amount_cents, expense_date?, paid_on, reference, account},
-- where budget, category and account are names as shown in the app (case-insensitive). Errors name
-- the row (1 = the first data row). Returns how many claims were imported.
-- ---------------------------------------------------------------------------------------------
create function public.import_paid_claims(p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_row jsonb;
  v_n int := 0;
  v_member public.members;
  v_budget public.budgets;
  v_category uuid;
  v_account public.bank_accounts;
  v_amount bigint;
  v_paid date;
  v_expense date;
  v_ref text;
  v_desc text;
  v_claim uuid;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then
    raise exception 'Import between 1 and 1,000 rows at a time.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_n := v_n + 1;
    select * into v_member from public.members m where m.email = lower(btrim(v_row ->> 'email'));
    if v_member.id is null then
      raise exception 'Row %: no member has the email %. Add them on the People page first.', v_n, v_row ->> 'email';
    end if;
    begin
      select * into strict v_budget from public.budgets b
       where lower(b.name) = lower(btrim(v_row ->> 'budget'));
    exception
      when no_data_found then
        raise exception 'Row %: no budget is called "%".', v_n, v_row ->> 'budget';
      when too_many_rows then
        raise exception 'Row %: more than one budget is called "%". Rename one before importing.', v_n, v_row ->> 'budget';
    end;
    begin
      select bc.category_id into strict v_category from public.budget_categories bc
        join public.categories c on c.id = bc.category_id
       where bc.budget_id = v_budget.id and lower(c.name) = lower(btrim(v_row ->> 'category'));
    exception
      when no_data_found then
        raise exception 'Row %: the budget "%" doesn''t provide for the category "%".', v_n, v_budget.name, v_row ->> 'category';
      when too_many_rows then
        raise exception 'Row %: the budget "%" provides more than one category called "%". Rename one before importing.', v_n, v_budget.name, v_row ->> 'category';
    end;
    begin
      select * into strict v_account from public.bank_accounts a
       where lower(a.name) = lower(btrim(v_row ->> 'account'));
    exception
      when no_data_found then
        raise exception 'Row %: no bank account is called "%".', v_n, v_row ->> 'account';
      when too_many_rows then
        raise exception 'Row %: more than one bank account is called "%". Rename one before importing.', v_n, v_row ->> 'account';
    end;

    v_amount := (v_row ->> 'amount_cents')::bigint;
    if v_amount is null or v_amount <= 0 or v_amount > 100000000 then
      raise exception 'Row %: enter a valid amount.', v_n;
    end if;
    v_paid := (v_row ->> 'paid_on')::date;
    if v_paid is null then
      raise exception 'Row %: enter the date it was paid.', v_n;
    end if;
    begin
      perform private.check_entry_date(v_account, v_paid);
    exception when raise_exception then
      raise exception 'Row %: %', v_n, sqlerrm;
    end;
    v_expense := nullif(v_row ->> 'expense_date', '')::date;
    if v_expense > v_paid then
      raise exception 'Row %: the purchase date is after the date it was paid.', v_n;
    end if;
    v_ref := btrim(coalesce(v_row ->> 'reference', ''));
    if length(v_ref) not between 3 and 100 then
      raise exception 'Row %: enter the bank transaction reference.', v_n;
    end if;
    v_desc := btrim(coalesce(v_row ->> 'description', ''));
    if length(v_desc) not between 3 and 500 then
      raise exception 'Row %: add a description (3 to 500 characters).', v_n;
    end if;

    insert into public.claims (kind, status, claimant_id, claimant_name, division_id, budget_id, category_id,
      description, amount_cents, expense_date, attachment_paths, payment_reference, submission_id, imported,
      created_at, updated_at)
    values ('reimbursement', 'paid', v_member.id, v_member.name, v_budget.division_id, v_budget.id, v_category,
      v_desc, v_amount, v_expense, '{}', v_ref, gen_random_uuid(), true,
      v_paid::timestamptz, now())
    returning id into v_claim;
    -- claims_after_insert has logged 'submitted' under the claimant; record the payment too.
    insert into public.claim_events (claim_id, actor_id, actor_name, action, note)
    values (v_claim, v_me.id, v_me.name, 'paid', 'Imported · ' || v_ref);
    insert into public.bank_entries (account_id, kind, amount_cents, entry_date, note, claim_id, actor_id, actor_name)
    values (v_account.id, 'payout', -v_amount, v_paid, left(v_member.name || ' · ' || v_ref || ' (imported)', 300),
      v_claim, v_me.id, v_me.name);
  end loop;
  return v_n;
end $$;

-- Attaches receipts to an imported claim afterwards. The files must be Finance's own uploads, and a
-- claim keeps at most 5.
create function public.attach_claim_files(p_claim uuid, p_paths text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.finance_me();
  v_claim public.claims;
  v_path text;
begin
  select * into v_claim from public.claims c where c.id = p_claim for update;
  if v_claim.id is null then
    raise exception 'Claim not found.' using errcode = 'P0002';
  end if;
  if not v_claim.imported then
    raise exception 'Only imported claims can have files added later.';
  end if;
  if coalesce(cardinality(p_paths), 0) = 0 or cardinality(v_claim.attachment_paths) + cardinality(p_paths) > 5 then
    raise exception 'A claim can have at most 5 files.';
  end if;
  foreach v_path in array p_paths loop
    if v_path not like v_me.id::text || '/%' or v_path like '%..%' then
      raise exception 'Invalid attachment.' using errcode = '42501';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'receipts' and o.name = v_path) then
      raise exception 'Upload the file first.';
    end if;
  end loop;
  update public.claims c set attachment_paths = c.attachment_paths || p_paths, updated_at = now() where c.id = p_claim;
end $$;

revoke all on function public.import_paid_claims(jsonb), public.attach_claim_files(uuid, text[]) from public, anon;
grant execute on function public.import_paid_claims(jsonb), public.attach_claim_files(uuid, text[]) to authenticated;
