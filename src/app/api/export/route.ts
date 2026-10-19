import { NextResponse } from "next/server";
import { fetchAll } from "@/lib/claims";
import { csvCell } from "@/lib/csv";
import { singaporeDate } from "@/lib/dates";
import { getMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { isFinance } from "@/lib/types";

// CSV of every claim, for Finance. Read as the signed-in user (RLS), and never payout details.
export async function GET() {
  const me = await getMe();
  if (!me?.member || !isFinance(me.member)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createClient();
  let claims, pools, categories, events;
  try {
    // Every row, page by page; a failed read fails the export rather than dropping rows.
    [claims, pools, categories, events] = await Promise.all([
      fetchAll((from, to) => supabase.from("claims")
        .select("id, created_at, kind, status, claimant_name, pool_id, category_id, expense_date, vendor_name, due_date, description, amount_cents, payout_type, payment_reference")
        .order("created_at").order("id").range(from, to)),
      fetchAll((from, to) => supabase.from("pools").select("id, name").order("id").range(from, to)),
      fetchAll((from, to) => supabase.from("categories").select("id, name").order("id").range(from, to)),
      fetchAll((from, to) => supabase.from("claim_events").select("claim_id, at").eq("action", "paid").order("id").range(from, to)),
    ]);
  } catch (e) {
    console.error("export failed", { code: e instanceof Error ? e.message : "unknown" });
    return NextResponse.json({ error: "The export couldn't be built. Try again." }, { status: 500 });
  }
  const pool = new Map(pools.map((p) => [p.id, p.name]));
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const paidOn = new Map(events.map((e) => [e.claim_id, singaporeDate(e.at)]));
  claims.reverse(); // newest first

  const rows = [
    // Dates are Singapore calendar dates, as the portal shows them.
    ["id", "submitted", "kind", "status", "claimant", "budget", "category", "purchase_date", "vendor", "due_date", "description", "amount_sgd", "payout_method", "paid_on", "payment_ref"],
    ...claims.map((c) => [
      c.id, singaporeDate(c.created_at), c.kind, c.status, c.claimant_name, pool.get(c.pool_id) ?? "", cat.get(c.category_id) ?? "",
      c.expense_date ?? "", c.vendor_name ?? "", c.due_date ?? "", c.description, (Number(c.amount_cents) / 100).toFixed(2), c.payout_type, paidOn.get(c.id) ?? "", c.payment_reference ?? "",
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
