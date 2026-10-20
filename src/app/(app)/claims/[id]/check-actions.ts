"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { receiptCheckEnabled } from "@/lib/receipt-check";
import { checkClaimFiles } from "@/lib/receipt-check-claim";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Claim } from "@/lib/types";

export type CheckActionResult = { ok: true } | { ok: false; error: string };

const uuid = z.uuid();

// Reads a claim's receipts with Claude, as the reviewer, and saves the advice as theirs
// (record_receipt_check: only a reviewer who could decide the claim now, never its claimant). Everything
// is read as the signed-in reviewer, so RLS decides which claims and files they can check.
export async function checkReceipts(id: string): Promise<CheckActionResult> {
  const me = await requireMember();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Claim not found." };
  if (!receiptCheckEnabled()) return { ok: false, error: "The AI receipt check isn't set up on this server." };
  const supabase = await createClient();

  const { data: claim, error } = await supabase
    .from("claims")
    .select("id, kind, status, claimant_id, budget_id, category_id, description, amount_cents, expense_date, vendor_name, attachment_paths, ai_check_notice")
    .eq("id", id)
    .maybeSingle<Pick<Claim, "id" | "kind" | "status" | "claimant_id" | "budget_id" | "category_id" | "description" | "amount_cents" | "expense_date" | "vendor_name" | "attachment_paths"> & { ai_check_notice: boolean }>();
  if (error) return failed("claim_read", error.code);
  if (!claim) return { ok: false, error: "Claim not found." };
  // The database checks these again; checking first saves paying for a check it would refuse.
  if (claim.claimant_id === me.id && me.role !== "finance") return { ok: false, error: "You can't check your own claim." };
  if (claim.status !== "pending_review" && claim.status !== "pending_finance") {
    return { ok: false, error: "Only claims awaiting a decision are checked." };
  }
  if (claim.status === "pending_finance" && me.role !== "finance") {
    return { ok: false, error: "Only Finance checks a claim awaiting final approval." };
  }
  // Its claimant wasn't told the files may be read by an AI service, so they aren't sent.
  if (!claim.ai_check_notice) {
    return { ok: false, error: "This claim was made before claimants were told about the AI check, so it isn't checked." };
  }

  const check = await checkClaimFiles(supabase, { ...claim, amount_cents: Number(claim.amount_cents) });
  if (!check.ok) {
    if (check.step !== "check") return failed(check.step, check.code);
    console.error("receipt check failed", { code: check.code });
    return {
      ok: false,
      error: check.code === "refusal" ? "The AI declined to check these receipts. Check them yourself." : "The receipts couldn't be checked just now. Try again.",
    };
  }

  const { verdict, summary, findings, filesChecked, model } = check;
  const { error: saveError } = await supabase.rpc("record_receipt_check", {
    p_claim: claim.id, p_verdict: verdict, p_summary: summary, p_findings: findings,
    p_files_checked: filesChecked, p_model: model,
  });
  if (saveError) {
    if (["P0001", "P0002", "42501"].includes(saveError.code ?? "")) return { ok: false, error: saveError.message };
    return failed("record", saveError.code);
  }
  revalidatePath(`/claims/${id}`);
  return { ok: true };
}

function failed(step: string, code?: string): CheckActionResult {
  console.error("receipt check failed", { step, code });
  return { ok: false, error: "The receipts couldn't be checked just now. Try again." };
}
