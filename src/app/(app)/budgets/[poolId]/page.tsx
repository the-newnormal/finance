import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BudgetBar } from "@/components/budget-bar";
import { ClaimsTable } from "@/components/claims-table";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROW_COLUMNS, withNames } from "@/lib/claims";
import { formatSGD } from "@/lib/money";
import { requireReviewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { PoolTotals } from "@/lib/types";

export default async function PoolPage({ params }: PageProps<"/budgets/[poolId]">) {
  const { poolId } = await params;
  await requireReviewer();
  const supabase = await createClient();
  const { data: pool } = await supabase.from("pool_totals").select("*").eq("pool_id", poolId).maybeSingle<PoolTotals>();
  if (!pool) notFound();

  const { data } = await supabase.from("claims").select(ROW_COLUMNS).eq("pool_id", poolId).order("created_at", { ascending: false }).limit(500);
  const claims = await withNames(data ?? []);
  const byCategory = new Map<string, number>();
  for (const c of claims) {
    if (c.status === "approved" || c.status === "paid") byCategory.set(c.categoryName, (byCategory.get(c.categoryName) ?? 0) + c.amount_cents);
  }

  return (
    <>
      <Link href="/budgets" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"><ArrowLeft className="size-4" /> Budgets</Link>
      <PageHeader title={pool.name} description={`${formatSGD(Number(pool.allocated_cents))} allocated · ${formatSGD(Number(pool.pending_cents))} awaiting approval`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader><CardTitle>Claims</CardTitle></CardHeader>
          <CardContent><ClaimsTable claims={claims} showClaimant empty="No claims against this budget yet." /></CardContent>
        </Card>
        <div className="grid content-start gap-6">
          <Card className="p-5"><BudgetBar allocated={Number(pool.allocated_cents)} committed={Number(pool.approved_cents)} spent={Number(pool.paid_cents)} /></Card>
          <Card>
            <CardHeader><CardTitle>By category</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {[...byCategory].sort((a, b) => b[1] - a[1]).map(([name, cents]) => (
                <div key={name} className="flex justify-between"><span>{name}</span><span className="tabular-nums">{formatSGD(cents)}</span></div>
              ))}
              {byCategory.size === 0 && <p className="text-ink-soft">Nothing approved yet.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
