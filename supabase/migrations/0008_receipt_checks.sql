-- Part 8: AI receipt checks, advice for whoever reviews a claim.
--
-- When a reviewer opens a claim awaiting their decision, the server reads its receipts with Claude
-- (Anthropic's API) as that reviewer, and compares them with the claim and the claim rules: amount,
-- date, what was bought, and what each document must show. The result is advice only: it never
-- changes a claim's status, and a person still decides.
--
-- Each check belongs to the reviewer who ran it, and only they read it; a re-check replaces it. So a
-- check can't be passed off to anyone else: not a lead's to Finance, nor one a reviewer wrote by hand
-- (the function takes its result from its caller). record_receipt_check accepts only a reviewer who
-- could decide the claim now: a lead of its division, or Finance, while it awaits review; Finance
-- alone once it awaits final approval. Never its claimant (Finance excepted, as Finance may finalise
-- its own claims).

create type public.receipt_verdict as enum ('looks_right', 'check_needed', 'unreadable');

create table public.receipt_checks (
  claim_id uuid not null references public.claims (id) on delete cascade,
  checked_by uuid not null references public.members (id) on delete cascade,
  verdict public.receipt_verdict not null,
  summary text not null check (length(btrim(summary)) between 1 and 1000),
  -- What was read from each document, and the comparisons (src/lib/receipt-check.ts).
  findings jsonb not null check (jsonb_typeof(findings) = 'object' and length(findings::text) <= 50000),
  files_checked int not null check (files_checked between 0 and 5),
  model text not null check (length(model) between 1 and 100),
  checked_at timestamptz not null default now(),
  primary key (claim_id, checked_by)
);

alter table public.receipt_checks enable row level security;
revoke all on public.receipt_checks from anon, authenticated;
grant select on public.receipt_checks to authenticated;

create policy receipt_checks_select on public.receipt_checks for select to authenticated
  using (checked_by = (select auth.uid()) and private.is_active());

create function public.record_receipt_check(p_claim uuid, p_verdict public.receipt_verdict, p_summary text,
  p_findings jsonb, p_files_checked int, p_model text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me public.members := private.me();
  v_claim public.claims;
begin
  select * into v_claim from public.claims c where c.id = p_claim for share;
  if v_me.id is null or v_claim.id is null or not private.in_purview(v_claim.division_id) then
    raise exception 'Claim not found.' using errcode = 'P0002';
  end if;
  if v_claim.claimant_id = v_me.id and v_me.role <> 'finance' then
    raise exception 'You can''t check your own claim.' using errcode = '42501';
  end if;
  if v_claim.status not in ('pending_review', 'pending_finance') then
    raise exception 'Only claims awaiting a decision are checked.';
  end if;
  if v_claim.status = 'pending_finance' and v_me.role <> 'finance' then
    raise exception 'Only Finance checks a claim awaiting final approval.' using errcode = '42501';
  end if;
  insert into public.receipt_checks (claim_id, checked_by, verdict, summary, findings, files_checked, model)
  values (v_claim.id, v_me.id, p_verdict, left(btrim(p_summary), 1000), p_findings, p_files_checked, p_model)
  on conflict (claim_id, checked_by) do update set verdict = excluded.verdict, summary = excluded.summary,
    findings = excluded.findings, files_checked = excluded.files_checked, model = excluded.model, checked_at = now();
end $$;

revoke all on function public.record_receipt_check(uuid, public.receipt_verdict, text, jsonb, int, text) from public, anon;
grant execute on function public.record_receipt_check(uuid, public.receipt_verdict, text, jsonb, int, text) to authenticated;
