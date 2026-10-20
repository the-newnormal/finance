-- Part 8: AI receipt checks, advice for whoever reviews a claim.
--
-- When a reviewer opens a claim awaiting review or final approval, the server reads its receipts
-- with Claude (Anthropic's API) as that reviewer, and compares them with the claim and the claim
-- rules: amount, date, what was bought, and what a receipt must show. The result is advice only:
-- it never changes a claim's status, and a person still decides.
--
-- One check per claim, replaced by a re-check. Only a reviewer records one (record_receipt_check):
-- a lead of the claim's division or Finance, never the claimant (Finance excepted, as Finance may
-- finalise its own claims), so a claimant can't plant a reassuring check on their own claim. Who
-- ran it is recorded. Readable by the claim's reviewers only (leads of its division and Finance).

create type public.receipt_verdict as enum ('looks_right', 'check_needed', 'unreadable');

create table public.receipt_checks (
  claim_id uuid primary key references public.claims (id) on delete cascade,
  verdict public.receipt_verdict not null,
  summary text not null check (length(btrim(summary)) between 1 and 1000),
  -- What was read from each document, and the comparisons (src/lib/receipt-check.ts).
  findings jsonb not null check (jsonb_typeof(findings) = 'object' and length(findings::text) <= 20000),
  files_checked int not null check (files_checked between 0 and 5),
  model text not null check (length(model) between 1 and 100),
  checked_by uuid references public.members (id) on delete set null,
  checked_by_name text not null,
  checked_at timestamptz not null default now()
);

alter table public.receipt_checks enable row level security;
revoke all on public.receipt_checks from anon, authenticated;
grant select on public.receipt_checks to authenticated;

create policy receipt_checks_select on public.receipt_checks for select to authenticated using (
  exists (select 1 from public.claims c where c.id = claim_id and private.in_purview(c.division_id))
);

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
  insert into public.receipt_checks (claim_id, verdict, summary, findings, files_checked, model, checked_by, checked_by_name)
  values (v_claim.id, p_verdict, left(btrim(p_summary), 1000), p_findings, p_files_checked, p_model, v_me.id, v_me.name)
  on conflict (claim_id) do update set verdict = excluded.verdict, summary = excluded.summary,
    findings = excluded.findings, files_checked = excluded.files_checked, model = excluded.model,
    checked_by = excluded.checked_by, checked_by_name = excluded.checked_by_name, checked_at = now();
end $$;

revoke all on function public.record_receipt_check(uuid, public.receipt_verdict, text, jsonb, int, text) from public, anon;
grant execute on function public.record_receipt_check(uuid, public.receipt_verdict, text, jsonb, int, text) to authenticated;
