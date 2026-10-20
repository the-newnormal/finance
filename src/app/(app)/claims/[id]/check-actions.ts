"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fetchAll } from "@/lib/fetch-all";
import {
  describeClaim, mediaTypeOf, prepareFiles, ReceiptCheckError, receiptCheckEnabled, runReceiptCheck, savedCheck,
  type CheckResult, type ReceiptFile, type Skipped,
} from "@/lib/receipt-check";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Claim, ClaimRule } from "@/lib/types";

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
  if (claim.status === "pending_finance" && me.role !== "finance") {
    return { ok: false, error: "Only Finance checks a claim awaiting final approval." };
  }

  // The check needs the claim's budget, category and rules: if any can't be read, it isn't run (a
  // check without the rules would look complete when it isn't).
  let budget, category, rules;
  try {
    [budget, category, rules] = await Promise.all([
      supabase.from("budgets").select("name").eq("id", claim.budget_id).maybeSingle(),
      supabase.from("categories").select("name").eq("id", claim.category_id).maybeSingle(),
      fetchAll<Pick<ClaimRule, "title" | "body" | "applies_to">>((from, to) =>
        supabase.from("claim_rules").select("title, body, applies_to").eq("active", true)
          .order("sort_order").order("created_at").order("id").range(from, to)),
    ]);
  } catch {
    return failed("rules_read");
  }
  if (budget.error || category.error) return failed("claim_details_read", (budget.error ?? category.error)?.code);

  // A file that can't be downloaded is listed with the ones that can't be read; the rest are checked.
  const downloads = await Promise.all(claim.attachment_paths.map(async (path): Promise<ReceiptFile | Skipped> => {
    const name = path.split("/").pop()?.replace(/^[0-9a-f]+-/i, "") ?? "file";
    const { data, error } = await supabase.storage.from("receipts").download(path);
    if (error || !data) return { name, reason: "it couldn't be downloaded" };
    return { name, mediaType: mediaTypeOf(name, data.type), data: new Uint8Array(await data.arrayBuffer()) };
  }));
  const notDownloaded = downloads.filter((f): f is Skipped => "reason" in f);
  if (notDownloaded.length) console.error("receipt check files not downloaded", { count: notDownloaded.length });
  const prepared = prepareFiles(downloads.filter((f): f is ReceiptFile => "data" in f));
  const skipped = [...notDownloaded, ...prepared.skipped];

  let result: CheckResult | null = null;
  let model = "none";
  if (prepared.blocks.length) {
    const text = describeClaim(
      {
        kind: claim.kind, amount_cents: Number(claim.amount_cents), expense_date: claim.expense_date, vendor_name: claim.vendor_name,
        description: claim.description,
        budgetName: (budget.data?.name as string | undefined) ?? "—",
        categoryName: (category.data?.name as string | undefined) ?? "—",
      },
      rules,
      skipped,
    );
    try {
      ({ result, model } = await runReceiptCheck(prepared.blocks, text));
    } catch (e) {
      const code = e instanceof ReceiptCheckError ? e.code : "unknown";
      console.error("receipt check failed", { code });
      return {
        ok: false,
        error: code === "refusal" ? "The AI declined to check these receipts. Check them yourself." : "The receipts couldn't be checked just now. Try again.",
      };
    }
  }

  const { verdict, summary, findings } = savedCheck(result, skipped);
  const { error: saveError } = await supabase.rpc("record_receipt_check", {
    p_claim: claim.id, p_verdict: verdict, p_summary: summary, p_findings: findings,
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
