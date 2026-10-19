import { PageHeader } from "@/components/page-header";
import { singaporeToday } from "@/lib/dates";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { canReview, type Category, type PayoutType, type Pool } from "@/lib/types";
import { ClaimForm } from "./claim-form";

export const metadata = { title: "New claim" };

export default async function NewClaimPage() {
  const me = await requireMember();
  const supabase = await createClient();
  const [pools, categories, saved] = await Promise.all([
    supabase.from("pools").select("id, name, kind").eq("active", true).order("name"),
    supabase.from("categories").select("id, name").eq("active", true).order("name"),
    supabase.from("member_payouts").select("payout_type, payout_masked").eq("member_id", me.id).maybeSingle(),
  ]);
  // A failed read shows the error page, not a form with empty choices.
  for (const r of [pools, categories, saved]) if (r.error) throw new Error(`new claim read failed: ${r.error.code}`);

  return (
    <>
      <PageHeader title="New claim" description="Keep your receipt handy: a photo or PDF works." />
      <ClaimForm
        uid={me.id}
        today={singaporeToday()}
        canInvoice={canReview(me)}
        goesStraightToFinance={me.role !== "volunteer" || me.finance}
        pools={(pools.data ?? []) as Pick<Pool, "id" | "name" | "kind">[]}
        categories={(categories.data ?? []) as Pick<Category, "id" | "name">[]}
        savedPayout={saved.data ? { type: saved.data.payout_type as PayoutType, masked: saved.data.payout_masked as string } : null}
      />
    </>
  );
}
