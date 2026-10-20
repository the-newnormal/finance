-- Part 7: claim rules, the notices Finance writes for claimants and the claim form shows.
--
-- Finance adds, edits, hides and removes them on the Setup page. Every active member reads the ones
-- shown, and Finance also reads hidden ones. Each applies to every claim, to reimbursements only or
-- to vendor invoices only. The text is plain: shown as written, line breaks kept, never as HTML. An
-- optional link (https only) goes under it.
--
-- They start as the notices TRP's finance system shows its claimants: the declaration and the
-- data-protection notice. TRP's contact person and policy link are left out; Finance adds New
-- Normal's own. What each document must show is listed separately (src/lib/receipt-fields.ts).

create type public.claim_rule_scope as enum ('all', 'reimbursement', 'invoice');

create table public.claim_rules (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 100),
  body text not null check (length(btrim(body)) between 1 and 2000),
  applies_to public.claim_rule_scope not null default 'all',
  link_label text check (length(btrim(link_label)) between 1 and 60),
  link_url text check (link_url ~ '^https://[^[:space:]<>"]+$' and length(link_url) <= 500),
  sort_order int not null default 0 check (sort_order between 0 and 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((link_label is null) = (link_url is null))
);

alter table public.claim_rules enable row level security;
revoke all on public.claim_rules from anon, authenticated;
grant select, insert, update, delete on public.claim_rules to authenticated;

create policy claim_rules_select on public.claim_rules for select to authenticated
  using (private.is_active() and (active or private.is_finance()));
create policy claim_rules_finance on public.claim_rules for all to authenticated
  using (private.is_finance()) with check (private.is_finance());

insert into public.claim_rules (title, body, applies_to, sort_order) values
  ('Before you submit',
   'By submitting, you confirm that everything in your claim is accurate and complete. A claim with missing or unclear documents may be rejected, and a claim can take up to 15 working days to process from when you submit it.',
   'all', 30),
  ('Your personal data',
   'Your personal data is handled in accordance with Singapore''s Personal Data Protection Act 2012.',
   'all', 40);
