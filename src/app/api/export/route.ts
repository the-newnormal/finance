import { NextResponse } from "next/server";
import { csvCell } from "@/lib/csv";
import { getMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { isFinance } from "@/lib/types";

const PAGE_SIZE = 1000;

async function fetchAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

// CSV of every claim, for Finance. Read as the signed-in user (RLS), and never payout details.
export async function GET() {
  const me = await getMe();
  if (!me?.member || !isFinance(me.member)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createClient();
  const [claims, pools, categories, events] = await Promise.all([
    fetchAll((from, to) => supabase.from("claims").select("id, created_at, kind, status, claimant_name, pool_id, category_id, vendor_name, description, amount_cents, payout_type, payment_reference").order("created_at", { ascending: false }).range(from, to)),
    fetchAll((from, to) => supabase.from("pools").select("id, name").range(from, to)),
    fetchAll((from, to) => supabase.from("categories").select("id, name").range(from, to)),
    fetchAll((from, to) => supabase.from("claim_events").select("claim_id, at").eq("action", "paid").range(from, to)),
  ]);
  const pool = new Map(pools.map((p) => [p.id, p.name]));
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const paidOn = new Map(events.map((e) => [e.claim_id, String(e.at).slice(0, 10)]));

  const rows = [
    ["id", "submitted", "kind", "status", "claimant", "budget", "category", "vendor", "description", "amount_sgd", "payout_method", "paid_on", "payment_ref"],
    ...claims.map((c) => [
      c.id, String(c.created_at).slice(0, 10), c.kind, c.status, c.claimant_name, pool.get(c.pool_id) ?? "", cat.get(c.category_id) ?? "",
      c.vendor_name ?? "", c.description, (Number(c.amount_cents) / 100).toFixed(2), c.payout_type, paidOn.get(c.id) ?? "", c.payment_reference ?? "",
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
