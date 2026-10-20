import type { ReceiptCheck } from "@/lib/types";

// What an AI receipt check found that the claimant can fix, in words for them: mandatory fields
// the documents don't show or show unclearly, a total or date that doesn't match the claim, what
// the claim rules require that is missing, and files that couldn't be read. Never the check's
// "worth a look" concerns: those are for the reviewer, who decides whether to raise them.

const DOCUMENT: Record<string, string> = { receipt: "receipt", paid_invoice: "invoice", vendor_invoice: "invoice" };

const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/** The fixes, one sentence each; none when the check found nothing the claimant can fix. */
export function receiptFixes(check: Pick<ReceiptCheck, "verdict" | "findings">): string[] {
  if (check.verdict === "looks_right") return [];
  const f = check.findings;
  const doc = DOCUMENT[f.document_kind ?? ""];
  const fields = (shown: "no" | "unclear") => (f.fields ?? []).filter((x) => x.shown === shown).map((x) => x.field);
  const missing = fields("no");
  const unclear = fields("unclear");
  const fixes: string[] = [];
  if (missing.length) fixes.push(`${doc ? `The ${doc} doesn't` : "The documents don't"} show: ${missing.join(", ")}.`);
  if (unclear.length) fixes.push(`These can't be read clearly: ${unclear.join(", ")}.`);
  if (f.amount_matches === "no") fixes.push("The total on the documents doesn't match the amount claimed.");
  if (f.date_matches === "no") fixes.push("The date on the documents doesn't match the date on the claim.");
  for (const m of f.missing ?? []) if (m.trim()) fixes.push(sentence(m));
  for (const s of f.skipped ?? []) fixes.push(sentence(`Couldn't read ${s.name}: ${s.reason}`));
  if (check.verdict === "unreadable" && !f.skipped?.length) fixes.push("The attached files couldn't be read. Please attach a clearer copy.");
  return fixes;
}

/**
 * A rejection reason made of the fixes, for the reviewer to check and edit before sending: as many
 * whole sentences as fit decide_claim's 500 characters. Null when there's nothing to fix.
 */
export function rejectionReason(check: Pick<ReceiptCheck, "verdict" | "findings">, max = 500): string | null {
  let reason = "";
  for (const fix of receiptFixes(check)) {
    const next = reason ? `${reason} ${fix}` : fix;
    if (next.length > max) {
      if (!reason) reason = `${fix.slice(0, max - 1)}…`;
      break;
    }
    reason = next;
  }
  return reason || null;
}
