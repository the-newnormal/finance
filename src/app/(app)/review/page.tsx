import { ClaimsTable } from "@/components/claims-table";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROW_COLUMNS, withNames } from "@/lib/claims";
import { requireReviewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { isFinance } from "@/lib/types";

export const metadata = { title: "Review" };

export default async function ReviewPage() {
  const me = await requireReviewer();
  const finance = isFinance(me);
  const supabase = await createClient();

  // RLS limits both lists to claims this person has purview over. Their own claims are left out
  // (nobody reviews their own; Finance members may finalise theirs, so those stay for them).
  const pending = (status: string) =>
    supabase.from("claims").select(`${ROW_COLUMNS}, claimant_id`).eq("status", status).order("created_at").limit(200);
  const [review, final] = await Promise.all([pending("pending_review"), finance ? pending("pending_finance") : null]);
  const reviewQueue = await withNames((review.data ?? []).filter((c) => c.claimant_id !== me.id));
  const financeQueue = await withNames((final?.data ?? []).filter((c) => c.claimant_id !== me.id || me.finance));

  return (
    <>
      <PageHeader title="Review" description="Claims waiting on you, oldest first." />
      <div className="grid gap-6">
        {finance && (
          <Card>
            <CardHeader>
              <CardTitle>Final approval · Finance</CardTitle>
              <CardDescription>Reviewed volunteer claims, and claims from core personnel.</CardDescription>
            </CardHeader>
            <CardContent><ClaimsTable claims={financeQueue} showClaimant empty="Nothing waiting for Finance." /></CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Division review</CardTitle>
            <CardDescription>
              {finance ? "Volunteer claims not yet reviewed by their division. You can step in if needed." : "Volunteer claims for your division's events and budgets. One approval sends a claim to Finance."}
            </CardDescription>
          </CardHeader>
          <CardContent><ClaimsTable claims={reviewQueue} showClaimant empty="You're all caught up." /></CardContent>
        </Card>
      </div>
    </>
  );
}
