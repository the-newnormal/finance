import { PageHeader } from "@/components/page-header";
import { singaporeToday } from "@/lib/dates";
import { fetchAll } from "@/lib/fetch-all";
import { receiptCheckEnabled } from "@/lib/receipt-check";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { canInvoice, type Budget, type Category, type ClaimRule, type PayoutType } from "@/lib/types";
import { ClaimForm } from "./claim-form";

export const metadata = { title: "New claim" };

type ClaimRuleView = Pick<ClaimRule, "id" | "title" | "body" | "applies_to" | "link_label" | "link_url">;

export default async function NewClaimPage() {
  const me = await requireMember();
  const supabase = await createClient();
  // Every active member reads budgets, which categories each provisions, and the categories (RLS).
  // Every row (fetchAll pages past the API's cap), so no budget shows an empty category list; only
  // open budgets' provisions are kept. A failed read shows the error page, not a form with empty choices.
  const [openBudgets, allProvisions, categoryRows, saved, rules] = await Promise.all([
    fetchAll<Pick<Budget, "id" | "name" | "kind" | "is_reserve">>((from, to) =>
      supabase.from("budgets").select("id, name, kind, is_reserve").eq("active", true).order("id").range(from, to)),
    fetchAll<{ budget_id: string; category_id: string }>((from, to) =>
      supabase.from("budget_categories").select("budget_id, category_id").order("budget_id").order("category_id").range(from, to)),
    fetchAll<Pick<Category, "id" | "name">>((from, to) =>
      supabase.from("categories").select("id, name").eq("active", true).order("id").range(from, to)),
    supabase.from("member_payouts").select("payout_type, payout_masked").eq("member_id", me.id).maybeSingle(),
    // The rules Finance shows (RLS: shown ones only, except to Finance, so filter here too). They're
    // guidance: if they can't be read, the form still works without them.
    fetchAll<ClaimRuleView>((from, to) =>
      supabase.from("claim_rules").select("id, title, body, applies_to, link_label, link_url")
        .eq("active", true).order("sort_order").order("created_at").order("id").range(from, to))
      .catch((e: unknown) => {
        console.error("claim rules read failed", { error: e instanceof Error ? e.message : "unknown" });
        return [];
      }),
  ]);
  if (saved.error) throw new Error(`new claim read failed: ${saved.error.code}`);
  openBudgets.sort((a, b) => a.name.localeCompare(b.name));
  categoryRows.sort((a, b) => a.name.localeCompare(b.name));
  const open = new Set(openBudgets.map((b) => b.id));
  const provisionRows = allProvisions.filter((p) => open.has(p.budget_id));

  return (
    <>
      <PageHeader title="New claim" description="Keep your receipt handy: a photo or PDF works." />
      <ClaimForm
        uid={me.id}
        today={singaporeToday()}
        canInvoice={canInvoice(me)}
        goesStraightToFinance={me.role !== "volunteer"}
        budgets={openBudgets}
        provisions={provisionRows}
        categories={categoryRows}
        savedPayout={saved.data ? { type: saved.data.payout_type as PayoutType, masked: saved.data.payout_masked as string } : null}
        rules={rules}
        aiCheck={receiptCheckEnabled()}
      />
    </>
  );
}
