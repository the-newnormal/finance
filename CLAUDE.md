# Finance — Engineering Contract

Normal's finance portal: volunteers claim incidentals they paid for, core personnel review their division's claims and submit vendor invoices, and Finance gives final approval and reimburses or settles by PayNow. Keep it **simple**: claims, budgets and disbursements, nothing more.

Stack: **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + Supabase (Postgres, Auth, Storage) + Vercel.** No Firebase.

## Git
- Never commit directly to `main`. Create a feature branch.
- Claude may merge a PR without asking once both hold on its latest commit: CodeRabbit has approved it, and every CI job passed. Qodo isn't waited for. Hold it while the PR lists unticked "Before merging" steps.
- Never bypass CI or review. Don't post `@coderabbitai approve` unless the user asks; the approval must come from CodeRabbit's own review.
- Small, focused PRs.
- `main` is protected by the ruleset in `.github/rulesets/protect-main.json`, applied with `scripts/protect-main.sh` (the repo is public, so GitHub enforces it on the Free plan). Change it only by PR, then re-run the script; never loosen it in the GitHub UI.
- `.claude/hooks/auto-push.sh` commits and pushes the current feature branch after every Claude response (never on `main`, never secrets). Opt out for a session with `FINANCE_AUTOPUSH=0`.

## Glossary
User-facing words (UI, emails, docs):
- The claimant **pays** a shop or vendor.
- Finance **reimburses** a claimant (a reimbursement claim) or **settles** a vendor invoice (an invoice claim). A `paid` claim shows as "Reimbursed" or "Settled" (`statusLabel(status, kind)` in `src/lib/types.ts`); an approved one as "Approved · to be reimbursed / settled".
- Money leaving our bank for a claim is a **disbursement** ("Record disbursement", the Disbursements page at `/payouts`, the ledger's "Disbursement" entries).
- A budget's **available** balance: grants received + loans from the reserve − repayments − approved and disbursed claims (0010).

Database identifiers keep their old names (status `paid`, bank entry kind `payout`, `paid_cents`, `mark_paid`, `payout_enc`, `/payouts`, …); only the words people read change.

## Who can do what
Sign-in is by email magic link only (no passwords, no Google or other social logins), and only for accounts Finance created: sign-ups are off.

Roles live on `members` (one row per login, `id` = `auth.users.id`): `role` is `volunteer`, `lead` or `finance`. Division leads lead one or more divisions through `division_leads`.

| | volunteer | division lead | finance |
|---|---|---|---|
| Submit claims, see their own | ✓ | ✓ | ✓ |
| Submit vendor invoices | | ✓ | ✓ |
| Preliminary approval of volunteer claims in their divisions | | ✓ | ✓ |
| See budgets, guidelines and spending | | their divisions | all |
| Final approval, payouts, payout details | | | ✓ |
| Bank accounts: balances, grants, adjustments, transfers, corrections | | | ✓ |
| Create accounts, set roles, set up divisions, categories and budgets | | | ✓ |

A claim moves `pending_review` → `pending_finance` → `approved` → `paid`, or to `rejected` from either pending state. Volunteers' claims start at `pending_review` and need **one** preliminary approval from a lead of the claim's division (or Finance stepping in); leads' and Finance's start at `pending_finance`. Only Finance gives final approval. Nobody reviews their own claim, except that Finance may finalise its own.

## Budgets
Divisions are empty shells: they hold no money. Finance creates **budgets** inside them. Each budget provisions the spend categories it allows, each with a **guideline** amount (`budget_categories`, `budget_guidelines`); the budget's total is the sum of its guidelines. A claim may only be made against a category its budget provisions (a composite foreign key enforces it). Every category sits in one of five fixed **groups** (0011: Venue & Production, Programme, People, Marketing & Brand, Operations & Admin; labels in `src/lib/types.ts`), so spending can be reported by kind (the export's `category_group`): a trigger makes every category written from now on have one, so one from before groups gets its group before it can be hidden. Claims are made against a category, never a group. The **reserve** (0006) is the one budget outside every division: only Finance sees it, adds to it (`add_to_reserve`, an append-only `reserve_additions` list) or claims against it; it provisions every category automatically and has no guidelines, and its funds are the sum of its additions. Only Finance submits claims against it, but Finance can import a paid claim against it for anyone (`import_paid_claims`): that is how someone outside Finance is reimbursed from the reserve, and it is intended. Spending against each guideline is computed from claims (`guideline_totals`, `budget_totals` views), never stored, and visible only to the division's leads and Finance; volunteers see budget names and their categories, never amounts.

## Database
- Never modify the production schema by hand. **All schema changes are migrations in `supabase/migrations/`.**
- **RLS ON for every table** (CI's `migrations` job fails otherwise: `scripts/check-migrations.sh`, required on `main`). The database decides who sees and does what; app code never re-implements a rule it could get wrong. Helpers in the `private` schema (`private.is_finance()`, `private.leads(division)`, `private.in_purview(division)`, …) are the single definition of each rule.
- Claims are inserted by their claimant (RLS) and a trigger fills everything the claimant must not choose (status, division, names, timestamps). Status only changes through `decide_claim` and `mark_paid`, which check the caller themselves and log to `claim_events`; `claims` has no update grant at all. They never return the claimant's email; the server looks it up to notify them. Each claim carries the form's `submission_id` (unique per claimant), so a retried submission can't create a duplicate.
- A claim keeps the division its budget had when it was made, so a budget with claims can't move to another division, and a category with claims can't be unprovisioned from its budget.
- Payout details are encrypted by the server (AES-256-GCM, `src/lib/crypto.ts`) with the claimant's id as additional authenticated data. `claims.payout_enc` is never granted to `authenticated`; Finance reads it only through `claim_payout_enc()`.
- New tables, views and functions get no grants by default **on hosted Supabase** (local Supabase grants them, so CI alone won't notice): every migration revokes and then grants exactly what is needed (see `supabase/tests/grants_test.sql`), `revoke execute … from public` on new functions, and views are `with (security_invoker = true)`.
- Receipts live in the private `receipts` bucket at `<auth uid>/<random>/<file>`; a claim may only attach files already uploaded there. Anyone who can see a claim can read its files. Nobody updates or deletes receipts through the API.
- **Bank accounts** (0004): `bank_accounts` and a `bank_entries` ledger, visible only to Finance. The expected balance is the `bank_balances` view, never stored. Entries are written only by `add_bank_account`, `record_bank_entry`, `transfer_between_accounts`, `mark_paid` and `edit_bank_entry`. Only the last four digits of an account number are stored.
- **Ledger corrections** (0009): Finance corrects an entry's amount, date, note or account (and a payout's bank reference) with `edit_bank_entry`, always with a reason; every edit is kept in `bank_entry_edits` (before, after, who, when, why), which nobody changes. A transfer's two sides change together; an opening balance and a transfer stay on their accounts; nothing on, or moved to, a closed account. Correcting a payout corrects its claim (amount, so its budget's spending; payment reference; paid date) and adds an `edited` event to the claim's history, which says what changed but never names the account. This is the only way a paid claim's amount changes.
- **Imported claims** (0005): Finance imports claims paid before this app with `import_paid_claims` (all rows in one transaction; each becomes a paid claim with `imported = true`, no payout details, and a payout entry on the named account, never dated before its opening balance). Receipts can be added to imported claims later with `attach_claim_files`. Nobody sets `imported` through the API.
- **Claim rules** (0007): notices Finance writes on the Setup page and the claim form shows in its declaration, above the box the claimant must tick to submit, each for every claim, reimbursements or vendor invoices. Plain text (never rendered as HTML), links https only. Every active member reads the shown ones; Finance also reads hidden ones and is the only writer. The mandatory fields each document must show (receipt, invoice the claimant paid, vendor invoice) are TRP's lists, fixed in `src/lib/receipt-fields.ts`.
- **AI receipt checks** (0008): when a reviewer opens a claim awaiting their decision, the server reads its receipts with Claude, as that reviewer, and saves the advice as theirs in `receipt_checks` through `record_receipt_check`. Only a reviewer who could decide the claim now records one: a lead of its division or Finance while it awaits review, Finance alone once it awaits final approval; never the claimant (Finance excepted, as it may finalise its own). Each reviewer reads only their own checks, and only while they can still review the claim, so no check (the function takes its result from its caller) can be passed off to anyone else. Only claims whose claimant was told are checked: `claims.ai_check_notice`, which `submitClaim` sets while the check is on (the form says so then). Advice never changes a claim's status; a reviewer may fill a rejection reason with what it found for the claimant to fix (`src/lib/receipt-fixes.ts`, never its concerns), and edits it before sending. Claimants' files are read as they attach them (`precheckClaim`, `readClaimFiles` in `src/lib/receipt-check-claim.ts`): only files in their own folder, and nothing saved but the items sent with the claim. The form uploads each file as it's attached and can't send the claim until the read is back (one that can't run holds nothing up); what to fix, with the documents' total and date compared to what was entered as it's sent (`src/lib/claim-items.ts`), shows in a pop-up they may submit past.
- **Budget funding** (0010): each ordinary budget keeps a virtual balance from `budget_funds` (grants, loans from the reserve, repayments; append-only, readable by the division's leads and Finance), written only by Finance through `record_grant` (also a `grant` bank entry), `loan_from_reserve`, `repay_reserve`; `set_grant_commitment` records the grant committed. `budget_totals` shows `available_cents` (and `lent_out_cents` for the reserve). Money leaves the reserve only through a claim or a loan: additions are positive. A short balance never blocks a claim; Finance is warned on the claim page.
- **Claim items** (0012): `claims.items` is what the AI read a claim bought, line by line (description, amount as printed, category), sent by the claimant with the claim while the check is on; a trigger keeps only well-formed items, nobody changes them after, and whoever sees the claim sees them. Reports share a claim's amount across its items in proportion to their amounts (`shareAmount`), so tax and service charges are shared too; an item without a category, or a claim without items, counts under the claim's category (the export's row per item bought).
- A budget and its guidelines are saved together through `save_budget`, and a member and their divisions through `add_member` / `update_member` (SECURITY INVOKER: RLS and triggers still decide).

## Security
- Never commit secrets (`.env*` is git-ignored; use `.env.example`).
- Never expose the service-role key to the client. `src/lib/supabase/admin.ts` is the only service-role client, used only by the People page's actions (`src/app/(app)/people/actions.ts`) to invite, deactivate and reactivate logins, and by `src/lib/notify.ts` to look up the emails of a claim's claimant and of whoever must review it next, for a notification (`admin-imports.test.ts` lists who may import it).
- Never disable auth checks or weaken RLS without explicit review.
- Logs carry codes and counts only: never names, emails, amounts or payout details.
- Receipts go to Anthropic's API only for the AI receipt check and the items it lists (`src/lib/receipt-check.ts`), only when `ANTHROPIC_API_KEY` is set, and the claim form says so then. Payout details never go there.

## Testing
- Add tests for new business logic. RLS and workflow rules are tested in `supabase/tests/` (`pnpm supabase test db`); pure logic (PayNow payloads, encryption, money parsing) with Vitest.
- Run `pnpm typecheck && pnpm lint && pnpm test` before opening a PR.

## Scope guard
Claims, budgets with spend guidelines, and payouts. Do NOT add accounting, payroll, inventory or general task management.
