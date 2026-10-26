import "server-only";
import { fetchAll } from "@/lib/fetch-all";
import type { ClaimItem, ReadDocument } from "@/lib/claim-items";
import {
  describeClaim, describeRead, mediaTypeOf, prepareFiles, ReceiptCheckError, runReceiptCheck, runReceiptRead, savedCheck,
  type CheckResult, type ReceiptFile, type Skipped, type StoredFindings,
} from "@/lib/receipt-check";
import { receiptFixes } from "@/lib/receipt-fixes";
import type { createClient } from "@/lib/supabase/server";
import { CATEGORY_GROUP_LABEL, type Category, type Claim, type ClaimKind, type ClaimRule, type ReceiptVerdict } from "@/lib/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ClaimToCheck = Pick<Claim, "kind" | "amount_cents" | "expense_date" | "vendor_name" | "description" | "budget_id" | "category_id" | "attachment_paths">;

export type ClaimCheck =
  | { ok: true; verdict: ReceiptVerdict; summary: string; findings: StoredFindings; filesChecked: number; model: string }
  | { ok: false; step: string; code?: string };

/**
 * Checks a claim's files for its reviewer: reads its budget, category and the claim rules, downloads
 * the files and has Claude read them against the claim, all as the signed-in member, so RLS decides
 * what they can read. Saves nothing. Not run (`ok: false`) when anything it needs can't be read, as a
 * check without the rules would look complete when it isn't; a file that can't be downloaded is
 * listed with the ones that can't be read, and the rest are checked.
 */
export async function checkClaimFiles(supabase: Supabase, claim: ClaimToCheck): Promise<ClaimCheck> {
  let budget, category, rules;
  try {
    [budget, category, rules] = await Promise.all([
      supabase.from("budgets").select("name, active").eq("id", claim.budget_id).maybeSingle(),
      supabase.from("categories").select("name, active").eq("id", claim.category_id).maybeSingle(),
      fetchAll<Pick<ClaimRule, "title" | "body" | "applies_to">>((from, to) =>
        supabase.from("claim_rules").select("title, body, applies_to").eq("active", true)
          .order("sort_order").order("created_at").order("id").range(from, to)),
    ]);
  } catch {
    return { ok: false, step: "rules_read" };
  }
  if (budget.error || category.error) return { ok: false, step: "claim_details_read", code: (budget.error ?? category.error)?.code };
  if (!budget.data || !category.data) return { ok: false, step: "claim_details_missing" };

  const { prepared, skipped } = await downloadFiles(supabase, claim.attachment_paths);

  let result: CheckResult | null = null;
  let model = "none";
  if (prepared.blocks.length) {
    const text = describeClaim(
      {
        kind: claim.kind, amount_cents: Number(claim.amount_cents), expense_date: claim.expense_date, vendor_name: claim.vendor_name,
        description: claim.description,
        budgetName: budget.data.name as string,
        categoryName: category.data.name as string,
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

// The files, as the signed-in member (storage RLS decides), ready for Claude; a file that can't be
// downloaded or read is listed with why.
async function downloadFiles(supabase: Supabase, paths: string[]) {
  const downloads = await Promise.all(paths.map(async (path): Promise<ReceiptFile | Skipped> => {
    const name = path.split("/").pop()?.replace(/^[0-9a-f]+-/i, "") ?? "file";
    const { data, error } = await supabase.storage.from("receipts").download(path);
    if (error || !data) return { name, reason: "it couldn't be downloaded" };
    return { name, mediaType: mediaTypeOf(name, data.type), data: new Uint8Array(await data.arrayBuffer()) };
  }));
  const notDownloaded = downloads.filter((f): f is Skipped => "reason" in f);
  if (notDownloaded.length) console.error("receipt check files not downloaded", { count: notDownloaded.length });
  const prepared = prepareFiles(downloads.filter((f): f is ReceiptFile => "data" in f));
  return { prepared, skipped: [...notDownloaded, ...prepared.skipped] };
}

export type ClaimRead =
  | { ok: true; fixes: string[]; documents: ReadDocument[]; items: ClaimItem[] }
  | { ok: false; step: string; code?: string };

const MAX_ITEMS = 100;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Reads a claimant's files as they attach them, before the claim is made: what to fix that doesn't
 * depend on what they enter (mandatory fields, the claim rules, files that can't be read), what each
 * document shows for the form to compare as the claim is sent (src/lib/claim-items.ts), and the items
 * bought, each with one of the open categories (by name; one that names none gets none). As the
 * signed-in member; saves nothing. Not run (`ok: false`) when the rules or categories can't be read.
 */
export async function readClaimFiles(supabase: Supabase, claim: { kind: ClaimKind; attachment_paths: string[] }): Promise<ClaimRead> {
  let rules, categories;
  try {
    [rules, categories] = await Promise.all([
      fetchAll<Pick<ClaimRule, "title" | "body" | "applies_to">>((from, to) =>
        supabase.from("claim_rules").select("title, body, applies_to").eq("active", true)
          .order("sort_order").order("created_at").order("id").range(from, to)),
      fetchAll<Pick<Category, "id" | "name" | "category_group">>((from, to) =>
        supabase.from("categories").select("id, name, category_group").eq("active", true).order("id").range(from, to)),
    ]);
  } catch {
    return { ok: false, step: "rules_read" };
  }
  const { prepared, skipped } = await downloadFiles(supabase, claim.attachment_paths);
  if (!prepared.blocks.length) {
    return { ok: true, fixes: receiptFixes({ verdict: "unreadable", findings: { documents: [], skipped } }), documents: [], items: [] };
  }
  const text = describeRead(claim.kind, rules,
    categories.map((c) => ({ name: c.name, groupLabel: c.category_group ? CATEGORY_GROUP_LABEL[c.category_group] : null })), skipped);
  let result;
  try {
    ({ result } = await runReceiptRead(prepared.blocks, text));
  } catch (e) {
    return { ok: false, step: "read", code: e instanceof ReceiptCheckError ? e.code : "unknown" };
  }
  const allUnreadable = result.documents.length > 0 && result.documents.every((d) => d.kind === "unreadable");
  const fixes = receiptFixes({
    verdict: allUnreadable ? "unreadable" : "check_needed",
    findings: { document_kind: result.document_kind, fields: result.fields, missing: result.missing, documents: result.documents, skipped },
  });
  const byName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const items: ClaimItem[] = result.items
    .map((i) => ({
      description: clip(i.description.trim(), 200),
      amount_cents: i.amount_cents !== null && Math.abs(i.amount_cents) <= 100_000_000 ? i.amount_cents : null,
      category_id: (i.category && byName.get(i.category.trim().toLowerCase())) || null,
    }))
    .filter((i) => i.description)
    .slice(0, MAX_ITEMS);
  return {
    ok: true,
    fixes,
    documents: result.documents.map((d) => ({ kind: d.kind, total_cents: d.total_cents, date: d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null })),
    items,
  };
}
