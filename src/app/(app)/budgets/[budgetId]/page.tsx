import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BudgetBar } from "@/components/budget-bar";
import { ClaimsTable } from "@/components/claims-table";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchAll, ROW_COLUMNS, withNames } from "@/lib/claims";
import { fetchAll as fetchAllRows } from "@/lib/fetch-all";
import { formatSGD } from "@/lib/money";
import { requireReviewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { BudgetTotals, GuidelineTotals } from "@/lib/types";

export default async function BudgetPage({ params }: PageProps<"/budgets/[budgetId]">) {
  const { budgetId } = await params;
  await requireReviewer();
  const supabase = await createClient();
  const { data: budget, error } = await supabase.from("budget_totals").select("*").eq("budget_id", budgetId).maybeSingle<BudgetTotals>();
  if (error) throw new Error(`budget read failed: ${error.code}`); // an outage, not a missing budget
  if (!budget) notFound();

  const [guidelines, claims] = await Promise.all([
    fetchAllRows<GuidelineTotals>((from, to) =>
      supabase.from("guideline_totals").select("*").eq("budget_id", budgetId).order("category_id").range(from, to)),
    fetchAll((from, to) =>
      supabase.from("claims").select(ROW_COLUMNS).eq("budget_id", budgetId).order("created_at").order("id").range(from, to),
    ).then(withNames).then((rows) => rows.reverse()), // read oldest first (stable paging), show newest first
  ]);
  guidelines.sort((a, b) => a.category_name.localeCompare(b.category_name));

  return (
    <>
      <Link href="/budgets" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"><ArrowLeft className="size-4" /> Budgets</Link>
      <PageHeader title={budget.name}
        description={`${budget.kind === "event" ? "Event" : "General"}${budget.active ? "" : " · Closed"} · ${formatSGD(Number(budget.guideline_cents))} in guidelines · ${formatSGD(Number(budget.pending_cents))} awaiting approval`} />
      <Card className="mb-6 p-5">
        <BudgetBar allocated={Number(budget.guideline_cents)} committed={Number(budget.approved_cents)} spent={Number(budget.paid_cents)} />
      </Card>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader><CardTitle>Claims</CardTitle></CardHeader>
          <CardContent><ClaimsTable claims={claims} showClaimant empty="No claims against this budget yet." /></CardContent>
        </Card>
        <Card className="content-start">
          <CardHeader><CardTitle>Spend guidelines</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {guidelines.map((g) => {
              const guideline = Number(g.guideline_cents);
              const used = Number(g.approved_cents) + Number(g.paid_cents);
              const over = used > guideline;
              return (
                <div key={g.category_id} className={`grid gap-2 rounded-xl border p-4 ${over ? "border-danger/40 bg-danger/5" : "border-line"}`}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{g.category_name}</span>
                    <span className="tabular-nums">{formatSGD(guideline)}</span>
                  </div>
                  <BudgetBar allocated={guideline} committed={Number(g.approved_cents)} spent={Number(g.paid_cents)} />
                  {Number(g.pending_cents) > 0 && (
                    <div className="text-xs text-ink-soft">{formatSGD(Number(g.pending_cents))} awaiting approval</div>
                  )}
                </div>
              );
            })}
            {guidelines.length === 0 && <p className="text-sm text-ink-soft">No categories provisioned.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
