import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { formatDate, formatSGD } from "@/lib/money";
import type { Claim } from "@/lib/types";

export type ClaimRow = Pick<
  Claim,
  "id" | "kind" | "status" | "claimant_name" | "description" | "amount_cents" | "vendor_name" | "created_at"
> & { budgetName: string; categoryName: string };

export function ClaimsTable({ claims, showClaimant = false, empty }: { claims: ClaimRow[]; showClaimant?: boolean; empty: string }) {
  if (!claims.length) return <p className="px-1 py-8 text-center text-sm text-ink-soft">{empty}</p>;
  return (
    <Table>
      <THead>
        <tr>
          <TH>Submitted</TH>
          {showClaimant && <TH>By</TH>}
          <TH>Budget</TH>
          <TH>Details</TH>
          <TH className="text-right">Amount</TH>
          <TH>Status</TH>
        </tr>
      </THead>
      <TBody>
        {claims.map((c) => (
          <tr key={c.id} className="group hover:bg-canvas/60">
            <TD className="whitespace-nowrap text-ink-soft">{formatDate(c.created_at)}</TD>
            {showClaimant && <TD className="whitespace-nowrap">{c.claimant_name}</TD>}
            <TD className="whitespace-nowrap">{c.budgetName}</TD>
            <TD className="min-w-48">
              <Link href={`/claims/${c.id}`} className="font-medium text-ink underline-offset-4 group-hover:underline">
                {c.kind === "invoice" ? `Invoice · ${c.vendor_name}` : c.categoryName}
              </Link>
              <div className="line-clamp-1 text-xs text-ink-soft">{c.description}</div>
            </TD>
            <TD className="whitespace-nowrap text-right tabular-nums">{formatSGD(c.amount_cents)}</TD>
            <TD><StatusBadge status={c.status} /></TD>
          </tr>
        ))}
      </TBody>
    </Table>
  );
}
