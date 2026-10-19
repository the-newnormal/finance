import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Category, Division, Pool } from "@/lib/types";
import { SetupManager } from "./setup-manager";

export const metadata = { title: "Setup" };

export default async function SetupPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [divisions, categories, pools, budgets] = await Promise.all([
    supabase.from("divisions").select("id, name").order("name"),
    supabase.from("categories").select("id, name, active").order("name"),
    supabase.from("pools").select("id, name, kind, division_id, active").order("name"),
    supabase.from("pool_budgets").select("pool_id, allocated_cents"),
  ]);
  for (const r of [divisions, categories, pools, budgets]) if (r.error) throw new Error(`setup page read failed: ${r.error.code}`);
  const allocated = new Map((budgets.data ?? []).map((b) => [b.pool_id as string, b.allocated_cents as number]));

  return (
    <>
      <PageHeader title="Setup" description="Divisions, budgets and events, and claim categories." />
      <SetupManager
        divisions={(divisions.data ?? []) as Division[]}
        categories={(categories.data ?? []) as Category[]}
        pools={((pools.data ?? []) as Pool[]).map((p) => ({ ...p, allocated_cents: allocated.get(p.id) ?? 0 }))}
      />
    </>
  );
}
