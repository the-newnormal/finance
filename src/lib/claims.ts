import "server-only";
import type { ClaimRow } from "@/components/claims-table";
import { createClient } from "@/lib/supabase/server";
import type { Claim } from "@/lib/types";

export const ROW_COLUMNS = "id, kind, status, claimant_name, description, amount_cents, vendor_name, created_at, pool_id, category_id";

type Raw = Pick<Claim, "id" | "kind" | "status" | "claimant_name" | "description" | "amount_cents" | "vendor_name" | "created_at" | "pool_id" | "category_id">;

/** Adds pool and category names to claim rows, for ClaimsTable. */
export async function withNames(rows: Raw[]): Promise<ClaimRow[]> {
  if (!rows.length) return [];
  const supabase = await createClient();
  const [pools, categories] = await Promise.all([
    supabase.from("pools").select("id, name").in("id", [...new Set(rows.map((r) => r.pool_id))]),
    supabase.from("categories").select("id, name").in("id", [...new Set(rows.map((r) => r.category_id))]),
  ]);
  const pool = new Map((pools.data ?? []).map((p) => [p.id as string, p.name as string]));
  const cat = new Map((categories.data ?? []).map((c) => [c.id as string, c.name as string]));
  return rows.map((r) => ({ ...r, poolName: pool.get(r.pool_id) ?? "—", categoryName: cat.get(r.category_id) ?? "—" }));
}
