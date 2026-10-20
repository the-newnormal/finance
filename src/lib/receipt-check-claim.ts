import "server-only";
import { fetchAll } from "@/lib/fetch-all";
import {
  describeClaim, mediaTypeOf, prepareFiles, ReceiptCheckError, runReceiptCheck, savedCheck,
  type CheckResult, type ReceiptFile, type Skipped, type StoredFindings,
} from "@/lib/receipt-check";
import type { createClient } from "@/lib/supabase/server";
import type { Claim, ClaimRule, ReceiptVerdict } from "@/lib/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ClaimToCheck = Pick<Claim, "kind" | "amount_cents" | "expense_date" | "vendor_name" | "description" | "budget_id" | "category_id" | "attachment_paths">;

export type ClaimCheck =
  | { ok: true; verdict: ReceiptVerdict; summary: string; findings: StoredFindings; filesChecked: number; model: string }
  | { ok: false; step: string; code?: string };

/**
 * Checks a claim's files (a claim already made, or one about to be): reads its budget, category and
 * the claim rules, downloads the files and has Claude read them, all as the signed-in member, so RLS
 * decides what they can read. Saves nothing. Not run (`ok: false`) when anything it needs can't be
 * read, as a check without the rules would look complete when it isn't; a file that can't be
 * downloaded is listed with the ones that can't be read, and the rest are checked.
 */
export async function checkClaimFiles(supabase: Supabase, claim: ClaimToCheck): Promise<ClaimCheck> {
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
    return { ok: false, step: "rules_read" };
  }
  if (budget.error || category.error) return { ok: false, step: "claim_details_read", code: (budget.error ?? category.error)?.code };

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
      return { ok: false, step: "check", code: e instanceof ReceiptCheckError ? e.code : "unknown" };
    }
  }
  return { ok: true, ...savedCheck(result, skipped), filesChecked: prepared.checked.length, model };
}
