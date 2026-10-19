import { PageHeader } from "@/components/page-header";
import { singaporeToday } from "@/lib/dates";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { canInvoice, type Budget, type Category, type PayoutType } from "@/lib/types";
import { ClaimForm } from "./claim-form";

export const metadata = { title: "New claim" };

export default async function NewClaimPage() {
  const me = await requireMember();
  const supabase = await createClient();
  // Every active member reads budgets, which categories each provisions, and the categories (RLS).
  const [budgets, provisions, categories, saved] = await Promise.all([
    supabase.from("budgets").select("id, name, kind").eq("active", true).order("name"),
    supabase.from("budget_categories").select("budget_id, category_id"),
    supabase.from("categories").select("id, name").eq("active", true).order("name"),
    supabase.from("member_payouts").select("payout_type, payout_masked").eq("member_id", me.id).maybeSingle(),
  ]);
  // A failed read shows the error page, not a form with empty choices.
  for (const r of [budgets, provisions, categories, saved]) if (r.error) throw new Error(`new claim read failed: ${r.error.code}`);

  return (
    <>
      <PageHeader title="New claim" description="Keep your receipt handy: a photo or PDF works." />
      <ClaimForm
        uid={me.id}
        today={singaporeToday()}
        canInvoice={canInvoice(me)}
        goesStraightToFinance={me.role !== "volunteer"}
        budgets={(budgets.data ?? []) as Pick<Budget, "id" | "name" | "kind">[]}
        provisions={(provisions.data ?? []) as { budget_id: string; category_id: string }[]}
        categories={(categories.data ?? []) as Pick<Category, "id" | "name">[]}
        savedPayout={saved.data ? { type: saved.data.payout_type as PayoutType, masked: saved.data.payout_masked as string } : null}
      />
    </>
  );
}
