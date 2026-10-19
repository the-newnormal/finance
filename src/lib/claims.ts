import "server-only";
import type { ClaimRow } from "@/components/claims-table";
import { createClient } from "@/lib/supabase/server";
import type { Claim } from "@/lib/types";

export const ROW_COLUMNS = "id, kind, status, claimant_name, description, amount_cents, vendor_name, created_at, pool_id, category_id";

type Raw = Pick<Claim, "id" | "kind" | "status" | "claimant_name" | "description" | "amount_cents" | "vendor_name" | "created_at" | "pool_id" | "category_id">;

type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string } | null }>;

/**
 * Every row a query returns, read 1,000 at a time (the API's per-request cap), so lists and totals
 * are never silently cut short. `page(from, to)` must order by a unique key. A failed read throws.
 */
export async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(`read failed: ${error.code ?? "unknown"}`);
    rows.push(...(data ?? []));
    if (!data || data.length < size) return rows;
  }
}

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
