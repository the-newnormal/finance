import "server-only";
import { sendEmail } from "@/lib/email";
import { formatSGD } from "@/lib/money";
import { createServiceRoleClient } from "@/lib/supabase/admin";

type Service = ReturnType<typeof createServiceRoleClient>;
type Reviewer = { id: string; email: string; name: string };

// Emails a claim's claimant about a decision the database has already made and checked.
// decide_claim and mark_paid return the claimant's id, never their address: reviewers may not read
// other members' rows, and a function returning it could be called straight from the browser. So
// the address is looked up here, on the server only, with the service role, and goes nowhere but
// the email. Failures are logged as codes and never undo the decision.
export async function emailClaimant(
  claimantId: string,
  subject: string,
  paragraphs: string[],
  link?: { href: string; label: string },
) {
  let service;
  try {
    service = createServiceRoleClient();
  } catch {
    console.error("notify skipped", { code: "no_service_key" });
    return;
  }
  const { data, error } = await service.from("members").select("email").eq("id", claimantId).maybeSingle();
  if (error || !data) {
    console.error("notify lookup failed", { code: error?.code ?? "not_found" });
    return;
  }
  await sendEmail(data.email as string, subject, paragraphs, link);
}

// Active members with this role, optionally only among `ids`.
async function activeMembers(service: Service, role: "lead" | "finance", ids?: string[]): Promise<Reviewer[] | null> {
  if (ids && !ids.length) return [];
  let query = service.from("members").select("id, email, name").eq("role", role).eq("active", true);
  if (ids) query = query.in("id", ids);
  const { data, error } = await query;
  if (error) {
    console.error("notify reviewers lookup failed", { code: error.code });
    return null;
  }
  return (data ?? []) as Reviewer[];
}

// Emails whoever must act on a claim next that it is waiting for them. A volunteer's claim awaiting
// review goes to the leads of its division, or to Finance when no active lead is left to review it.
// A claim awaiting final approval goes to Finance. Never to the claimant, nor to `except` (whoever
// just acted). The claim and the decision are already saved and checked by the database; this only
// reads, with the service role, who reviews it and their addresses, which go nowhere but the email.
// Failures are logged as codes.
export async function emailReviewers(claimId: string, except?: string) {
  let service;
  try {
    service = createServiceRoleClient();
  } catch {
    console.error("notify skipped", { code: "no_service_key" });
    return;
  }
  const { data: claim, error } = await service
    .from("claims")
    .select("status, division_id, claimant_id, claimant_name, amount_cents, kind, vendor_name, budget_id")
    .eq("id", claimId)
    .maybeSingle();
  if (error || !claim) {
    console.error("notify reviewers lookup failed", { code: error?.code ?? "not_found" });
    return;
  }
  if (claim.status !== "pending_review" && claim.status !== "pending_finance") return;

  const notThem = (r: Reviewer) => r.id !== claim.claimant_id && r.id !== except;
  let reviewers: Reviewer[] | null = [];
  if (claim.status === "pending_review" && claim.division_id) {
    const { data: leads, error: leadsError } = await service
      .from("division_leads").select("member_id").eq("division_id", claim.division_id);
    if (leadsError) {
      console.error("notify reviewers lookup failed", { code: leadsError.code });
      return;
    }
    reviewers = await activeMembers(service, "lead", (leads ?? []).map((l) => l.member_id as string));
    if (reviewers) reviewers = reviewers.filter(notThem);
  }
  if (reviewers && !reviewers.length) reviewers = (await activeMembers(service, "finance"))?.filter(notThem) ?? null;
  if (!reviewers?.length) return;

  const { data: budget } = await service.from("budgets").select("name").eq("id", claim.budget_id).maybeSingle();
  const amount = formatSGD(Number(claim.amount_cents));
  const budgetName = (budget?.name as string | undefined) ?? "a budget";
  const invoice = claim.kind === "invoice";
  const subject = claim.status === "pending_review"
    ? "A claim is waiting for your review"
    : `${invoice ? "An invoice" : "A claim"} is waiting for Finance approval`;
  const what = claim.status === "pending_review"
    ? `${claim.claimant_name} has submitted a claim of ${amount} for ${budgetName}. It needs a review before it goes to Finance for final approval.`
    : invoice
      ? `${claim.claimant_name} has submitted an invoice from ${claim.vendor_name} for ${amount} (${budgetName}). It needs Finance's approval before the vendor is paid.`
      : `${claim.claimant_name}'s claim of ${amount} for ${budgetName} is waiting for Finance's final approval.`;
  for (const r of reviewers) {
    await sendEmail(r.email, subject, [`Hi ${r.name.split(" ")[0]},`, what], {
      href: `/claims/${claimId}`,
      label: invoice ? "Review invoice" : "Review claim",
    });
  }
}
