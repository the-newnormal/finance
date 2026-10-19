import { ArrowLeft, Check, FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatSGD } from "@/lib/money";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { CLAIM_COLUMNS, PAYOUT_LABEL, type Claim, type ClaimEvent } from "@/lib/types";

export const metadata = { title: "Claim" };

const EVENT_LABEL: Record<ClaimEvent["action"], string> = {
  submitted: "Submitted",
  reviewed: "Approved by reviewer",
  approved: "Approved by Finance",
  rejected: "Rejected",
  paid: "Paid",
};

export default async function ClaimPage({ params, searchParams }: PageProps<"/claims/[id]">) {
  const [{ id }, { submitted, unsaved }] = await Promise.all([params, searchParams]);
  const me = await requireMember();
  const supabase = await createClient();

  // RLS: only the claimant and people with purview over its division get a row.
  const { data: claim } = await supabase.from("claims").select(CLAIM_COLUMNS).eq("id", id).maybeSingle<Claim>();
  if (!claim) notFound();

  const [pool, category, events, files] = await Promise.all([
    supabase.from("pools").select("name").eq("id", claim.pool_id).maybeSingle(),
    supabase.from("categories").select("name").eq("id", claim.category_id).maybeSingle(),
    supabase.from("claim_events").select("id, action, actor_name, note, at").eq("claim_id", claim.id).order("at").order("id"),
    // Signed as the viewer, so storage RLS decides; links last ten minutes.
    supabase.storage.from("receipts").createSignedUrls(claim.attachment_paths, 600),
  ]);
  const ref = `NN-${claim.id.slice(0, 8).toUpperCase()}`;

  return (
    <>
      <Link href={claim.claimant_id === me.id ? "/claims" : "/review"} className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" /> Back
      </Link>
      {submitted && <Alert tone="success" className="mb-6">Thanks! Your claim has been submitted. We&apos;ll email you when it&apos;s approved.</Alert>}
      {unsaved && <Alert className="mb-6">Your payout details couldn&apos;t be remembered for next time. You&apos;ll need to enter them again on your next claim.</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={claim.status} />
                <span className="text-xs text-ink-soft">{ref}</span>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <CardTitle className="text-3xl">{formatSGD(claim.amount_cents)}</CardTitle>
                <span className="text-sm text-ink-soft">{claim.kind === "invoice" ? "Vendor invoice" : "Reimbursement"}</span>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                <Item label="Budget">{pool.data?.name ?? "—"}</Item>
                <Item label="Category">{category.data?.name ?? "—"}</Item>
                <Item label="Submitted by">{claim.claimant_name}</Item>
                <Item label="Submitted">{formatDate(claim.created_at)}</Item>
                {claim.kind === "invoice" ? (
                  <>
                    <Item label="Vendor">{claim.vendor_name}</Item>
                    <Item label="Due">{claim.due_date ? formatDate(claim.due_date) : "—"}</Item>
                  </>
                ) : (
                  <Item label="Date of purchase">{claim.expense_date ? formatDate(claim.expense_date) : "—"}</Item>
                )}
                <Item label="Pay to">{PAYOUT_LABEL[claim.payout_type]} · {claim.payout_masked}</Item>
                <Item label="Description" className="sm:col-span-2"><p className="whitespace-pre-wrap">{claim.description}</p></Item>
                {claim.rejection_reason && <Item label="Reason for rejection" className="sm:col-span-2">{claim.rejection_reason}</Item>}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{claim.kind === "invoice" ? "Invoice" : "Receipts"}</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {(files.data ?? []).map((f) => {
                const name = (f.path ?? "").split("/").pop()?.replace(/^\d+-/, "") ?? "file";
                return f.signedUrl ? (
                  <a key={f.path} href={f.signedUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-line p-3 text-sm hover:bg-canvas">
                    <span className="grid size-10 place-items-center rounded-lg bg-canvas"><FileText className="size-5 text-ink-soft" /></span>
                    <span className="truncate">{name}</span>
                  </a>
                ) : (
                  <div key={f.path} className="rounded-xl border border-line p-3 text-sm text-ink-soft">{name} (unavailable)</div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent>
              <ol className="grid gap-3 text-sm">
                {((events.data ?? []) as ClaimEvent[]).map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${e.action === "rejected" ? "bg-orange/50" : "bg-teal"}`}>
                      <Check className="size-3" />
                    </span>
                    <div>
                      <div className="font-medium">{EVENT_LABEL[e.action]}</div>
                      <div className="text-xs text-ink-soft">{e.actor_name} · {formatDate(e.at)}</div>
                      {e.note && <div className="mt-1 rounded-lg bg-canvas px-2.5 py-1.5 text-xs">{e.note}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Item({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
