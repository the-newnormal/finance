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
Sign-in is by email magic link only (no passwords, no Google or other social logins), and only for accounts an admin created: sign-ups are off.

Roles live on `members` (one row per login, `id` = `auth.users.id`): `role` is `volunteer`, `core` or `admin`, plus a `finance` flag. Core members belong to divisions through `division_members`.

| | volunteer | core | finance | admin |
|---|---|---|---|---|
| Submit claims, see their own | ✓ | ✓ | ✓ | ✓ |
| Submit vendor invoices | | ✓ | ✓ | ✓ |
| Review volunteer claims in their divisions | | ✓ | ✓ | ✓ |
| See budgets and claims for their divisions | | ✓ | all | all |
| Final approval, payouts, payout details | | | ✓ | ✓ |
| Approve their own claim | | | ✓ (finance flag only) | |
| Create accounts, set roles, set up divisions, budgets and categories | | | | ✓ |

A claim moves `pending_review` → `pending_finance` → `approved` → `paid`, or to `rejected` from either pending state. Volunteers' claims start at `pending_review` and need **one** approval from a core member of the claim's division (or Finance/an admin stepping in); everyone else's start at `pending_finance`. Nobody reviews their own claim.

## Database
- Never modify the production schema by hand. **All schema changes are migrations in `supabase/migrations/`.**
- **RLS ON for every table** (CI's `migrations` job fails otherwise: `scripts/check-migrations.sh`, required on `main`). The database decides who sees and does what; app code never re-implements a rule it could get wrong. Helpers in the `private` schema (`private.is_finance()`, `private.in_purview(division)`, …) are the single definition of each rule.
- Claims are inserted by their claimant (RLS) and a trigger fills everything the claimant must not choose (status, division, names, timestamps). Status only changes through `decide_claim` (approve or reject, at either stage) and `mark_paid`, which check the caller themselves and log to `claim_events`; `claims` has no update grant at all. They never return the claimant's email (reviewers may not read other members); the server looks it up to notify them. Each claim must carry the form's `submission_id` (not null, unique per claimant), so a retried submission can't create a duplicate.
- Budget totals are **computed** from claims (`pool_totals` view), never stored. A claim keeps the division its budget had when it was made, so a budget with claims can't move to another division.
- Budget amounts (`pool_budgets`) are visible only to core members of the division, Finance and admins; volunteers see pool names only.
- Payout details are encrypted by the server (AES-256-GCM, `src/lib/crypto.ts`) with the claimant's id as additional authenticated data, so a ciphertext can't be moved to someone else's claim. `claims.payout_enc` is never granted to `authenticated`; Finance reads it only through `claim_payout_enc()`.
- New tables, views and functions get no grants by default: grant what's needed in the same migration, `revoke execute … from public` on new functions, and create views `with (security_invoker = true)`.
- Receipts live in the private `receipts` bucket at `<auth uid>/<random>/<file>`; a claim may only attach files already uploaded there. Anyone who can see a claim can read its files, nobody else. Nobody updates or deletes receipts through the API (a delete could race a claim attaching the file).
- A budget and its amount are saved together through `admin_save_pool`, and a member and their divisions through `admin_add_member` / `admin_update_member` (SECURITY INVOKER: RLS and triggers still decide), never as separate requests.

## Security
- Never commit secrets (`.env*` is git-ignored; use `.env.example`).
- Never expose the service-role key to the client. `src/lib/supabase/admin.ts` is the only service-role client, used only to invite, deactivate and reactivate logins (`admin-imports.test.ts` lists who may import it).
- Never disable auth checks or weaken RLS without explicit review.
- Logs carry codes and counts only: never names, emails, amounts or payout details.

## Testing
- Add tests for new business logic. RLS and workflow rules are tested in `supabase/tests/` (`pnpm supabase test db`); pure logic (PayNow payloads, encryption, money parsing) with Vitest.
- Run `pnpm typecheck && pnpm lint && pnpm test` before opening a PR.

## Scope guard
Claims, budgets and payouts. Do NOT add accounting, payroll, inventory or general task management.
