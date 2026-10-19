type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string } | null }>;

/**
 * Every row a query returns, read 1,000 at a time (the API's per-request cap), so lists and totals
 * are never silently cut short. A failed read throws rather than return a partial list.
 *
 * `page(from, to)` must order by a unique key, oldest first (e.g. created_at, id ascending): rows
 * added while reading then land after the ones already read, instead of shifting the pages and
 * repeating a row. Sort newest-first in memory afterwards if needed.
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
