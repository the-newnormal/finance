# finance

New Normal's finance portal: volunteers claim incidentals, core personnel review claims and submit vendor invoices, and Finance approves and pays them by PayNow.

Next.js (App Router) · TypeScript · Tailwind + shadcn/ui · Supabase (Postgres, Auth, Storage, RLS) · Vercel.

Reviewed by CodeRabbit (`.coderabbit.yaml`) and Qodo (`.pr_agent.toml`). The engineering rules are in [CLAUDE.md](CLAUDE.md).

## Dev
```bash
pnpm install
cp .env.example .env.local        # fill in Supabase keys
pnpm dev
```

```bash
pnpm typecheck && pnpm lint && pnpm test
```
