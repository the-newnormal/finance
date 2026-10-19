import { ClaimsTable } from "@/components/claims-table";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchAll, ROW_COLUMNS, withNames } from "@/lib/claims";
import { requireReviewer } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { isFinance } from "@/lib/types";

export const metadata = { title: "Review" };

export default async function ReviewPage() {
  const me = await requireReviewer();
  const finance = isFinance(me);
  const supabase = await createClient();

  // RLS limits both lists to claims this person has purview over. Their own claims are left out of
  // division review (nobody reviews their own); Finance may finalise its own, so those stay.
  const pending = (status: string) =>
    fetchAll((from, to) =>
      supabase.from("claims").select(`${ROW_COLUMNS}, claimant_id`).eq("status", status).order("created_at").order("id").range(from, to),
    );
  const [review, final] = await Promise.all([pending("pending_review"), finance ? pending("pending_finance") : []]);
  const reviewQueue = await withNames(review.filter((c) => c.claimant_id !== me.id));
  const financeQueue = await withNames(final);

  return (
    <>
      <PageHeader title="Review" description="Claims waiting on you, oldest first." />
      <div className="grid gap-6">
        {finance && (
          <Card>
            <CardHeader>
              <CardTitle>Final approval · Finance</CardTitle>
              <CardDescription>Reviewed volunteer claims, and claims from division leads and Finance.</CardDescription>
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
