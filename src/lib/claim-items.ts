// What a claim bought, line by line (0012), and what the claim form checks as the claim is sent.
// Pure: the claim form, the claim page and the export all use it.

/** An item as stored in claims.items: its amount as printed (cents, negative for a discount), and its category. */
export type ClaimItem = { description: string; amount_cents: number | null; category_id: string | null };

/** What the AI read of a document: the kind, the total (cents) and the date it shows. */
export type ReadDocument = { kind: "receipt" | "invoice" | "payment_proof" | "other" | "unreadable"; total_cents: number | null; date: string | null };

const TOLERANCE_CENTS = 50;

/**
 * What to fix that depends on what was entered, worked out as the claim is sent from what the AI
 * read when the files were attached: a total that doesn't match the amount claimed (within $0.50),
 * and a date that doesn't match the date given. Receipts and invoices count; payment proofs don't
 * (they show the same amount again). Nothing when the documents show no total or date to compare.
 */
export function comparedFixes(documents: ReadDocument[], entered: { amountCents: number | null; expenseDate: string | null }): string[] {
  const bills = documents.filter((d) => d.kind === "receipt" || d.kind === "invoice");
  const totals = bills.map((d) => d.total_cents).filter((t): t is number => t !== null);
  const dates = bills.map((d) => d.date).filter((d): d is string => !!d);
  const fixes: string[] = [];
  if (entered.amountCents !== null && totals.length) {
    const sum = totals.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - entered.amountCents) > TOLERANCE_CENTS) fixes.push("The total on the documents doesn't match the amount claimed.");
  }
  if (entered.expenseDate && dates.length && !dates.includes(entered.expenseDate)) {
    fixes.push("The date on the documents doesn't match the date on the claim.");
  }
  return fixes;
}

/**
 * The claim's amount shared across its items in proportion to their amounts, so taxes and service
 * charges (left out of the list) are shared the same way and the shares add up to the claim exactly.
 * An item with no amount gets nothing. Null when the items can't share it (none priced, or priced at
 * no more than nothing): the claim then counts whole under its own category.
 */
export function shareAmount(amountCents: number, items: ClaimItem[]): number[] | null {
  const amounts = items.map((i) => i.amount_cents ?? 0);
  const total = amounts.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const exact = amounts.map((a) => (amountCents * a) / total);
  const shares = exact.map(Math.floor);
  // Largest remainders first, so the cents left over by rounding down go where they're most owed.
  let left = amountCents - shares.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares;
}
