"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { assertPayoutKey, decryptPayout, encryptPayout, maskPayout, type PayoutDetails } from "@/lib/crypto";
import { parseAmountToCents } from "@/lib/money";
import { emailReviewers } from "@/lib/notify";
import { normaliseSgMobile, normaliseUen } from "@/lib/paynow";
import { requireMember } from "@/lib/session";
import { singaporeToday } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

// claims.amount_cents's limit in the database.
const MAX_CLAIM_CENTS = 100_000_000;

export type SubmitResult = { ok: true; id: string; payoutSaved: boolean } | { ok: false; error: string };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal(""));
const name = z.string().trim().min(2, "Enter the account holder's name").max(70);

const payout = z.discriminatedUnion("type", [
  z.object({ type: z.literal("saved") }),
  z.object({ type: z.literal("paynow_mobile"), name, proxy: z.string() }),
  z.object({ type: z.literal("paynow_uen"), name, proxy: z.string() }),
  z.object({ type: z.literal("bank"), name, bankName: z.string().trim().min(2, "Enter the bank").max(50), accountNumber: z.string() }),
]);

const claimInput = z.object({
  kind: z.enum(["reimbursement", "invoice"]),
  budgetId: z.uuid("Choose a budget"),
  categoryId: z.uuid("Choose a category"),
  description: z.string().trim().min(3, "Add a short description").max(500),
  amount: z.string(),
  expenseDate: date,
  vendorName: z.string().trim().max(120).optional(),
  dueDate: date,
  attachmentPaths: z.array(z.string().max(300)).min(1, "Attach at least one receipt or invoice").max(5),
  payout,
  savePayout: z.boolean().optional(),
  /** The claimant ticked the box agreeing to the form's declaration. */
  agreed: z.boolean(),
  /** Made once per claim by the form; a retry with the same id returns the claim already made. */
  submissionId: z.uuid(),
});

export type ClaimInput = z.input<typeof claimInput>;

function toDetails(p: Exclude<z.infer<typeof payout>, { type: "saved" }>): PayoutDetails | string {
  if (p.type === "paynow_mobile") {
    const proxy = normaliseSgMobile(p.proxy);
    return proxy ? { type: p.type, name: p.name, proxy } : "Enter a Singapore mobile number registered with PayNow.";
  }
  if (p.type === "paynow_uen") {
    const proxy = normaliseUen(p.proxy);
    return proxy ? { type: p.type, name: p.name, proxy } : "Enter a valid UEN.";
  }
  const accountNumber = p.accountNumber.replace(/[\s-]/g, "");
  return /^\d{6,17}$/.test(accountNumber)
    ? { type: p.type, name: p.name, bankName: p.bankName, accountNumber }
    : "Enter the bank account number (digits only).";
}

// Inserts the claim as the signed-in member. The database's trigger sets the status, division and
// name, and refuses what they may not claim; its messages are written for the claimant.
export async function submitClaim(input: ClaimInput): Promise<SubmitResult> {
  const me = await requireMember();
  const parsed = claimInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (!v.agreed) return { ok: false, error: "Tick the box to agree to the declaration." };

  const amount_cents = parseAmountToCents(v.amount);
  if (!amount_cents) return { ok: false, error: "Enter a valid amount, e.g. 42.50." };
  if (amount_cents > MAX_CLAIM_CENTS) return { ok: false, error: "A single claim can be at most $1,000,000." };
  if (v.kind === "invoice" && !v.vendorName) return { ok: false, error: "Enter the vendor's name." };
  if (v.kind === "reimbursement" && !v.expenseDate) return { ok: false, error: "Enter the date of purchase." };
  if (v.kind === "reimbursement" && v.expenseDate && v.expenseDate > singaporeToday()) {
    return { ok: false, error: "The purchase date can't be in the future." };
  }

  const supabase = await createClient();
  let payout_type, payout_masked, payout_enc;
  if (v.payout.type === "saved") {
    if (v.kind === "invoice") return { ok: false, error: "Enter the vendor's payment details." };
    const { data: saved } = await supabase
      .from("member_payouts")
      .select("payout_type, payout_masked, payout_enc")
      .eq("member_id", me.id)
      .maybeSingle();
    if (!saved) return { ok: false, error: "Enter your payout details." };
    // Copy them only if Finance will be able to read them (e.g. not saved under a retired key). A
    // missing or malformed server key is a configuration fault: let it throw, and keep their details.
    assertPayoutKey();
    try {
      decryptPayout(saved.payout_enc, me.id);
    } catch {
      console.error("saved payout unreadable", { code: "decrypt" });
      await supabase.from("member_payouts").delete().eq("member_id", me.id);
      return { ok: false, error: "Your saved payout details can no longer be used. Please enter them again." };
    }
    ({ payout_type, payout_masked, payout_enc } = saved);
  } else {
    const details = toDetails(v.payout);
    if (typeof details === "string") return { ok: false, error: details };
    payout_type = details.type;
    payout_masked = maskPayout(details);
    payout_enc = encryptPayout(details, me.id);
  }

  const { data, error } = await supabase
    .from("claims")
    .insert({
      kind: v.kind,
      budget_id: v.budgetId,
      category_id: v.categoryId,
      description: v.description,
      amount_cents,
      expense_date: v.kind === "reimbursement" ? v.expenseDate || null : null,
      vendor_name: v.kind === "invoice" ? v.vendorName : null,
      due_date: v.kind === "invoice" ? v.dueDate || null : null,
      attachment_paths: v.attachmentPaths,
      payout_type,
      payout_masked,
      payout_enc,
      submission_id: v.submissionId,
    })
    .select("id, status")
    .single();
  let claimId = data?.id as string | undefined;
  if (error?.code === "23505") {
    // Already submitted (a retry after a lost response): use that claim, don't make another; the
    // payout save below runs again, so payoutSaved reflects this attempt.
    const { data: existing } = await supabase
      .from("claims").select("id").eq("claimant_id", me.id).eq("submission_id", v.submissionId).maybeSingle();
    claimId = existing?.id as string | undefined;
  }
  if (error && !claimId) {
    // P0001 and 42501 come from our own trigger, in words meant for the claimant.
    if (error.code === "P0001" || error.code === "42501") return { ok: false, error: error.message };
    console.error("claim insert failed", { code: error.code });
    return { ok: false, error: "The claim couldn't be submitted. Try again." };
  }

  // The claim is in; remembering the details is a convenience, so a failure is reported, not fatal.
  let payoutSaved = true;
  if (v.savePayout && v.payout.type !== "saved" && v.kind === "reimbursement") {
    const { error: saveError } = await supabase
      .from("member_payouts")
      .upsert({ member_id: me.id, payout_type, payout_masked, payout_enc, updated_at: new Date().toISOString() });
    if (saveError) {
      console.error("member_payouts upsert failed", { code: saveError.code });
      payoutSaved = false;
    }
  }

  // Tell whoever reviews it that it's waiting, after the response. Only for a claim this attempt
  // made: on a retry, the first attempt already did.
  if (!error) after(() => emailReviewers(claimId!, data.status));

  revalidatePath("/claims");
  return { ok: true, id: claimId!, payoutSaved };
}

export async function forgetSavedPayout(): Promise<{ ok: boolean }> {
  const me = await requireMember();
  const supabase = await createClient();
  const { error } = await supabase.from("member_payouts").delete().eq("member_id", me.id);
  if (error) {
    console.error("member_payouts delete failed", { code: error.code });
    return { ok: false };
  }
  revalidatePath("/claims/new");
  return { ok: true };
}
