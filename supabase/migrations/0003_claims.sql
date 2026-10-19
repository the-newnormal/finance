-- Part 3: claims (reimbursements and vendor invoices), their history, and receipts.
--
-- A claim moves pending_review -> pending_finance -> approved -> paid, or to rejected from either
-- pending state. Volunteers' claims start at pending_review and need one preliminary approval from
-- a lead of the budget's division (or Finance stepping in); leads' and Finance's claims go straight
-- to pending_finance. Only Finance gives final approval. Nobody reviews their own claim, except
-- that Finance may finalise its own (a small team may have only one Finance member).
--
-- Claims are inserted by their claimant (RLS) and a trigger fills everything the claimant must not
-- choose. Status changes only through decide_claim and mark_paid (0004), which check the caller
-- and log to claim_events; claims has no update grant at all.

create type public.claim_kind as enum ('reimbursement', 'invoice');
create type public.claim_status as enum ('pending_review', 'pending_finance', 'approved', 'rejected', 'paid');

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  kind public.claim_kind not null default 'reimbursement',
  -- Set by claims_before_insert, never by the claimant.
  status public.claim_status not null default 'pending_review',
  claimant_id uuid not null default auth.uid() references public.members (id),
  claimant_name text not null default '',
  division_id uuid not null references public.divisions (id),
  -- Chosen by the claimant: a budget, and one of the categories it provisions.
  budget_id uuid not null references public.budgets (id),
  category_id uuid not null references public.categories (id),
  description text not null check (length(btrim(description)) between 3 and 500),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  expense_date date,
  vendor_name text check (length(btrim(vendor_name)) between 1 and 120),
  due_date date,
  attachment_paths text[] not null check (cardinality(attachment_paths) between 1 and 5),
  payout_type public.payout_type not null,
  payout_masked text not null check (length(payout_masked) <= 60),
  -- Never granted to `authenticated`: Finance reads it through claim_payout_enc().
  payout_enc text not null check (payout_enc like 'v1.%'),
  -- Set by decide_claim / mark_paid.
  rejection_reason text,
  payment_reference text,
  -- A random id the claim form makes once per claim, so a retried submission can't create a second.
  submission_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (budget_id, category_id) references public.budget_categories (budget_id, category_id),
  check ((kind = 'invoice') = (vendor_name is not null)),
  check (kind = 'invoice' or due_date is null)
);
create unique index claims_submission_idx on public.claims (claimant_id, submission_id);
create index claims_claimant_idx on public.claims (claimant_id, created_at desc);
create index claims_status_idx on public.claims (status, created_at);
create index claims_division_idx on public.claims (division_id, status);
create index claims_budget_idx on public.claims (budget_id, category_id);

-- Who did what to a claim, written only by the triggers and functions.
create table public.claim_events (
  id bigint generated always as identity primary key,
  claim_id uuid not null references public.claims (id) on delete cascade,
  actor_id uuid references public.members (id) on delete set null,
  actor_name text not null,
  action text not null check (action in ('submitted', 'reviewed', 'approved', 'rejected', 'paid')),
  note text,
  at timestamptz not null default now()
);
create index claim_events_claim_idx on public.claim_events (claim_id, at);

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------
-- Fills everything a claimant must not choose, and refuses what they may not claim.
create function private.claims_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.me();
  v_budget public.budgets;
  v_path text;
begin
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

create trigger claims_before_insert before insert on public.claims
  for each row execute function private.claims_before_insert();

create function private.claims_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.claim_events (claim_id, actor_id, actor_name, action)
  values (new.id, new.claimant_id, new.claimant_name, 'submitted');
  return null;
end $$;

create trigger claims_after_insert after insert on public.claims
  for each row execute function private.claims_after_insert();

revoke all on function private.claims_before_insert(), private.claims_after_insert() from public, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row level security and privileges
-- ---------------------------------------------------------------------------------------------
alter table public.claims enable row level security;
alter table public.claim_events enable row level security;

-- Your own claims, plus every claim in a division you have purview over.
create policy claims_select on public.claims for select to authenticated
  using ((claimant_id = auth.uid() and private.is_active()) or private.in_purview(division_id));
create policy claims_insert on public.claims for insert to authenticated
  with check (claimant_id = auth.uid() and private.is_active());
create policy claim_events_select on public.claim_events for select to authenticated
  using (exists (select 1 from public.claims c where c.id = claim_id));

-- payout_enc is never readable through the Data API, and claimants set only what they choose.
revoke all on public.claims, public.claim_events from anon, authenticated;
grant select (id, kind, status, claimant_id, claimant_name, division_id, budget_id, category_id,
  description, amount_cents, expense_date, vendor_name, due_date, attachment_paths, payout_type,
  payout_masked, rejection_reason, payment_reference, submission_id, created_at, updated_at)
  on public.claims to authenticated;
grant insert (kind, budget_id, category_id, description, amount_cents, expense_date, vendor_name,
  due_date, attachment_paths, payout_type, payout_masked, payout_enc, submission_id)
  on public.claims to authenticated;
grant select on public.claim_events to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Deciding. Returns what the server needs to tell the claimant, but never their email address: a
-- lead may not read other members' rows, so the server looks it up itself (src/lib/notify.ts).
--   pending_review:  a lead of the claim's division, or Finance; never the claimant.
--                    Approving sends it to Finance.
--   pending_finance: Finance only.
-- ---------------------------------------------------------------------------------------------
create function public.decide_claim(p_claim uuid, p_approve boolean, p_reason text default null)
returns table (claimant_id uuid, claimant_name text, amount_cents bigint, budget_name text, status public.claim_status)
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.me();
  v_claim public.claims;
  v_allowed boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_next public.claim_status;
begin
  if p_approve is null then
    raise exception 'Choose approve or reject.';
  end if;
  select * into v_claim from public.claims c where c.id = p_claim for update;
  if v_me.id is null or v_claim.id is null
     or not (v_claim.claimant_id = v_me.id or private.in_purview(v_claim.division_id)) then
    raise exception 'Claim not found.' using errcode = 'P0002';
  end if;

  if v_claim.status = 'pending_review' then
    v_allowed := v_claim.claimant_id <> v_me.id and private.in_purview(v_claim.division_id);
    v_next := case when p_approve then 'pending_finance' else 'rejected' end;
  elsif v_claim.status = 'pending_finance' then
    v_allowed := v_me.role = 'finance';
    v_next := case when p_approve then 'approved' else 'rejected' end;
  else
    raise exception 'This claim has already been decided.';
  end if;

  if not v_allowed then
    raise exception 'You can''t decide this claim.' using errcode = '42501';
  end if;
  if not p_approve and (v_reason is null or length(v_reason) < 3) then
    raise exception 'Give a reason so the claimant can fix it.';
  end if;

  update public.claims c
     set status = v_next,
         rejection_reason = case when p_approve then null else left(v_reason, 500) end,
         updated_at = now()
   where c.id = v_claim.id;

  insert into public.claim_events (claim_id, actor_id, actor_name, action, note)
  values (v_claim.id, v_me.id, v_me.name,
          case when not p_approve then 'rejected'
               when v_next = 'pending_finance' then 'reviewed' else 'approved' end,
          case when p_approve then null else left(v_reason, 500) end);

  return query
    select v_claim.claimant_id, v_claim.claimant_name, v_claim.amount_cents, b.name, v_next
    from public.budgets b where b.id = v_claim.budget_id;
end $$;

-- The encrypted payout details of a claim Finance is deciding or paying. The server decrypts them
-- with the claimant's id as additional authenticated data.
create function public.claim_payout_enc(p_claim uuid)
returns table (claimant_id uuid, payout_enc text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then
    raise exception 'Only Finance can see payout details.' using errcode = '42501';
  end if;
  return query
    select c.claimant_id, c.payout_enc from public.claims c
    where c.id = p_claim and c.status in ('pending_finance', 'approved');
end $$;

revoke all on function public.decide_claim(uuid, boolean, text), public.claim_payout_enc(uuid) from public, anon;
grant execute on function public.decide_claim(uuid, boolean, text), public.claim_payout_enc(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Receipts: private bucket, <auth uid>/<random>/<file>. Upload into your own folder only; read your
-- own files and those of any claim you can see. Nobody updates or deletes files through the API: a
-- delete could race a claim attaching the same file. A file uploaded for a claim never submitted
-- just stays, private, in its owner's folder.
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

create policy receipts_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text and private.is_active()
);
create policy receipts_select on storage.objects for select to authenticated using (
  bucket_id = 'receipts' and private.is_active() and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.claims c where objects.name = any (c.attachment_paths))
  )
);

-- ---------------------------------------------------------------------------------------------
-- Spending against each guideline, computed from claims (never stored). security_invoker, so RLS on
-- claims and guidelines decides; the where clauses show only budgets in the viewer's purview.
-- "Committed" is approved but not yet paid; "pending" is still awaiting review or Finance.
-- ---------------------------------------------------------------------------------------------
create view public.guideline_totals with (security_invoker = true) as
select
  g.budget_id, g.category_id, c.name as category_name, g.guideline_cents,
  coalesce(sum(cl.amount_cents) filter (where cl.status in ('pending_review', 'pending_finance')), 0)::bigint as pending_cents,
  coalesce(sum(cl.amount_cents) filter (where cl.status = 'approved'), 0)::bigint as approved_cents,
  coalesce(sum(cl.amount_cents) filter (where cl.status = 'paid'), 0)::bigint as paid_cents
from public.budget_guidelines g
join public.categories c on c.id = g.category_id
left join public.claims cl on cl.budget_id = g.budget_id and cl.category_id = g.category_id
where private.budget_in_purview(g.budget_id)
group by g.budget_id, g.category_id, c.name, g.guideline_cents;

create view public.budget_totals with (security_invoker = true) as
select
  b.id as budget_id, b.name, b.kind, b.division_id, b.active,
  coalesce(g.guideline_cents, 0)::bigint as guideline_cents,
  coalesce(c.pending_cents, 0)::bigint as pending_cents,
  coalesce(c.approved_cents, 0)::bigint as approved_cents,
  coalesce(c.paid_cents, 0)::bigint as paid_cents
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

revoke all on public.guideline_totals, public.budget_totals from anon, authenticated;
grant select on public.guideline_totals, public.budget_totals to authenticated;
