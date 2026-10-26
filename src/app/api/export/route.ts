import { NextResponse, type NextRequest } from "next/server";
import { fetchAll } from "@/lib/claims";
import { csvCell } from "@/lib/csv";
import { singaporeDate } from "@/lib/dates";
import { inRange, nextDay, parseExportFilters, singaporeDayStart } from "@/lib/export-filters";
import { getMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_GROUP_LABEL, isFinance, type CategoryGroup } from "@/lib/types";

// CSV of claims, for Finance: every claim, or those matching the filters (by submitted or paid
// date, division, budget, status). Read as the signed-in user (RLS), and never payout details.
export async function GET(request: NextRequest) {
  const me = await getMe();
  if (!me?.member || !isFinance(me.member)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = parseExportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) return new NextResponse(parsed.error, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const f = parsed.filters;

  const supabase = await createClient();
  let claims, budgets, categories, events;
  try {
    // Every row, page by page; a failed read fails the export rather than dropping rows.
    [claims, budgets, categories, events] = await Promise.all([
      fetchAll((from, to) => {
        let q = supabase.from("claims")
          .select("id, created_at, kind, status, claimant_name, budget_id, category_id, expense_date, vendor_name, due_date, description, amount_cents, payout_type, payment_reference");
        if (f.divisionId) q = q.eq("division_id", f.divisionId);
        if (f.budgetId) q = q.eq("budget_id", f.budgetId);
        if (f.status) q = q.eq("status", f.status);
        // Submitted dates are Singapore days: from the start of `from` to the start of the day after `to`.
        if (f.dates === "submitted" && f.from) q = q.gte("created_at", singaporeDayStart(f.from));
        if (f.dates === "submitted" && f.to) q = q.lt("created_at", singaporeDayStart(nextDay(f.to)));
        return q.order("created_at").order("id").range(from, to);
      }),
      fetchAll((from, to) => supabase.from("budgets").select("id, name").order("id").range(from, to)),
      fetchAll((from, to) => supabase.from("categories").select("id, name, category_group").order("id").range(from, to)),
      fetchAll((from, to) => supabase.from("claim_events").select("claim_id, at").eq("action", "paid").order("id").range(from, to)),
    ]);
  } catch (e) {
    console.error("export failed", { code: e instanceof Error ? e.message : "unknown" });
    return NextResponse.json({ error: "The export couldn't be built. Try again." }, { status: 500 });
  }
  const budget = new Map(budgets.map((b) => [b.id, b.name]));
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  // Each category's group (0011), for totals by kind of spending; blank for one not grouped yet.
  const catGroup = new Map(categories.map((c) => [c.id, c.category_group ? CATEGORY_GROUP_LABEL[c.category_group as CategoryGroup] : ""]));
  const paidOn = new Map(events.map((e) => [e.claim_id, singaporeDate(e.at)]));
  // Paid dates come from each claim's payment event; a claim not yet paid has none, so it's left out.
  if (f.dates === "paid" && (f.from || f.to)) {
    claims = claims.filter((c) => paidOn.has(c.id) && inRange(paidOn.get(c.id)!, f));
  }
  claims.reverse(); // newest first

  const rows = [
    // Dates are Singapore calendar dates, as the portal shows them.
    ["id", "submitted", "kind", "status", "claimant", "budget", "category_group", "category", "purchase_date", "vendor", "due_date", "description", "amount_sgd", "payout_method", "paid_on", "payment_ref"],
    ...claims.map((c) => [
      c.id, singaporeDate(c.created_at), c.kind, c.status, c.claimant_name, budget.get(c.budget_id) ?? "", catGroup.get(c.category_id) ?? "", cat.get(c.category_id) ?? "",
      c.expense_date ?? "", c.vendor_name ?? "", c.due_date ?? "", c.description, (Number(c.amount_cents) / 100).toFixed(2), c.payout_type ?? "", paidOn.get(c.id) ?? "", c.payment_reference ?? "",
    ]),
  ];
  const csv = rows.map((r) => r.map((v) => csvCell(String(v))).join(",")).join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nn-claims-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
