/** "12.30" or "$1,200" -> cents. null unless it's a positive amount with at most 2 decimals. */
export function parseAmountToCents(input: string): number | null {
  const raw = input.trim().replace(/^\$\s*/, "");
  // Commas only as thousands separators ("1,200"), never "1,2", which is ambiguous.
  if (raw.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(raw)) return null;
  const s = raw.replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return cents > 0 ? cents : null;
}

/** Like parseAmountToCents, but a budget may be zero ("0", "0.00"). */
export function parseBudgetToCents(input: string): number | null {
  if (/^\$?\s*0+(\.0{1,2})?$/.test(input.trim())) return 0;
  return parseAmountToCents(input);
}

export function formatSGD(cents: number) {
  return new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" }).format(cents / 100);
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" })
    .format(new Date(iso));
}
