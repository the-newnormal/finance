# finance

New Normal's finance portal: volunteers claim incidentals, core personnel review claims and submit vendor invoices, and Finance approves and pays them by PayNow.

Next.js (App Router) · TypeScript · Tailwind + shadcn/ui · Supabase (Postgres, Auth, Storage, RLS) · Vercel.

Reviewed by CodeRabbit (`.coderabbit.yaml`) and Qodo (`.pr_agent.toml`). The engineering rules are in [CLAUDE.md](CLAUDE.md).

## Dev
Needs Docker (for the local Supabase stack).
```bash
pnpm install
pnpm supabase start               # local Postgres, Auth, Storage and Mailpit; prints its keys
cp .env.example .env.local        # fill in from `pnpm supabase status`, NEXT_PUBLIC_SITE_URL=http://localhost:3000,
                                  # and PAYOUT_ENCRYPTION_KEY from `pnpm gen-key`
pnpm supabase db reset            # apply migrations + seed
pnpm dev
```

`supabase/seed.sql` creates `admin@example.com` (admin, with Finance), a division, six categories and one event budget. Request a link at `/login` and open it from Mailpit at http://127.0.0.1:54324.

```bash
pnpm supabase test db             # RLS and workflow tests in supabase/tests/
```

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## How it works
- **Roles:** volunteer, core (reviews their divisions' claims and sees their budgets), admin, plus a Finance flag. See the table in [CLAUDE.md](CLAUDE.md).
- **A claim** goes `pending_review` (volunteers only: one approval from a core member of the division) → `pending_finance` → `approved` → `paid`, or `rejected` with a reason. The claimant is emailed when it's approved, rejected or paid.
- **Payouts:** Finance opens an approved claim to get a PayNow QR code (amount and reference `NN-XXXXXXXX` pre-filled), pays it in the bank app, then records the bank reference. Bank-transfer claims show the account details instead.
- **Bank:** Finance records each account's opening balance, grants and other income, adjustments and transfers; paying a claim asks which account it came from. The Bank page shows each account's expected balance and compares it with the DBS balance you type in. Only Finance and admins see it.
- **Payout details** are encrypted with AES-256-GCM (`PAYOUT_ENCRYPTION_KEY`) and the claimant's id as additional authenticated data; everyone but Finance sees only the last four characters.

## Deploying (Supabase + Vercel)
1. **Supabase project** (region Singapore). Link and push the schema: `pnpm supabase link --project-ref <ref>` then `pnpm supabase db push`.
2. **Authentication → Sign In / Providers:** Email on, **"Allow new users to sign up" off**. No other providers.
3. **Authentication → URL Configuration:** Site URL = the production URL; redirect URLs include `<production URL>/auth/callback**`.
4. **Authentication → Emails → Templates:** paste `supabase/templates/magic-link.html` (Magic link) and `supabase/templates/invite.html` (Invite user). Supabase's default links don't work with `/auth/callback`.
5. **Authentication → Emails → SMTP Settings:** your sender (e.g. Gmail SMTP with an app password). Supabase's built-in sender only mails your Supabase team, two emails an hour.
6. **Vercel:** import the repo, then set the environment variables from `.env.example`. Mark `SUPABASE_SERVICE_ROLE_KEY`, `PAYOUT_ENCRYPTION_KEY` and `SMTP_PASSWORD` as Sensitive, and never give them a `NEXT_PUBLIC_` prefix. Generate the encryption key with `pnpm gen-key` and keep a copy in a password manager: saved payout details can't be read without it.
7. **First admin:** in Supabase → Authentication → Users, choose **Add user → Create new user** with your email and **Auto Confirm User** ticked (don't use "Send invitation": the dashboard's invite has no link back to this app). Then in the SQL editor:
   `insert into members (id, email, name, role, finance) select id, email, 'Your Name', 'admin', true from auth.users where email = 'you@newnormal.sg';`
   Sign in at `/login` with that email. After that, add everyone else from the People page, whose invites link back correctly.
