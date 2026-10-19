-- New Normal Finance, part 1: people, divisions and the access rules everything else uses.
--
-- Three roles (CLAUDE.md, "Who can do what"):
--   volunteer  submits claims and sees their own.
--   lead       leads one or more divisions: reviews their volunteers' claims (the preliminary
--              approval) and sees their budgets and spending against each guideline.
--   finance    sees everything, gives every claim its final approval, pays, keeps the bank ledger,
--              creates accounts and sets up divisions, categories and budgets.
--
-- The database decides who sees and does what. Every table has RLS on; each rule lives once, in a
-- private.* helper, and the policies and functions use it. Hosted Supabase gives new tables, views
-- and functions no privileges (local Supabase does), so each migration revokes, then grants
-- exactly what is needed.

create type public.member_role as enum ('volunteer', 'lead', 'finance');
create type public.payout_type as enum ('paynow_mobile', 'paynow_uen', 'bank');

-- An empty shell that budgets belong to. It has no money of its own.
create table public.divisions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

-- One row per login (id = auth.users.id). Finance creates the login (invite) and this row together.
create table public.members (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique check (email = lower(btrim(email))),
  name text not null check (length(btrim(name)) between 1 and 80),
  role public.member_role not null default 'volunteer',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Which divisions a lead leads. Only leads have rows here.
create table public.division_leads (
  member_id uuid not null references public.members (id) on delete cascade,
  division_id uuid not null references public.divisions (id) on delete cascade,
  primary key (member_id, division_id)
);
create index division_leads_division_idx on public.division_leads (division_id);

-- A member's remembered payout details, encrypted by the server (src/lib/crypto.ts) with the
-- member's id as additional authenticated data.
create table public.member_payouts (
  member_id uuid primary key references public.members (id) on delete cascade,
  payout_type public.payout_type not null,
  payout_masked text not null check (length(payout_masked) <= 60),
  payout_enc text not null check (payout_enc like 'v1.%'),
  updated_at timestamptz not null default now()
);

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

create function private.is_finance() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.id = auth.uid() and m.active and m.role = 'finance')
$$;

-- Whether the signed-in member leads this division.
create function private.leads(p_division uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.division_leads dl join public.members m on m.id = dl.member_id
    where dl.member_id = auth.uid() and dl.division_id = p_division and m.active and m.role = 'lead'
  )
$$;

-- Whether the signed-in member sees a division's budgets, guidelines and claims: Finance always,
-- leads for the divisions they lead.
create function private.in_purview(p_division uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_finance() or private.leads(p_division)
$$;

-- The signed-in Finance member, or an error.
create function private.finance_me() returns public.members
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.members := private.me();
begin
  if v_me.id is null or v_me.role <> 'finance' then
    raise exception 'Only Finance can do this.' using errcode = '42501';
  end if;
  return v_me;
end $$;

create function private.sg_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Singapore')::date
$$;

revoke all on all functions in schema private from public;
grant execute on function private.is_active(), private.is_finance(), private.leads(uuid),
  private.in_purview(uuid) to authenticated;

-- Nobody changes their own role or deactivates themselves (so Finance can't lock itself out), and
-- nobody changes a member's id or email.
create function private.members_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.email <> old.email then
    raise exception 'A member''s login and email can''t be changed.';
  end if;
  if old.id = auth.uid() and (new.role <> old.role or new.active <> old.active) then
    raise exception 'You can''t change your own access.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.members_before_update() from public, authenticated;

create trigger members_before_update before update on public.members
  for each row execute function private.members_before_update();

-- ---------------------------------------------------------------------------------------------
-- Row level security and privileges
-- ---------------------------------------------------------------------------------------------
alter table public.divisions enable row level security;
alter table public.members enable row level security;
alter table public.division_leads enable row level security;
alter table public.member_payouts enable row level security;

revoke all on public.divisions, public.members, public.division_leads, public.member_payouts from anon, authenticated;

-- Divisions: every active member reads (claims show them); Finance writes.
grant select, insert, update, delete on public.divisions to authenticated;
create policy divisions_select on public.divisions for select to authenticated using (private.is_active());
create policy divisions_finance on public.divisions for all to authenticated
  using (private.is_finance()) with check (private.is_finance());

-- Members: yourself; Finance sees and manages everyone. Never deleted through the API.
grant select, insert, update on public.members to authenticated;
create policy members_select on public.members for select to authenticated
  using ((id = auth.uid() and private.is_active()) or private.is_finance());
create policy members_insert on public.members for insert to authenticated with check (private.is_finance());
create policy members_update on public.members for update to authenticated
  using (private.is_finance()) with check (private.is_finance());

-- Division leads: your own rows; Finance sees and manages all.
grant select, insert, delete on public.division_leads to authenticated;
create policy division_leads_select on public.division_leads for select to authenticated
  using ((member_id = auth.uid() and private.is_active()) or private.is_finance());
create policy division_leads_finance on public.division_leads for all to authenticated
  using (private.is_finance()) with check (private.is_finance());

-- Saved payout details: the member's own only.
grant select, insert, update, delete on public.member_payouts to authenticated;
create policy member_payouts_own on public.member_payouts for all to authenticated
  using (member_id = auth.uid() and private.is_active())
  with check (member_id = auth.uid() and private.is_active());

-- ---------------------------------------------------------------------------------------------
-- People: a member and the divisions they lead are saved together, in one transaction. SECURITY
-- INVOKER, so RLS (Finance only) and the members trigger (not your own access) decide. Only leads
-- lead divisions; any other role's division list is ignored.
-- ---------------------------------------------------------------------------------------------
create function public.add_member(p_id uuid, p_email text, p_name text, p_role public.member_role, p_divisions uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.members (id, email, name, role)
  values (p_id, lower(btrim(p_email)), btrim(p_name), p_role);
  if p_role = 'lead' then
    insert into public.division_leads (member_id, division_id)
    select distinct p_id, d from unnest(coalesce(p_divisions, '{}')) d;
  end if;
end $$;

create function public.update_member(p_id uuid, p_role public.member_role, p_active boolean, p_divisions uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.members m set role = p_role, active = p_active where m.id = p_id;
  if not found then
    raise exception 'That person wasn''t found.' using errcode = 'P0002';
  end if;
  delete from public.division_leads dl where dl.member_id = p_id;
  if p_role = 'lead' then
    insert into public.division_leads (member_id, division_id)
    select distinct p_id, d from unnest(coalesce(p_divisions, '{}')) d;
  end if;
end $$;

revoke all on function public.add_member(uuid, text, text, public.member_role, uuid[]),
  public.update_member(uuid, public.member_role, boolean, uuid[]) from public, anon;
grant execute on function public.add_member(uuid, text, text, public.member_role, uuid[]),
  public.update_member(uuid, public.member_role, boolean, uuid[]) to authenticated;
