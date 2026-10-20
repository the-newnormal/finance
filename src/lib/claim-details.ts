import { singaporeToday } from "@/lib/dates";
import { parseAmountToCents } from "@/lib/money";
import type { ClaimKind } from "@/lib/types";

// claims.amount_cents's limit in the database.
export const MAX_CLAIM_CENTS = 100_000_000;

/**
 * The claim details submitClaim refuses before the database sees them: the amount in cents, or why
 * the claim can't be sent. The claim form's AI check uses it too, so it never checks a claim that
 * can't be submitted.
 */
export function checkClaimDetails(v: { kind: ClaimKind; amount: string; expenseDate?: string; vendorName?: string }):
  { ok: true; amount_cents: number } | { ok: false; error: string } {
  const amount_cents = parseAmountToCents(v.amount);
  if (!amount_cents) return { ok: false, error: "Enter a valid amount, e.g. 42.50." };
  if (amount_cents > MAX_CLAIM_CENTS) return { ok: false, error: "A single claim can be at most $1,000,000." };
  if (v.kind === "invoice" && !v.vendorName) return { ok: false, error: "Enter the vendor's name." };
  if (v.kind === "reimbursement" && !v.expenseDate) return { ok: false, error: "Enter the date of purchase." };
  if (v.kind === "reimbursement" && v.expenseDate && v.expenseDate > singaporeToday()) {
    return { ok: false, error: "The purchase date can't be in the future." };
  }
  return { ok: true, amount_cents };
}
