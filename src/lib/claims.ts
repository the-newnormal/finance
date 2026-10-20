import "server-only";
import type { ClaimRow } from "@/components/claims-table";
import { fetchAll } from "@/lib/fetch-all";
import { createClient } from "@/lib/supabase/server";
import type { Claim } from "@/lib/types";

export const ROW_COLUMNS = "id, kind, status, claimant_name, description, amount_cents, vendor_name, created_at, budget_id, category_id, division_id";

type Raw = Pick<Claim, "id" | "kind" | "status" | "claimant_name" | "description" | "amount_cents" | "vendor_name" | "created_at" | "budget_id" | "category_id" | "division_id">;

export { fetchAll };

/**
 * What to call a claim's budget when the viewer can't read it. Only Finance reads the reserve (0006),
 * but Finance can import a reimbursement from it for anyone, so its claimant sees it as "Reserve".
 * A claim with no division is always the reserve's.
 */
export function hiddenBudgetName(divisionId: string | null) {
  return divisionId === null ? "Reserve" : "—";
}

/** What a claim paid for, as the Bank page's ledger names it: its description, and the vendor for an invoice. */
export function paidFor(c: Pick<Claim, "kind" | "description" | "vendor_name">): string {
  return c.kind === "invoice" && c.vendor_name ? `${c.description} · ${c.vendor_name}` : c.description;
}

/** Adds budget and category names to claim rows, for ClaimsTable. Every name is read; a failure throws. */
export async function withNames(rows: Raw[]): Promise<ClaimRow[]> {
  if (!rows.length) return [];
  const supabase = await createClient();
  const names = async (table: "budgets" | "categories", ids: string[]) => {
    const map = new Map<string, string>();
    // 200 ids per request keeps the URL short; each request returns at most 200 rows.
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.from(table).select("id, name").in("id", ids.slice(i, i + 200));
      if (error) throw new Error(`${table} read failed: ${error.code}`);
      for (const r of data ?? []) map.set(r.id as string, r.name as string);
    }
    return map;
  };
  const [budget, cat] = await Promise.all([
    names("budgets", [...new Set(rows.map((r) => r.budget_id))]),
    names("categories", [...new Set(rows.map((r) => r.category_id))]),
  ]);
  return rows.map((r) => ({ ...r, budgetName: budget.get(r.budget_id) ?? hiddenBudgetName(r.division_id), categoryName: cat.get(r.category_id) ?? "—" }));
}
