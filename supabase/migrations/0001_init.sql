-- New Normal Finance: members, divisions, budgets, claims and receipts.
-- The database decides who sees and does what (CLAUDE.md, "Who can do what"). Every table has RLS
-- on; the rules live once, in the private.* helpers below, and the policies and functions use them.

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.member_role as enum ('volunteer', 'core', 'admin');
create type public.pool_kind as enum ('event', 'general');
create type public.claim_kind as enum ('reimbursement', 'invoice');
create type public.claim_status as enum ('pending_review', 'pending_finance', 'approved', 'rejected', 'paid');
create type public.payout_type as enum ('paynow_mobile', 'paynow_uen', 'bank');

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.divisions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

-- One row per login. Admins create the login (invite) and this row together.
create table public.members (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique check (email = lower(btrim(email))),
  name text not null check (length(btrim(name)) between 1 and 80),
  role public.member_role not null default 'volunteer',
  finance boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Which divisions a core member (or admin) reviews and sees the budgets of.
create table public.division_members (
  member_id uuid not null references public.members (id) on delete cascade,
  division_id uuid not null references public.divisions (id) on delete cascade,
  primary key (member_id, division_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 60),
  active boolean not null default true
);

-- Events and other budgets. Everyone sees names (to pick one when claiming); amounts are in
-- pool_budgets, which only the division's core members, Finance and admins see.
create table public.pools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  kind public.pool_kind not null default 'event',
  division_id uuid not null references public.divisions (id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.pool_budgets (
  pool_id uuid primary key references public.pools (id) on delete cascade,
  allocated_cents bigint not null check (allocated_cents >= 0)
);

-- A member's remembered payout details. payout_enc is encrypted by the server (src/lib/crypto.ts)
-- with the member's id as additional authenticated data.
create table public.member_payouts (
  member_id uuid primary key references public.members (id) on delete cascade,
  payout_type public.payout_type not null,
  payout_masked text not null check (length(payout_masked) <= 60),
  payout_enc text not null check (payout_enc like 'v1.%'),
  updated_at timestamptz not null default now()
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  kind public.claim_kind not null default 'reimbursement',
  -- Set by claims_before_insert, never by the claimant.
  status public.claim_status not null default 'pending_review',
  claimant_id uuid not null default auth.uid() references public.members (id),
  claimant_name text not null default '',
  division_id uuid not null references public.divisions (id),
  -- Chosen by the claimant.
  pool_id uuid not null references public.pools (id),
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'invoice') = (vendor_name is not null)),
  check (kind = 'invoice' or due_date is null)
);
create index claims_claimant_idx on public.claims (claimant_id, created_at desc);
create index claims_status_idx on public.claims (status, created_at);
create index claims_division_idx on public.claims (division_id, status);
create index claims_pool_idx on public.claims (pool_id);

-- Who did what to a claim, written only by the trigger and functions below.
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
-- Rules (private schema: not reachable through the Data API)
-- ---------------------------------------------------------------------------------------------
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- The signed-in member's row, if they have one and it's active.
create function private.me() returns public.members
language sql stable security definer set search_path = '' as $$
  select m.* from public.members m where m.id = auth.uid() and m.active
$$;

create function private.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.id = auth.uid() and m.active)
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.id = auth.uid() and m.active and m.role = 'admin')
$$;

-- Finance members and admins: every claim and budget, final approval, payouts.
create function private.is_finance() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.id = auth.uid() and m.active and (m.finance or m.role = 'admin')
  )
$$;

-- Whether the signed-in member sees a division's budgets and claims: Finance and admins always,
-- core members for divisions they belong to.
create function private.in_purview(p_division uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_finance() or exists (
    select 1
    from public.division_members dm
    join public.members m on m.id = dm.member_id
    where dm.member_id = auth.uid() and dm.division_id = p_division
      and m.active and m.role in ('core', 'admin')
  )
$$;

revoke all on all functions in schema private from public;
grant execute on function private.is_active(), private.is_admin(), private.is_finance(),
  private.in_purview(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------

-- Fills everything a claimant must not choose, and refuses what they may not claim.
create function private.claims_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members;
  v_pool public.pools;
  v_path text;
begin
  v_me := private.me();
  if v_me.id is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if new.kind = 'invoice' and v_me.role = 'volunteer' and not v_me.finance then
    raise exception 'Only core personnel can submit vendor invoices.' using errcode = '42501';
  end if;

  -- FOR SHARE: a concurrent move of this budget to another division waits for this claim, then
  -- pools_before_update sees it and refuses; or the move goes first and this claim takes the new one.
  select * into v_pool from public.pools where id = new.pool_id for share;
  if v_pool.id is null or not v_pool.active then
    raise exception 'That budget is not open for claims.';
  end if;
  if not exists (select 1 from public.categories where id = new.category_id and active) then
    raise exception 'Choose a valid category.';
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
  new.division_id := v_pool.division_id;
  -- Volunteers' claims are reviewed by their division first; everyone else's go to Finance.
  new.status := case when v_me.role = 'volunteer' and not v_me.finance
                     then 'pending_review' else 'pending_finance' end;
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

-- Admins may not change their own access, and nobody changes a member's id or email.
create function private.members_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.email <> old.email then
    raise exception 'A member''s login and email can''t be changed.';
  end if;
  if old.id = auth.uid() and (new.role <> old.role or new.finance <> old.finance or new.active <> old.active) then
    raise exception 'You can''t change your own access.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger members_before_update before update on public.members
  for each row execute function private.members_before_update();

-- A claim keeps the division its budget had when it was made (claims.division_id decides who reviews
-- and sees it), so a budget with claims can't move to another division.
create function private.pools_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.division_id <> old.division_id and exists (select 1 from public.claims c where c.pool_id = old.id) then
    raise exception 'This budget already has claims, so it can''t move to another division. Close it and create a new one there.';
  end if;
  return new;
end $$;

create trigger pools_before_update before update on public.pools
  for each row execute function private.pools_before_update();

revoke all on function private.claims_before_insert(), private.claims_after_insert(),
  private.members_before_update(), private.pools_before_update(), private.me() from public, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------
alter table public.divisions enable row level security;
alter table public.members enable row level security;
alter table public.division_members enable row level security;
alter table public.categories enable row level security;
alter table public.pools enable row level security;
alter table public.pool_budgets enable row level security;
alter table public.member_payouts enable row level security;
alter table public.claims enable row level security;
alter table public.claim_events enable row level security;

-- Nothing is readable signed out.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Reference data: every active member reads; admins write.
create policy divisions_select on public.divisions for select to authenticated using (private.is_active());
create policy divisions_admin on public.divisions for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy categories_select on public.categories for select to authenticated using (private.is_active());
create policy categories_admin on public.categories for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy pools_select on public.pools for select to authenticated using (private.is_active());
create policy pools_admin on public.pools for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy pool_budgets_select on public.pool_budgets for select to authenticated using (
  private.in_purview((select p.division_id from public.pools p where p.id = pool_id))
);
create policy pool_budgets_admin on public.pool_budgets for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Members: yourself; Finance and admins see everyone. Only admins add or change members.
create policy members_select on public.members for select to authenticated
  using ((id = auth.uid() and private.is_active()) or private.is_finance());
create policy members_insert on public.members for insert to authenticated with check (private.is_admin());
create policy members_update on public.members for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy division_members_select on public.division_members for select to authenticated
  using ((member_id = auth.uid() and private.is_active()) or private.is_finance());
create policy division_members_admin on public.division_members for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Saved payout details: the member's own only.
create policy member_payouts_own on public.member_payouts for all to authenticated
  using (member_id = auth.uid() and private.is_active())
  with check (member_id = auth.uid() and private.is_active());

-- Claims: your own, plus every claim in a division you have purview over. Inserted by the
-- claimant (the trigger fills the rest); never updated or deleted through the Data API.
create policy claims_select on public.claims for select to authenticated
  using ((claimant_id = auth.uid() and private.is_active()) or private.in_purview(division_id));
create policy claims_insert on public.claims for insert to authenticated
  with check (claimant_id = auth.uid() and private.is_active());

create policy claim_events_select on public.claim_events for select to authenticated
  using (exists (select 1 from public.claims c where c.id = claim_id));

-- Column grants on claims: payout_enc is never readable through the Data API, and claimants
-- set only the columns they choose.
revoke all on public.claims from authenticated;
grant select (id, kind, status, claimant_id, claimant_name, division_id, pool_id, category_id,
  description, amount_cents, expense_date, vendor_name, due_date, attachment_paths, payout_type,
  payout_masked, rejection_reason, payment_reference, created_at, updated_at)
  on public.claims to authenticated;
grant insert (kind, pool_id, category_id, description, amount_cents, expense_date, vendor_name,
  due_date, attachment_paths, payout_type, payout_masked, payout_enc)
  on public.claims to authenticated;

revoke all on public.claim_events from authenticated;
grant select on public.claim_events to authenticated;

revoke delete on public.members from authenticated;

-- ---------------------------------------------------------------------------------------------
-- Budget totals, computed from claims (never stored). security_invoker, so RLS on claims decides
-- which claims each person's totals include; the where clause shows only pools in their purview
-- (volunteers get none). A pool with no pool_budgets row shows as 0 allocated, not missing.
-- ---------------------------------------------------------------------------------------------
create view public.pool_totals with (security_invoker = true) as
select
  p.id as pool_id,
  p.name,
  p.kind,
  p.division_id,
  p.active,
  coalesce(b.allocated_cents, 0)::bigint as allocated_cents,
  coalesce(sum(c.amount_cents) filter (where c.status in ('pending_review', 'pending_finance')), 0)::bigint as pending_cents,
  coalesce(sum(c.amount_cents) filter (where c.status = 'approved'), 0)::bigint as approved_cents,
  coalesce(sum(c.amount_cents) filter (where c.status = 'paid'), 0)::bigint as paid_cents
from public.pools p
left join public.pool_budgets b on b.pool_id = p.id
left join public.claims c on c.pool_id = p.id
where private.in_purview(p.division_id)
group by p.id, b.allocated_cents;

revoke all on public.pool_totals from anon, authenticated;
grant select on public.pool_totals to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The claim workflow. Each function checks the caller itself and logs to claim_events.
-- Returns what the server needs to e-mail the claimant.
-- ---------------------------------------------------------------------------------------------

-- Approve or reject a pending claim, at whichever stage it is:
--   pending_review:  a core member of the claim's division, or Finance/an admin, never the claimant.
--                    Approving sends it to Finance.
--   pending_finance: Finance or an admin. Only a member with the finance flag may decide their own.
create function public.decide_claim(p_claim uuid, p_approve boolean, p_reason text default null)
returns table (claimant_email text, claimant_name text, amount_cents bigint, pool_name text, status public.claim_status)
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members;
  v_claim public.claims;
  v_allowed boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_next public.claim_status;
begin
  if p_approve is null then
    raise exception 'Choose approve or reject.';
  end if;
  v_me := private.me();
  select * into v_claim from public.claims c where c.id = p_claim for update;
  if v_me.id is null or v_claim.id is null
     or not (v_claim.claimant_id = v_me.id or private.in_purview(v_claim.division_id)) then
    raise exception 'Claim not found.' using errcode = 'P0002';
  end if;

  if v_claim.status = 'pending_review' then
    v_allowed := v_claim.claimant_id <> v_me.id and (
      private.is_finance() or (
        v_me.role in ('core', 'admin') and exists (
          select 1 from public.division_members dm
          where dm.member_id = v_me.id and dm.division_id = v_claim.division_id)));
    v_next := case when p_approve then 'pending_finance' else 'rejected' end;
  elsif v_claim.status = 'pending_finance' then
    v_allowed := private.is_finance() and (v_claim.claimant_id <> v_me.id or v_me.finance);
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
    select m.email, v_claim.claimant_name, v_claim.amount_cents, p.name, v_next
    from public.members m, public.pools p
    where m.id = v_claim.claimant_id and p.id = v_claim.pool_id;
end $$;

-- Record that Finance has paid an approved claim.
create function public.mark_paid(p_claim uuid, p_reference text)
returns table (claimant_email text, claimant_name text, amount_cents bigint, pool_name text, status public.claim_status)
language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members;
  v_claim public.claims;
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

  update public.claims c set status = 'paid', payment_reference = v_ref, updated_at = now()
   where c.id = v_claim.id;
  insert into public.claim_events (claim_id, actor_id, actor_name, action, note)
  values (v_claim.id, v_me.id, v_me.name, 'paid', v_ref);

  return query
    select m.email, v_claim.claimant_name, v_claim.amount_cents, p.name, 'paid'::public.claim_status
    from public.members m, public.pools p
    where m.id = v_claim.claimant_id and p.id = v_claim.pool_id;
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

revoke all on function public.decide_claim(uuid, boolean, text), public.mark_paid(uuid, text),
  public.claim_payout_enc(uuid) from public, anon;
grant execute on function public.decide_claim(uuid, boolean, text), public.mark_paid(uuid, text),
  public.claim_payout_enc(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- People: a member and their divisions are saved together, in one transaction. SECURITY INVOKER,
-- so RLS (admins only) and the members trigger (not your own access) decide, as for any write.
-- Volunteers belong to no division.
-- ---------------------------------------------------------------------------------------------
create function public.admin_add_member(p_id uuid, p_email text, p_name text, p_role public.member_role,
  p_finance boolean, p_divisions uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.members (id, email, name, role, finance)
  values (p_id, lower(btrim(p_email)), btrim(p_name), p_role, p_finance);
  if p_role <> 'volunteer' then
    insert into public.division_members (member_id, division_id)
    select distinct p_id, d from unnest(coalesce(p_divisions, '{}')) d;
  end if;
end $$;

create function public.admin_update_member(p_id uuid, p_role public.member_role, p_finance boolean,
  p_active boolean, p_divisions uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.members m set role = p_role, finance = p_finance, active = p_active where m.id = p_id;
  if not found then
    raise exception 'That person wasn''t found.' using errcode = 'P0002';
  end if;
  delete from public.division_members dm where dm.member_id = p_id;
  if p_role <> 'volunteer' then
    insert into public.division_members (member_id, division_id)
    select distinct p_id, d from unnest(coalesce(p_divisions, '{}')) d;
  end if;
end $$;

revoke all on function public.admin_add_member(uuid, text, text, public.member_role, boolean, uuid[]),
  public.admin_update_member(uuid, public.member_role, boolean, boolean, uuid[]) from public, anon;
grant execute on function public.admin_add_member(uuid, text, text, public.member_role, boolean, uuid[]),
  public.admin_update_member(uuid, public.member_role, boolean, boolean, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Receipts: private bucket, <auth uid>/<random>/<file>. Upload into your own folder only; read
-- your own files and those of any claim you can see. Nobody updates or deletes files through the
-- API: a delete could race a claim attaching the same file, leaving the claim without its receipt.
-- A file uploaded for a claim that was never submitted just stays, private, in its owner's folder.
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

create policy receipts_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
  and private.is_active()
);

create policy receipts_select on storage.objects for select to authenticated using (
  bucket_id = 'receipts' and private.is_active() and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.claims c where objects.name = any (c.attachment_paths))
  )
);
