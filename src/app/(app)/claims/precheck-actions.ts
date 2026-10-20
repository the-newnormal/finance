"use server";

import { z } from "zod";
import { parseAmountToCents } from "@/lib/money";
import { receiptCheckEnabled } from "@/lib/receipt-check";
import { checkClaimFiles } from "@/lib/receipt-check-claim";
import { receiptFixes } from "@/lib/receipt-fixes";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/** `fixes`: what the claimant can fix first, in their words; none if the check found nothing to fix. */
export type PrecheckResult = { ok: true; fixes: string[] } | { ok: false };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal(""));

const precheckInput = z.object({
  kind: z.enum(["reimbursement", "invoice"]),
  budgetId: z.uuid(),
  categoryId: z.uuid(),
  description: z.string().trim().min(1).max(500),
  amount: z.string().max(30),
  expenseDate: date,
  vendorName: z.string().trim().max(120).optional(),
  attachmentPaths: z.array(z.string().max(300)).min(1).max(5),
});

export type PrecheckInput = z.input<typeof precheckInput>;

// The claimant's own AI receipt check, as they submit: Claude reads the files they have just uploaded
// against what they entered, and the form shows them what to fix first. Nothing is saved and nothing
// is decided: they may submit anyway, and reviewers check again. Only files in their own folder are
// read, as them; payout details are never sent. If the check can't run, it says nothing and the
// claim goes in as usual.
export async function precheckClaim(input: PrecheckInput): Promise<PrecheckResult> {
  const me = await requireMember();
  if (!receiptCheckEnabled()) return { ok: false };
  const parsed = precheckInput.safeParse(input);
  if (!parsed.success) return { ok: false };
  const v = parsed.data;
  const amount_cents = parseAmountToCents(v.amount);
  if (!amount_cents) return { ok: false };
  if (v.attachmentPaths.some((p) => !p.startsWith(`${me.id}/`) || p.includes(".."))) return { ok: false };

  const check = await checkClaimFiles(await createClient(), {
    kind: v.kind, amount_cents, expense_date: v.expenseDate || null, vendor_name: v.kind === "invoice" ? v.vendorName || null : null,
    description: v.description, budget_id: v.budgetId, category_id: v.categoryId, attachment_paths: v.attachmentPaths,
  });
  if (!check.ok) {
    console.error("receipt precheck failed", { step: check.step, code: check.code });
    return { ok: false };
  }
  return { ok: true, fixes: receiptFixes(check) };
}
