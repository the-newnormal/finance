import { Plus } from "lucide-react";
import Link from "next/link";
import { ClaimsTable } from "@/components/claims-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ROW_COLUMNS, withNames } from "@/lib/claims";
import { formatSGD } from "@/lib/money";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "My claims" };

export default async function MyClaimsPage() {
  const me = await requireMember();
  const supabase = await createClient();
  // Filter by claimant: RLS would also hand reviewers their division's claims.
  const { data } = await supabase
    .from("claims")
    .select(ROW_COLUMNS)
    .eq("claimant_id", me.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const claims = await withNames(data ?? []);

  const sum = (pred: (c: (typeof claims)[number]) => boolean) => {
    const cs = claims.filter(pred);
    return { total: formatSGD(cs.reduce((s, c) => s + c.amount_cents, 0)), count: cs.length };
  };
  const pending = sum((c) => c.status === "pending_review" || c.status === "pending_finance");
  const toBePaid = sum((c) => c.status === "approved" && c.kind === "reimbursement");
  const paid = sum((c) => c.status === "paid" && c.kind === "reimbursement");

  return (
    <>
      <PageHeader
        title={`Hi, ${me.name.split(" ")[0]}`}
        description="Submit claims for things you've paid for on New Normal's behalf and follow them until you're reimbursed."
        action={<Button asChild size="lg"><Link href="/claims/new"><Plus /> New claim</Link></Button>}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Being reviewed" value={pending.total} sub={`${pending.count} claim${pending.count === 1 ? "" : "s"}`} />
        <Stat label="Approved, to be paid" value={toBePaid.total} sub={`${toBePaid.count} claim${toBePaid.count === 1 ? "" : "s"}`} />
        <Stat label="Reimbursed to date" value={paid.total} />
      </div>
      <Card>
        <CardContent className="pt-4 sm:pt-4">
          <ClaimsTable claims={claims} empty="You haven't submitted any claims yet." />
        </CardContent>
      </Card>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-wide text-ink-soft">{label}</div>
      <div className="mt-1 font-serif text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-ink-soft">{sub}</div>}
    </Card>
  );
}
