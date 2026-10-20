-- Part 7: claim rules, the notices Finance writes for claimants and the claim form shows.
--
-- Finance adds, edits, hides and removes them on the Setup page. Every active member reads the ones
-- shown, and Finance also reads hidden ones. Each applies to every claim, to reimbursements only or
-- to vendor invoices only. The text is plain: shown as written, line breaks kept, never as HTML. An
-- optional link (https only) goes under it.
--
-- The claim form shows them in its declaration, above the box the claimant ticks to agree. They
-- start as TRP's declaration and data-protection notice, word for word, without TRP's contact
-- person and policy link: Finance adds New Normal's own. What each document must show is listed
-- separately (src/lib/receipt-fields.ts).

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
  ('Accuracy and processing time',
   'By submitting this form, I agree that all relevant information is accurate and free of errors, and that my reimbursement claim may be rejected due to insufficient / inaccurate documents and/or may take up to 15 working days to be processed from form submission.',
   'all', 10),
  ('Personal data',
   'By submitting this form, I understand that my personal data will be handled in accordance with the PDPA Act 2012 of Singapore.',
   'all', 20);
