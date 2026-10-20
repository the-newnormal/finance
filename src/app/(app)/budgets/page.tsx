import Link from "next/link";
import { BudgetBar } from "@/components/budget-bar";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { fetchAll } from "@/lib/fetch-all";
import { formatSGD } from "@/lib/money";
import { requireReviewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { isFinance, type BudgetTotals, type Division } from "@/lib/types";

export const metadata = { title: "Budgets" };

type Sums = Pick<BudgetTotals, "guideline_cents" | "approved_cents" | "paid_cents">;
const sum = (rows: Sums[], k: keyof Sums) => rows.reduce((s, r) => s + Number(r[k]), 0);

export default async function BudgetsPage() {
  const me = await requireReviewer();
  const supabase = await createClient();
  // budget_totals is security_invoker: RLS hands each person only the budgets they have purview over.
  const [all, divisions] = await Promise.all([
    fetchAll<BudgetTotals>((from, to) => supabase.from("budget_totals").select("*").order("budget_id").range(from, to)),
    fetchAll<Division>((from, to) => supabase.from("divisions").select("id, name").order("id").range(from, to)),
  ]);
  // The reserve (Finance only) sits apart: it belongs to no division and has no guidelines.
  const reserve = all.find((b) => b.is_reserve);
  const budgets = all.filter((b) => !b.is_reserve).sort((a, b) => a.name.localeCompare(b.name));
  divisions.sort((a, b) => a.name.localeCompare(b.name));
  const groups = divisions
    .map((d) => ({ division: d, budgets: budgets.filter((b) => b.division_id === d.id) }))
    .filter((g) => g.budgets.length);

  return (
    <>
      <PageHeader title="Budgets" description={isFinance(me) ? "Every division and budget." : "Budgets for the divisions you lead."} />
      <Card className="mb-8 p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-ink-soft">Total guidelines</span>
          <span className="font-serif text-3xl font-semibold tabular-nums">{formatSGD(sum(budgets, "guideline_cents"))}</span>
        </div>
        <BudgetBar allocated={sum(budgets, "guideline_cents")} committed={sum(budgets, "approved_cents")} spent={sum(budgets, "paid_cents")} />
      </Card>

      {reserve && (
        <Link href="/reserve" className="mb-8 block">
          <Card className="p-5 transition-shadow hover:shadow-md">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">Reserve</div>
                <div className="text-xs text-ink-soft">Outside every division · Finance only</div>
              </div>
              <div className="text-right font-serif text-lg font-semibold tabular-nums">{formatSGD(Number(reserve.funded_cents))}</div>
            </div>
            <BudgetBar allocated={Number(reserve.funded_cents)} committed={Number(reserve.approved_cents)} spent={Number(reserve.paid_cents)} />
          </Card>
        </Link>
      )}

      {groups.length === 0 && <p className="text-ink-soft">No budgets yet.</p>}
      <div className="grid gap-8">
        {groups.map(({ division, budgets }) => (
          <section key={division.id}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-2xl font-semibold">{division.name}</h2>
              <span className="text-sm text-ink-soft tabular-nums">{formatSGD(sum(budgets, "guideline_cents"))} across {budgets.length} {budgets.length === 1 ? "budget" : "budgets"}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {budgets.map((b) => (
                <Link key={b.budget_id} href={`/budgets/${b.budget_id}`}>
                  <Card className="p-5 transition-shadow hover:shadow-md">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{b.name}</div>
                        <div className="text-xs text-ink-soft">
                          {b.kind === "event" ? "Event" : "General"}{!b.active && " · Closed"}
                          {Number(b.pending_cents) > 0 && ` · ${formatSGD(Number(b.pending_cents))} awaiting approval`}
                        </div>
                      </div>
                      <div className="text-right font-serif text-lg font-semibold tabular-nums">{formatSGD(Number(b.guideline_cents))}</div>
                    </div>
                    <BudgetBar allocated={Number(b.guideline_cents)} committed={Number(b.approved_cents)} spent={Number(b.paid_cents)} />
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
