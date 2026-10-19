import { parseCsv } from "@/lib/csv";
import { parseAmountToCents } from "@/lib/money";

/** The import template's columns, in order. */
export const IMPORT_COLUMNS = [
  "member email", "budget", "category", "description", "amount", "purchase date", "paid date", "payment reference", "bank account",
] as const;

/** One row as import_paid_claims takes it (0005_imported_claims.sql). */
export interface ImportRow {
  email: string;
  budget: string;
  category: string;
  description: string;
  amount_cents: number;
  expense_date: string | null;
  paid_on: string;
  reference: string;
  account: string;
}

export type ParsedImport = { ok: true; rows: ImportRow[] } | { ok: false; errors: string[] };

const key = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** "2026-03-14", "14/03/2026" or "14/3/26" (day first, as in Singapore) -> "2026-03-14", or null. */
export function parseDate(input: string): string | null {
  const t = input.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3].length === 2 ? "20" + dmy[3] : dmy[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Reads the filled-in template. Columns are matched by header (any order, any case); every row is
 * checked for what can be checked here, and each problem is reported with its row number (1 = the
 * first row under the headers). Names (members, budgets, categories, accounts) are checked by the
 * database, all rows at once.
 */
export function parseImport(text: string): ParsedImport {
  const [header, ...body] = parseCsv(text);
  if (!header) return { ok: false, errors: ["The file is empty."] };
  const at = new Map(header.map((h, i) => [key(h), i]));
  const missing = IMPORT_COLUMNS.filter((c) => !at.has(c));
  if (missing.length) return { ok: false, errors: [`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`] };
  if (!body.length) return { ok: false, errors: ["There are no rows under the headers."] };
  if (body.length > 1000) return { ok: false, errors: ["Import at most 1,000 rows at a time."] };

  const errors: string[] = [];
  const rows: ImportRow[] = [];
  body.forEach((cells, i) => {
    const get = (c: (typeof IMPORT_COLUMNS)[number]) => (cells[at.get(c)!] ?? "").trim();
    const n = i + 1;
    const amount = parseAmountToCents(get("amount"));
    const paid = parseDate(get("paid date"));
    const purchase = get("purchase date") ? parseDate(get("purchase date")) : null;
    const problems = [
      !get("member email").includes("@") && "member email",
      !get("budget") && "budget",
      !get("category") && "category",
      get("description").length < 3 && "description",
      !amount && "amount",
      !paid && "paid date",
      get("purchase date") && !purchase && "purchase date",
      get("payment reference").length < 3 && "payment reference",
      !get("bank account") && "bank account",
    ].filter(Boolean);
    if (problems.length) {
      errors.push(`Row ${n}: check the ${problems.join(", ")}.`);
      return;
    }
    rows.push({
      email: get("member email").toLowerCase(),
      budget: get("budget"),
      category: get("category"),
      description: get("description"),
      amount_cents: amount!,
      expense_date: purchase,
      paid_on: paid!,
      reference: get("payment reference"),
      account: get("bank account"),
    });
  });
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}
