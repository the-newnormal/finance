import { PageHeader } from "@/components/page-header";
import { fetchAll } from "@/lib/fetch-all";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Category, Division, Pool } from "@/lib/types";
import { SetupManager } from "./setup-manager";

export const metadata = { title: "Setup" };

export default async function SetupPage() {
  await requireAdmin();
  const supabase = await createClient();
  // Every row: an edit form showing a missing budget as $0 would save over the real amount.
  const [divisions, categories, pools, budgets] = await Promise.all([
    fetchAll<Division>((f, t) => supabase.from("divisions").select("id, name").order("id").range(f, t)),
    fetchAll<Category>((f, t) => supabase.from("categories").select("id, name, active").order("id").range(f, t)),
    fetchAll<Pool>((f, t) => supabase.from("pools").select("id, name, kind, division_id, active").order("id").range(f, t)),
    fetchAll<{ pool_id: string; allocated_cents: number }>((f, t) => supabase.from("pool_budgets").select("pool_id, allocated_cents").order("pool_id").range(f, t)),
  ]);
  const byName = <T extends { name: string }>(rows: T[]) => rows.sort((x, y) => x.name.localeCompare(y.name));
  const allocated = new Map(budgets.map((b) => [b.pool_id, Number(b.allocated_cents)]));

  return (
    <>
      <PageHeader title="Setup" description="Divisions, budgets and events, and claim categories." />
      <SetupManager
        divisions={byName(divisions)}
        categories={byName(categories)}
        pools={byName(pools).map((p) => ({ ...p, allocated_cents: allocated.get(p.id) ?? 0 }))}
      />
    </>
  );
}
