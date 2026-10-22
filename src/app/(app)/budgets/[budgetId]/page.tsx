import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BudgetBar } from "@/components/budget-bar";
import { ClaimsTable } from "@/components/claims-table";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchAll, ROW_COLUMNS, withNames } from "@/lib/claims";
import { singaporeToday } from "@/lib/dates";
import { formatDate, formatSGD } from "@/lib/money";
import { requireReviewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { FUND_KIND_LABEL, isFinance, type BudgetFund, type BudgetTotals, type GuidelineTotals } from "@/lib/types";
import { FundingForms, type FundingAccount } from "./funding-forms";

export default async function BudgetPage({ params }: PageProps<"/budgets/[budgetId]">) {
  const { budgetId } = await params;
  const me = await requireReviewer();
  const finance = isFinance(me);
  const supabase = await createClient();
  const { data: budget, error } = await supabase.from("budget_totals").select("*").eq("budget_id", budgetId).maybeSingle<BudgetTotals>();
  if (error) throw new Error(`budget read failed: ${error.code}`); // an outage, not a missing budget
  if (!budget) notFound();

  const [guidelines, claims, funds, financeData] = await Promise.all([
    fetchAll<GuidelineTotals>((from, to) =>
      supabase.from("guideline_totals").select("*").eq("budget_id", budgetId).order("category_id").range(from, to)),
    fetchAll((from, to) =>
      supabase.from("claims").select(ROW_COLUMNS).eq("budget_id", budgetId).order("created_at").order("id").range(from, to),
    ).then(withNames).then((rows) => rows.reverse()), // read oldest first (stable paging), show newest first
    // budget_funds: the division's leads and Finance (RLS), like the budget's other amounts.
    fetchAll<BudgetFund>((from, to) =>
      supabase.from("budget_funds").select("id, budget_id, kind, amount_cents, entry_date, note, actor_name")
        .eq("budget_id", budgetId).order("entry_date").order("id").range(from, to)).then((rows) => rows.reverse()),
    finance && !budget.is_reserve ? financeReads(supabase) : null,
  ]);
  guidelines.sort((a, b) => a.category_name.localeCompare(b.category_name));

  const committed = Number(budget.grant_committed_cents);
  const granted = Number(budget.granted_cents);
  const loaned = Number(budget.loaned_cents);
  const repaid = Number(budget.repaid_cents);
  const available = Number(budget.available_cents);
  const owed = Math.max(loaned - repaid, 0);
  const funding: [string, number][] = [
    ["Grant committed", committed],
    ["Grants received", granted],
    ["Still to come", Math.max(committed - granted, 0)],
    ["Loans from the reserve", loaned],
    ["Repaid", repaid],
    ["Still owed", owed],
  ];

  return (
    <>
      <Link href="/budgets" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"><ArrowLeft className="size-4" /> Budgets</Link>
      <PageHeader title={budget.name}
        description={`${budget.kind === "event" ? "Event" : "General"}${budget.active ? "" : " · Closed"} · ${formatSGD(Number(budget.guideline_cents))} in guidelines · ${formatSGD(Number(budget.pending_cents))} awaiting approval`} />
      <Card className="mb-6 p-5">
        <BudgetBar allocated={Number(budget.guideline_cents)} committed={Number(budget.approved_cents)} spent={Number(budget.paid_cents)} />
      </Card>
      {!budget.is_reserve && (
        <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <Card className="content-start">
            <CardHeader>
              <CardTitle>Funding</CardTitle>
              <CardDescription>Grants received and loans from the reserve, less repayments and approved and disbursed claims.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className={`rounded-xl border p-4 ${available < 0 ? "border-danger/40 bg-danger/5" : "border-line"}`}>
                <div className="text-xs uppercase tracking-wide text-ink-soft">Available to spend</div>
                <div className={`font-serif text-3xl font-semibold tabular-nums ${available < 0 ? "text-danger" : ""}`}>{formatSGD(available)}</div>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                {funding.map(([label, cents]) => (
                  <div key={label}>
                    <dt className="text-xs text-ink-soft">{label}</dt>
                    <dd className="tabular-nums">{formatSGD(cents)}</dd>
                  </div>
                ))}
              </dl>
              <div>
                <h3 className="mb-2 text-sm font-medium">History</h3>
                {funds.length === 0 ? (
                  <p className="text-sm text-ink-soft">No grants or loans yet.</p>
                ) : (
                  <ul className="grid gap-2">
                    {funds.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-line pb-2 text-sm last:border-0">
                        <span>
                          <span className="font-medium">{FUND_KIND_LABEL[f.kind]}</span>
                          <span className="text-ink-soft"> · {formatDate(f.entry_date)} · {f.note} · {f.actor_name}</span>
                        </span>
                        <span className={`tabular-nums ${f.kind === "repayment" ? "text-ink-soft" : ""}`}>
                          {f.kind === "repayment" ? "−" : "+"}{formatSGD(Number(f.amount_cents))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
          {financeData && (
            <Card className="content-start">
              <CardHeader><CardTitle>Fund this budget</CardTitle></CardHeader>
              <CardContent>
                <FundingForms budgetId={budget.budget_id} today={singaporeToday()} accounts={financeData.accounts}
                  reserveAvailable={financeData.reserveAvailable} owed={owed} committed={committed} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
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

// Finance's forms need the open bank accounts and what the reserve has to lend (both Finance only, RLS).
async function financeReads(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [accounts, reserve] = await Promise.all([
    supabase.from("bank_balances").select("account_id, name, bank, last4").eq("active", true).order("name"),
    supabase.from("budget_totals").select("available_cents").eq("is_reserve", true).maybeSingle<Pick<BudgetTotals, "available_cents">>(),
  ]);
  if (accounts.error) console.error("bank accounts read failed", { code: accounts.error.code });
  if (reserve.error) console.error("reserve read failed", { code: reserve.error.code });
  return {
    accounts: (accounts.data ?? []) as FundingAccount[],
    reserveAvailable: reserve.data ? Number(reserve.data.available_cents) : null,
  };
}
