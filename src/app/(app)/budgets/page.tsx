import Link from "next/link";
import { BudgetBar } from "@/components/budget-bar";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { fetchAll } from "@/lib/fetch-all";
import { formatSGD } from "@/lib/money";
import { requireReviewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { isFinance, type Division, type PoolTotals } from "@/lib/types";

export const metadata = { title: "Budgets" };

export default async function BudgetsPage() {
  const me = await requireReviewer();
  const supabase = await createClient();
  // pool_totals is security_invoker: RLS hands each person only the budgets they have purview over.
  const [pools, divisions] = await Promise.all([
    fetchAll<PoolTotals>((from, to) => supabase.from("pool_totals").select("*").order("pool_id").range(from, to)),
    fetchAll<Division>((from, to) => supabase.from("divisions").select("id, name").order("id").range(from, to)),
  ]);
  pools.sort((a, b) => a.name.localeCompare(b.name));
  divisions.sort((a, b) => a.name.localeCompare(b.name));
  const groups = divisions
    .map((d) => ({ division: d, pools: pools.filter((p) => p.division_id === d.id) }))
    .filter((g) => g.pools.length);
  const sum = (k: keyof Pick<PoolTotals, "allocated_cents" | "approved_cents" | "paid_cents">) =>
    pools.reduce((s, p) => s + Number(p[k]), 0);

  return (
    <>
      <PageHeader title="Budgets" description={isFinance(me) ? "Every division and budget." : "Budgets for your divisions."} />
      <Card className="mb-8 p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-ink-soft">Total allocated</span>
          <span className="font-serif text-3xl font-semibold tabular-nums">{formatSGD(sum("allocated_cents"))}</span>
        </div>
        <BudgetBar allocated={sum("allocated_cents")} committed={sum("approved_cents")} spent={sum("paid_cents")} />
      </Card>

      {groups.length === 0 && <p className="text-ink-soft">No budgets yet.</p>}
      <div className="grid gap-8">
        {groups.map(({ division, pools }) => (
          <section key={division.id}>
            <h2 className="mb-3 font-serif text-2xl font-semibold">{division.name}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {pools.map((p) => (
                <Link key={p.pool_id} href={`/budgets/${p.pool_id}`}>
                  <Card className="p-5 transition-shadow hover:shadow-md">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-ink-soft">
                          {p.kind === "event" ? "Event" : "General"}{!p.active && " · Closed"}
                          {Number(p.pending_cents) > 0 && ` · ${formatSGD(Number(p.pending_cents))} awaiting approval`}
                        </div>
                      </div>
                      <div className="text-right font-serif text-lg font-semibold tabular-nums">{formatSGD(Number(p.allocated_cents))}</div>
                    </div>
                    <BudgetBar allocated={Number(p.allocated_cents)} committed={Number(p.approved_cents)} spent={Number(p.paid_cents)} />
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
