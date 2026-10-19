import "server-only";
import { sendEmail } from "@/lib/email";
import { createServiceRoleClient } from "@/lib/supabase/admin";

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
