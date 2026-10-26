import { BudgetBar } from "@/components/budget-bar";
import { ClaimsTable } from "@/components/claims-table";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { fetchAll, ROW_COLUMNS, withNames } from "@/lib/claims";
import { singaporeToday } from "@/lib/dates";
import Link from "next/link";
import { formatDate, formatSGD } from "@/lib/money";
import { requireFinance } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { BudgetTotals, ReserveAddition } from "@/lib/types";
import { ReserveForm } from "./reserve-form";
import { ReverseButton } from "./reverse-button";

export const metadata = { title: "Reserve" };

// The reserve: Normal's one perpetual budget outside every division. Only Finance sees it
// (RLS), claims against it, or adds to it.
export default async function ReservePage() {
  await requireFinance();
  const supabase = await createClient();
  const { data: reserve, error } = await supabase.from("budget_totals").select("*").eq("is_reserve", true).maybeSingle<BudgetTotals>();
  if (error) throw new Error(`reserve read failed: ${error.code}`);
  if (!reserve) throw new Error("reserve read failed: missing");

  const [additions, claims, budgets] = await Promise.all([
    fetchAll<ReserveAddition>((from, to) =>
      supabase.from("reserve_additions").select("id, amount_cents, added_on, note, actor_name, reverses_id").order("id").range(from, to)),
    fetchAll((from, to) =>
      supabase.from("claims").select(ROW_COLUMNS).eq("budget_id", reserve.budget_id).order("created_at").order("id").range(from, to),
    ).then(withNames),
    fetchAll<BudgetTotals>((from, to) => supabase.from("budget_totals").select("*").eq("is_reserve", false).order("budget_id").range(from, to)),
  ]);
  // Budgets still owing the reserve, most owed first.
  const owing = budgets
    .map((b) => ({ id: b.budget_id, name: b.name, owed: Number(b.loaned_cents) - Number(b.repaid_cents) }))
    .filter((b) => b.owed > 0)
    .sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name));
  const reversed = new Set(additions.map((a) => a.reverses_id).filter((x): x is number => x !== null));
  additions.reverse(); // read oldest first (stable paging), show newest first
  claims.reverse();

  const funded = Number(reserve.funded_cents);
  const available = Number(reserve.available_cents);
  const lent = Number(reserve.lent_out_cents);

  return (
    <>
      <PageHeader title="Reserve" description="A perpetual budget outside every division. Only Finance can see it, add to it or claim against it." />
      <Card className="mb-6 p-6">
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-soft">In reserve</div>
            <div className={`font-serif text-3xl font-semibold tabular-nums ${available < 0 ? "text-danger" : ""}`}>{formatSGD(available)}</div>
          </div>
          <div className="sm:text-right">
            <div className="text-xs uppercase tracking-wide text-ink-soft">On loan</div>
            <div className="font-serif text-3xl font-semibold tabular-nums">{formatSGD(lent)}</div>
          </div>
        </div>
        {/* Out of everything added: disbursed, approved, and on loan to budgets until repaid; what's left is in reserve. */}
        <BudgetBar allocated={funded} committed={Number(reserve.approved_cents)} spent={Number(reserve.paid_cents)} loaned={Number(reserve.lent_out_cents)} />
        <p className="mt-3 text-xs text-ink-soft">
          {formatSGD(funded)} added in total{Number(reserve.pending_cents) > 0 && ` · ${formatSGD(Number(reserve.pending_cents))} awaiting approval`}.
          Money leaves the reserve only through a claim or a loan to a budget. Claim against it by choosing <strong>Reserve</strong> as the budget on a new claim; lend to a budget from that budget&rsquo;s page.
        </p>
      </Card>
      {owing.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>On loan</CardTitle>
            <CardDescription>Budgets that still owe the reserve.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {owing.map((b) => (
                <li key={b.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <Link href={`/budgets/${b.id}`} className="font-medium underline-offset-4 hover:underline">{b.name}</Link>
                  <span className="tabular-nums">{formatSGD(b.owed)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_380px]">
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
                  <THead><tr><TH>Date</TH><TH>Note</TH><TH>By</TH><TH className="text-right">Amount</TH><TH /></tr></THead>
                  <TBody>
                    {additions.map((a) => (
                      <tr key={a.id}>
                        <TD className="whitespace-nowrap text-ink-soft">{formatDate(a.added_on)}</TD>
                        <TD className="min-w-40">{a.note}</TD>
                        <TD className="whitespace-nowrap">{a.actor_name}</TD>
                        <TD className={`whitespace-nowrap text-right tabular-nums ${a.amount_cents < 0 ? "text-danger" : ""}`}>{formatSGD(Number(a.amount_cents))}</TD>
                        <TD className="text-right">
                          {a.amount_cents > 0 && !a.reverses_id && !reversed.has(a.id) && <ReverseButton id={a.id} />}
                          {reversed.has(a.id) && <span className="text-xs text-ink-soft">Reversed</span>}
                        </TD>
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
            <CardDescription>Money in only, and never edited or deleted. Money leaves the reserve only through a claim or a loan.</CardDescription>
          </CardHeader>
          <CardContent><ReserveForm today={singaporeToday()} /></CardContent>
        </Card>
      </div>
    </>
  );
}
