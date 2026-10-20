import type { ClaimStatus } from "@/lib/types";

/** Which date a date range applies to: when the claim was submitted, or when it was paid. */
export type ExportDateField = "submitted" | "paid";

/** The claims export's filters (/api/export). null means "any". Dates are Singapore calendar dates. */
export interface ExportFilters {
  from: string | null;
  to: string | null;
  dates: ExportDateField;
  divisionId: string | null;
  budgetId: string | null;
  status: ClaimStatus | null;
}

const STATUSES: readonly ClaimStatus[] = ["pending_review", "pending_finance", "approved", "rejected", "paid"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Reads the export's query string. A blank field means "any". Anything else malformed is refused
 * with a message for Finance, rather than silently exporting more (or fewer) claims than asked for.
 */
export function parseExportFilters(params: URLSearchParams): { ok: true; filters: ExportFilters } | { ok: false; error: string } {
  const get = (k: string) => params.get(k)?.trim() || null;
  const from = get("from");
  const to = get("to");
  if ((from && !isDate(from)) || (to && !isDate(to))) return { ok: false, error: "Enter dates as YYYY-MM-DD." };
  if (from && to && from > to) return { ok: false, error: "The start date is after the end date." };
  const dates = get("dates") ?? "submitted";
  if (dates !== "submitted" && dates !== "paid") return { ok: false, error: "Choose submitted or paid dates." };
  const divisionId = get("division");
  const budgetId = get("budget");
  if ((divisionId && !UUID.test(divisionId)) || (budgetId && !UUID.test(budgetId))) return { ok: false, error: "Choose a division and budget from the lists." };
  const status = get("status");
  if (status && !STATUSES.includes(status as ClaimStatus)) return { ok: false, error: "Choose a status from the list." };
  return { ok: true, filters: { from, to, dates, divisionId, budgetId, status: status as ClaimStatus | null } };
}

/** The moment a Singapore calendar day starts, as an ISO timestamp (+08:00, no daylight saving). */
export function singaporeDayStart(date: string): string {
  return `${date}T00:00:00+08:00`;
}

/** The Singapore calendar day after `date` (YYYY-MM-DD). */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Whether a Singapore date (YYYY-MM-DD) falls in the filters' range, both ends included. */
export function inRange(date: string, f: Pick<ExportFilters, "from" | "to">): boolean {
  return (!f.from || date >= f.from) && (!f.to || date <= f.to);
}
