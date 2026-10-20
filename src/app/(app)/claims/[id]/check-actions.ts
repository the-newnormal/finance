"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { describeClaim, mediaTypeOf, prepareFiles, ReceiptCheckError, receiptCheckEnabled, runReceiptCheck, type ReceiptFile } from "@/lib/receipt-check";
import { requireMember } from "@/lib/session";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Claim, ClaimRule } from "@/lib/types";

export type CheckActionResult = { ok: true } | { ok: false; error: string };

const uuid = z.uuid();

// Reads a claim's receipts with Claude, as the reviewer, and saves the advice (record_receipt_check:
// reviewers only, never the claimant, and only while the claim awaits a decision). Everything is
// read as the signed-in reviewer, so RLS decides which claims and files they can check.
export async function checkReceipts(id: string): Promise<CheckActionResult> {
  const me = await requireMember();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Claim not found." };
  if (!receiptCheckEnabled()) return { ok: false, error: "The AI receipt check isn't set up on this server." };
  const supabase = await createClient();

  const { data: claim, error } = await supabase
    .from("claims")
    .select("id, kind, status, claimant_id, budget_id, category_id, description, amount_cents, expense_date, vendor_name, attachment_paths")
    .eq("id", id)
    .maybeSingle<Pick<Claim, "id" | "kind" | "status" | "claimant_id" | "budget_id" | "category_id" | "description" | "amount_cents" | "expense_date" | "vendor_name" | "attachment_paths">>();
  if (error) return failed("claim_read", error.code);
  if (!claim) return { ok: false, error: "Claim not found." };
  // The database checks these again; checking first saves paying for a check it would refuse.
  if (claim.claimant_id === me.id && me.role !== "finance") return { ok: false, error: "You can't check your own claim." };
  if (claim.status !== "pending_review" && claim.status !== "pending_finance") {
    return { ok: false, error: "Only claims awaiting a decision are checked." };
  }

  const [budget, category, rules, files] = await Promise.all([
    supabase.from("budgets").select("name").eq("id", claim.budget_id).maybeSingle(),
    supabase.from("categories").select("name").eq("id", claim.category_id).maybeSingle(),
    supabase.from("claim_rules").select("title, body, applies_to").eq("active", true).order("sort_order").limit(100),
    Promise.all(claim.attachment_paths.map(async (path): Promise<ReceiptFile | { path: string; failed: true }> => {
      const { data, error } = await supabase.storage.from("receipts").download(path);
      if (error || !data) return { path, failed: true };
      const name = path.split("/").pop()?.replace(/^[0-9a-f]+-/i, "") ?? "file";
      return { name, mediaType: mediaTypeOf(name, data.type), data: new Uint8Array(await data.arrayBuffer()) };
    })),
  ]);
  if (files.some((f) => "failed" in f)) return failed("file_read", "storage");
  if (rules.error) console.error("receipt check rules read failed", { code: rules.error.code }); // the check runs without them

  const prepared = prepareFiles(files as ReceiptFile[]);
  let verdict: "looks_right" | "check_needed" | "unreadable" = "unreadable";
  let summary = "None of the attached files could be read.";
  let findings: Record<string, unknown> = { documents: [], skipped: prepared.skipped };
  let model = "none";
  if (prepared.blocks.length) {
    const text = describeClaim(
      {
        kind: claim.kind, amount_cents: Number(claim.amount_cents), expense_date: claim.expense_date, vendor_name: claim.vendor_name,
        description: claim.description,
        budgetName: (budget.data?.name as string | undefined) ?? "—",
        categoryName: (category.data?.name as string | undefined) ?? "—",
      },
      (rules.data ?? []) as Pick<ClaimRule, "title" | "body" | "applies_to">[],
      prepared.skipped,
    );
    try {
      const run = await runReceiptCheck(prepared.blocks, text);
      const { verdict: v, summary: s, ...rest } = run.result;
      [verdict, summary, findings, model] = [v, s, { ...rest, skipped: prepared.skipped }, run.model];
    } catch (e) {
      const code = e instanceof ReceiptCheckError ? e.code : "unknown";
      console.error("receipt check failed", { code });
      return {
        ok: false,
        error: code === "refusal" ? "The AI declined to check these receipts. Check them yourself." : "The receipts couldn't be checked just now. Try again.",
      };
    }
  }

  // The result-writing RPC is service-role only. This prevents a reviewer from forging advice by
  // calling it directly; the checks above and in the RPC still bind the result to this reviewer.
  const { error: saveError } = await createServiceRoleClient().rpc("record_receipt_check", {
    p_claim: claim.id, p_checked_by: me.id, p_verdict: verdict, p_summary: summary, p_findings: findings,
    p_files_checked: prepared.checked.length, p_model: model,
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
