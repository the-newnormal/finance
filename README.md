# finance

New Normal's finance portal: volunteers claim incidentals, core personnel review claims and submit vendor invoices, and Finance approves and pays them by PayNow.

Next.js (App Router) · TypeScript · Tailwind + shadcn/ui · Supabase (Postgres, Auth, Storage, RLS) · Vercel.

Reviewed by CodeRabbit (`.coderabbit.yaml`) and Qodo (`.pr_agent.toml`). The engineering rules are in [CLAUDE.md](CLAUDE.md).

## Dev
Needs Docker (for the local Supabase stack).
```bash
pnpm install
cp .env.example .env.local        # fill in the keys `pnpm supabase status` prints
pnpm supabase start               # local Postgres, Auth, Storage and Mailpit
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
