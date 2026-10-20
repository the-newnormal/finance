import { BudgetBar } from "@/components/budget-bar";
import { ClaimsTable } from "@/components/claims-table";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { fetchAll, ROW_COLUMNS, withNames } from "@/lib/claims";
import { singaporeToday } from "@/lib/dates";
import { formatDate, formatSGD } from "@/lib/money";
import { requireFinance } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { BudgetTotals, ReserveAddition } from "@/lib/types";
import { ReserveForm } from "./reserve-form";

export const metadata = { title: "Reserve" };

// The reserve: New Normal's one perpetual budget outside every division. Only Finance sees it
// (RLS), claims against it, or adds to it.
export default async function ReservePage() {
  await requireFinance();
  const supabase = await createClient();
  const { data: reserve, error } = await supabase.from("budget_totals").select("*").eq("is_reserve", true).maybeSingle<BudgetTotals>();
  if (error) throw new Error(`reserve read failed: ${error.code}`);
  if (!reserve) throw new Error("reserve read failed: missing");

  const [additions, claims] = await Promise.all([
    fetchAll<ReserveAddition>((from, to) =>
      supabase.from("reserve_additions").select("id, amount_cents, added_on, note, actor_name").order("id").range(from, to)),
    fetchAll((from, to) =>
      supabase.from("claims").select(ROW_COLUMNS).eq("budget_id", reserve.budget_id).order("created_at").order("id").range(from, to),
    ).then(withNames),
  ]);
  additions.reverse(); // read oldest first (stable paging), show newest first
  claims.reverse();

  const funded = Number(reserve.funded_cents);
  const used = Number(reserve.approved_cents) + Number(reserve.paid_cents);

  return (
    <>
      <PageHeader title="Reserve" description="A perpetual budget outside every division. Only Finance can see it, add to it or claim against it." />
      <Card className="mb-6 p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-ink-soft">Available</span>
          <span className="font-serif text-3xl font-semibold tabular-nums">{formatSGD(funded - used)}</span>
        </div>
        <BudgetBar allocated={funded} committed={Number(reserve.approved_cents)} spent={Number(reserve.paid_cents)} />
        <p className="mt-3 text-xs text-ink-soft">
          {formatSGD(funded)} added in total{Number(reserve.pending_cents) > 0 && ` · ${formatSGD(Number(reserve.pending_cents))} awaiting approval`}.
          Claim against it by choosing <strong>Reserve</strong> as the budget on a new claim.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Claims</CardTitle></CardHeader>
            <CardContent><ClaimsTable claims={claims} showClaimant empty="No claims against the reserve yet." /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Additions</CardTitle></CardHeader>
            <CardContent>
              {additions.length === 0 ? (
                <p className="px-1 py-8 text-center text-sm text-ink-soft">Nothing added yet.</p>
              ) : (
                <Table>
                  <THead><tr><TH>Date</TH><TH>Note</TH><TH>By</TH><TH className="text-right">Amount</TH></tr></THead>
                  <TBody>
                    {additions.map((a) => (
                      <tr key={a.id}>
                        <TD className="whitespace-nowrap text-ink-soft">{formatDate(a.added_on)}</TD>
                        <TD className="min-w-40">{a.note}</TD>
                        <TD className="whitespace-nowrap">{a.actor_name}</TD>
                        <TD className={`whitespace-nowrap text-right tabular-nums ${a.amount_cents < 0 ? "text-danger" : ""}`}>{formatSGD(Number(a.amount_cents))}</TD>
                      </tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
        <Card className="content-start">
          <CardHeader>
            <CardTitle>Add to the reserve</CardTitle>
            <CardDescription>Additions are never edited or deleted; correct a mistake with an entry the other way.</CardDescription>
          </CardHeader>
          <CardContent><ReserveForm today={singaporeToday()} /></CardContent>
        </Card>
      </div>
    </>
  );
}
