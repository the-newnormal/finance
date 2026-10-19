# Finance — Engineering Contract

New Normal's finance portal: volunteers claim incidentals they paid for, core personnel review their division's claims and submit vendor invoices, and Finance gives final approval and pays by PayNow. Keep it **simple**: claims, budgets and payouts, nothing more.

Stack: **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + Supabase (Postgres, Auth, Storage) + Vercel.** No Firebase.

## Git
- Never commit directly to `main`. Create a feature branch.
- Claude may merge a PR without asking once all three hold on its latest commit: CodeRabbit has approved it, Qodo has reviewed it and left no open "Action required" finding, and every CI job passed. Hold it while the PR lists unticked "Before merging" steps.
- Never bypass CI or review. Don't post `@coderabbitai approve` unless the user asks; the approval must come from CodeRabbit's own review.
- Small, focused PRs.
- `main` is protected by the ruleset in `.github/rulesets/protect-main.json`, applied with `scripts/protect-main.sh` (the repo is public, so GitHub enforces it on the Free plan). Change it only by PR, then re-run the script; never loosen it in the GitHub UI.
- `.claude/hooks/auto-push.sh` commits and pushes the current feature branch after every Claude response (never on `main`, never secrets). Opt out for a session with `FINANCE_AUTOPUSH=0`.

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
| Bank accounts: balances, grants, adjustments, transfers | | | ✓ |
| Create accounts, set roles, set up divisions, categories and budgets | | | ✓ |

A claim moves `pending_review` → `pending_finance` → `approved` → `paid`, or to `rejected` from either pending state. Volunteers' claims start at `pending_review` and need **one** preliminary approval from a lead of the claim's division (or Finance stepping in); leads' and Finance's start at `pending_finance`. Only Finance gives final approval. Nobody reviews their own claim, except that Finance may finalise its own.

## Budgets
Divisions are empty shells: they hold no money. Finance creates **budgets** inside them. Each budget provisions the spend categories it allows, each with a **guideline** amount (`budget_categories`, `budget_guidelines`); the budget's total is the sum of its guidelines. A claim may only be made against a category its budget provisions (a composite foreign key enforces it). Spending against each guideline is computed from claims (`guideline_totals`, `budget_totals` views), never stored, and visible only to the division's leads and Finance; volunteers see budget names and their categories, never amounts.

## Database
- Never modify the production schema by hand. **All schema changes are migrations in `supabase/migrations/`.**
- **RLS ON for every table** (CI's `migrations` job fails otherwise: `scripts/check-migrations.sh`, required on `main`). The database decides who sees and does what; app code never re-implements a rule it could get wrong. Helpers in the `private` schema (`private.is_finance()`, `private.leads(division)`, `private.in_purview(division)`, …) are the single definition of each rule.
- Claims are inserted by their claimant (RLS) and a trigger fills everything the claimant must not choose (status, division, names, timestamps). Status only changes through `decide_claim` and `mark_paid`, which check the caller themselves and log to `claim_events`; `claims` has no update grant at all. They never return the claimant's email; the server looks it up to notify them. Each claim carries the form's `submission_id` (unique per claimant), so a retried submission can't create a duplicate.
- A claim keeps the division its budget had when it was made, so a budget with claims can't move to another division, and a category with claims can't be unprovisioned from its budget.
- Payout details are encrypted by the server (AES-256-GCM, `src/lib/crypto.ts`) with the claimant's id as additional authenticated data. `claims.payout_enc` is never granted to `authenticated`; Finance reads it only through `claim_payout_enc()`.
- New tables, views and functions get no grants by default **on hosted Supabase** (local Supabase grants them, so CI alone won't notice): every migration revokes and then grants exactly what is needed (see `supabase/tests/grants_test.sql`), `revoke execute … from public` on new functions, and views are `with (security_invoker = true)`.
- Receipts live in the private `receipts` bucket at `<auth uid>/<random>/<file>`; a claim may only attach files already uploaded there. Anyone who can see a claim can read its files. Nobody updates or deletes receipts through the API.
- **Bank accounts** (0004): `bank_accounts` and an append-only `bank_entries` ledger, visible only to Finance. The expected balance is the `bank_balances` view, never stored. Entries are written only by `add_bank_account`, `record_bank_entry`, `transfer_between_accounts` and `mark_paid`; mistakes are corrected with an adjustment. Only the last four digits of an account number are stored.
- **Imported claims** (0005): Finance imports claims paid before this app with `import_paid_claims` (all rows in one transaction; each becomes a paid claim with `imported = true`, no payout details, and a payout entry on the named account, never dated before its opening balance). Receipts can be added to imported claims later with `attach_claim_files`. Nobody sets `imported` through the API.
- A budget and its guidelines are saved together through `save_budget`, and a member and their divisions through `add_member` / `update_member` (SECURITY INVOKER: RLS and triggers still decide).

## Security
- Never commit secrets (`.env*` is git-ignored; use `.env.example`).
- Never expose the service-role key to the client. `src/lib/supabase/admin.ts` is the only service-role client, used only by the People page's actions (`src/app/(app)/people/actions.ts`) to invite, deactivate and reactivate logins, and by `src/lib/notify.ts` to look up a claimant's email for a notification (`admin-imports.test.ts` lists who may import it).
- Never disable auth checks or weaken RLS without explicit review.
- Logs carry codes and counts only: never names, emails, amounts or payout details.

## Testing
- Add tests for new business logic. RLS and workflow rules are tested in `supabase/tests/` (`pnpm supabase test db`); pure logic (PayNow payloads, encryption, money parsing) with Vitest.
- Run `pnpm typecheck && pnpm lint && pnpm test` before opening a PR.

## Scope guard
Claims, budgets with spend guidelines, and payouts. Do NOT add accounting, payroll, inventory or general task management.
