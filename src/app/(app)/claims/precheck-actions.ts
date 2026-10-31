"use server";

import { z } from "zod";
import { isOwnReceiptPath } from "@/lib/receipt-upload";
import type { ClaimItem, ReadDocument } from "@/lib/claim-items";
import { receiptCheckEnabled } from "@/lib/receipt-check";
import { readClaimFiles } from "@/lib/receipt-check-claim";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/**
 * `fixes`: what the claimant can fix that doesn't depend on what they enter; `documents`: what the
 * form compares with the amount and date they enter, as the claim is sent; `items`: what was
 * bought, sent with the claim (0012).
 */
export type PrecheckResult = { ok: true; fixes: string[]; documents: ReadDocument[]; items: ClaimItem[] } | { ok: false };

const precheckInput = z.object({
  kind: z.enum(["reimbursement", "invoice"]),
  attachmentPaths: z.array(z.string().max(300)).min(1).max(5),
});

export type PrecheckInput = z.input<typeof precheckInput>;

// The claimant's own AI receipt check, as they attach files: Claude reads the files they have just
// uploaded and lists what was bought, and the form shows them what to fix when they send the claim.
// Nothing is saved and nothing is decided: they may send it anyway, and reviewers check again. Only
// files in their own folder are read, as them; payout details are never sent. If the read can't run,
// it says nothing and the claim goes in as usual, without items.
export async function precheckClaim(input: PrecheckInput): Promise<PrecheckResult> {
  const me = await requireMember();
  if (!receiptCheckEnabled()) return { ok: false };
  const parsed = precheckInput.safeParse(input);
  if (!parsed.success) return { ok: false };
  const v = parsed.data;
  if (!v.attachmentPaths.every((p) => isOwnReceiptPath(p, me.id))) return { ok: false };

  const read = await readClaimFiles(await createClient(), { kind: v.kind, attachment_paths: v.attachmentPaths });
  if (!read.ok) {
    console.error("receipt precheck failed", { step: read.step, code: read.code });
    return { ok: false };
  }
  return { ok: true, fixes: read.fixes, documents: read.documents, items: read.items };
}
