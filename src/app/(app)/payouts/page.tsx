import Link from "next/link";
import { ClaimsTable } from "@/components/claims-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchAll, ROW_COLUMNS, withNames } from "@/lib/claims";
import { formatSGD } from "@/lib/money";
import { requireFinance } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Payouts" };

export default async function PayoutsPage() {
  await requireFinance();
  const supabase = await createClient();
  const approved = await withNames(await fetchAll((from, to) =>
    supabase.from("claims").select(ROW_COLUMNS).eq("status", "approved").order("created_at").order("id").range(from, to),
  ));
  const reimbursements = approved.filter((c) => c.kind === "reimbursement");
  const invoices = approved.filter((c) => c.kind === "invoice");
  const total = (cs: typeof approved) => formatSGD(cs.reduce((s, c) => s + c.amount_cents, 0));

  return (
    <>
      <PageHeader
        title="Payouts"
        description="Approved claims waiting to be paid. Open one for its PayNow QR code, pay it, then record the bank reference."
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href="/payouts/import">Import paid claims</Link></Button>
            <Button asChild variant="outline"><a href="/api/export">Export claims (CSV)</a></Button>
          </div>
        }
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Reimbursements · {total(reimbursements)}</CardTitle>
            <CardDescription>PayNow claims show a QR code. Bank transfers show the account details to copy.</CardDescription>
          </CardHeader>
          <CardContent><ClaimsTable claims={reimbursements} showClaimant empty="No reimbursements waiting." /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Vendor invoices · {total(invoices)}</CardTitle></CardHeader>
          <CardContent><ClaimsTable claims={invoices} showClaimant empty="No invoices waiting." /></CardContent>
        </Card>
      </div>
    </>
  );
}
