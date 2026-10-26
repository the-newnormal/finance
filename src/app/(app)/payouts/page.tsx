import Link from "next/link";
import { ClaimsTable } from "@/components/claims-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { fetchAll, ROW_COLUMNS, withNames } from "@/lib/claims";
import { singaporeToday } from "@/lib/dates";
import { formatSGD } from "@/lib/money";
import { requireFinance } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { STATUS_LABEL, type Budget, type ClaimStatus, type Division } from "@/lib/types";

export const metadata = { title: "Disbursements" };

export default async function PayoutsPage() {
  await requireFinance();
  const supabase = await createClient();
  const [approved, divisions, budgets] = await Promise.all([
    fetchAll((from, to) =>
      supabase.from("claims").select(ROW_COLUMNS).eq("status", "approved").order("created_at").order("id").range(from, to),
    ).then(withNames),
    // For the export's filters.
    fetchAll<Division>((from, to) => supabase.from("divisions").select("id, name").order("id").range(from, to)),
    fetchAll<Pick<Budget, "id" | "name">>((from, to) => supabase.from("budgets").select("id, name").order("id").range(from, to)),
  ]);
  const byName = <T extends { name: string }>(rows: T[]) => rows.sort((x, y) => x.name.localeCompare(y.name));
  const reimbursements = approved.filter((c) => c.kind === "reimbursement");
  const invoices = approved.filter((c) => c.kind === "invoice");
  const total = (cs: typeof approved) => formatSGD(cs.reduce((s, c) => s + c.amount_cents, 0));

  return (
    <>
      <PageHeader
        title="Disbursements"
        description="Approved claims waiting to be disbursed. Open one for its PayNow QR code, make the transfer, then record the disbursement and its bank reference."
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href="/payouts/import">Import past claims</Link></Button>
            <Button asChild variant="outline"><a href="#export">Export claims (CSV)</a></Button>
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
        <ExportCard today={singaporeToday()} divisions={byName(divisions)} budgets={byName(budgets)} />
      </div>
    </>
  );
}

// Downloads claims as CSV (/api/export). Every field left blank means "any", so the default is
// every claim. A plain GET form: nothing here runs in the browser.
function ExportCard({ today, divisions, budgets }: { today: string; divisions: Division[]; budgets: Pick<Budget, "id" | "name">[] }) {
  return (
    <Card id="export" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>Export claims (CSV)</CardTitle>
        <CardDescription>
          Every claim, or only those you choose. Dates are Singapore dates. No payment details are included. For a year&apos;s
          spending by category, choose a row per item bought, the year&apos;s disbursement dates and the reimbursed or settled status.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action="/api/export" method="get" className="grid gap-4 sm:grid-cols-3">
          <Field label="One row per" className="sm:col-span-3">
            <Select name="rows" defaultValue="claims">
              <option value="claims">Claim</option>
              <option value="items">Item bought (each item&apos;s share of its claim, by category)</option>
            </Select>
          </Field>
          <Field label="From"><Input type="date" name="from" max={today} /></Field>
          <Field label="To"><Input type="date" name="to" max={today} /></Field>
          <Field label="The dates are when it was">
            <Select name="dates" defaultValue="submitted">
              <option value="submitted">Submitted</option>
              <option value="paid">Disbursed</option>
            </Select>
          </Field>
          <Field label="Division">
            <Select name="division" defaultValue="">
              <option value="">Any division</option>
              {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Budget">
            <Select name="budget" defaultValue="">
              <option value="">Any budget</option>
              {budgets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue="">
              <option value="">Any status</option>
              {(Object.keys(STATUS_LABEL) as ClaimStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" variant="outline">Download CSV</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
