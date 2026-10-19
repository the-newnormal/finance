import { ArrowLeft, Check, FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import QRCode from "qrcode";
import { decryptPayout, type PayoutDetails } from "@/lib/crypto";
import { formatDate, formatSGD } from "@/lib/money";
import { buildPayNowPayload } from "@/lib/paynow";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { CLAIM_COLUMNS, isFinance, PAYOUT_LABEL, type Claim, type ClaimEvent, type Member } from "@/lib/types";
import { MarkPaidForm, ReviewActions } from "./claim-actions";

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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound(); // a mistyped link
  const supabase = await createClient();

  // RLS: only the claimant and people with purview over its division get a row.
  const { data: claim, error } = await supabase.from("claims").select(CLAIM_COLUMNS).eq("id", id).maybeSingle<Claim>();
  if (error) throw new Error(`claim read failed: ${error.code}`); // an outage, not a missing claim
  if (!claim) notFound();

  const [pool, category, events, files] = await Promise.all([
    supabase.from("pools").select("name").eq("id", claim.pool_id).maybeSingle(),
    supabase.from("categories").select("name").eq("id", claim.category_id).maybeSingle(),
    supabase.from("claim_events").select("id, action, actor_name, note, at").eq("claim_id", claim.id).order("at").order("id"),
    // Signed as the viewer, so storage RLS decides; links last ten minutes.
    supabase.storage.from("receipts").createSignedUrls(claim.attachment_paths, 600),
  ]);
  for (const r of [pool, category, events, files]) if (r.error) throw new Error(`claim page read failed`);
  const ref = `NN-${claim.id.slice(0, 8).toUpperCase()}`;
  const { data: myDivisions } = await supabase.from("division_members").select("division_id").eq("member_id", me.id);
  const may = permissions(me, claim, (myDivisions ?? []).map((d) => d.division_id as string));
  const payout = may.seePayout ? await payoutPanel(supabase, claim, ref) : null;

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
          {may.decide && (
            <Card>
              <CardHeader><CardTitle>{claim.status === "pending_finance" ? "Finance approval" : "Your review"}</CardTitle></CardHeader>
              <CardContent>
                <ReviewActions claimId={claim.id} canApprove canReject
                  approveLabel={claim.status === "pending_finance" ? "Approve for payment" : "Approve"} />
              </CardContent>
            </Card>
          )}

          {payout && (
            <Card>
              <CardHeader><CardTitle>{claim.kind === "invoice" ? "Pay vendor" : "Reimburse"}</CardTitle></CardHeader>
              <CardContent className="grid gap-4 text-sm">
                {"error" in payout ? (
                  <Alert>{payout.error}</Alert>
                ) : (
                  <>
                    {payout.qr && (
                      <div className="grid justify-items-center gap-2 rounded-xl bg-white p-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={payout.qr} alt="PayNow QR code" className="size-56" />
                        <p className="text-center text-xs text-ink-soft">Scan with the New Normal bank app. Amount and reference are pre-filled.</p>
                      </div>
                    )}
                    <dl className="grid gap-2">
                      <Item label="Method">{PAYOUT_LABEL[payout.details.type]}{payout.details.type === "bank" && " (manual transfer)"}</Item>
                      <Item label="Name">{payout.details.name}</Item>
                      {payout.details.proxy && <Item label={payout.details.type === "paynow_uen" ? "UEN" : "Mobile"}><span className="font-mono">{payout.details.proxy}</span></Item>}
                      {payout.details.type === "bank" && (
                        <>
                          <Item label="Bank">{payout.details.bankName}</Item>
                          <Item label="Account"><span className="font-mono">{payout.details.accountNumber}</span></Item>
                        </>
                      )}
                      <Item label="Reference"><span className="font-mono">{ref}</span></Item>
                    </dl>
                  </>
                )}
                {/* Only once Finance can see where the money goes. */}
                {may.markPaid && !("error" in payout) && <MarkPaidForm claimId={claim.id} />}
              </CardContent>
            </Card>
          )}

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

// What to offer this viewer. Display only: decide_claim, mark_paid and claim_payout_enc check again.
function permissions(me: Member, c: Claim, myDivisions: string[]) {
  const own = c.claimant_id === me.id;
  const reviews =
    c.status === "pending_review" && !own &&
    (isFinance(me) || (me.role !== "volunteer" && myDivisions.includes(c.division_id)));
  const finalises = c.status === "pending_finance" && isFinance(me) && (!own || me.finance);
  return {
    decide: reviews || finalises,
    seePayout: isFinance(me) && (c.status === "pending_finance" || c.status === "approved"),
    markPaid: isFinance(me) && c.status === "approved",
  };
}

// Finance's view of where the money goes: decrypted here, with the claimant's id as AAD, and a
// PayNow QR once the claim is approved.
async function payoutPanel(
  supabase: Awaited<ReturnType<typeof createClient>>,
  claim: Claim,
  ref: string,
): Promise<{ details: PayoutDetails; qr: string | null } | { error: string }> {
  const { data, error } = await supabase
    .rpc("claim_payout_enc", { p_claim: claim.id })
    .maybeSingle<{ claimant_id: string; payout_enc: string }>();
  if (error || !data) return { error: "Payout details aren't available." };
  let details: PayoutDetails;
  try {
    details = decryptPayout(data.payout_enc, data.claimant_id);
  } catch {
    console.error("payout decrypt failed", { code: "decrypt" });
    return { error: "These payout details can't be read (wrong key, or they were altered). Ask the claimant to resubmit." };
  }
  let qr: string | null = null;
  if (claim.status === "approved" && details.type !== "bank" && details.proxy) {
    qr = await QRCode.toDataURL(
      buildPayNowPayload({
        proxyType: details.type === "paynow_mobile" ? "mobile" : "uen",
        proxy: details.proxy,
        amountCents: claim.amount_cents,
        payeeName: details.name,
        reference: ref,
      }),
      { margin: 1, width: 320, color: { dark: "#34363e", light: "#ffffff" } },
    );
  }
  return { details, qr };
}
