"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { claimDetails } from "@/lib/email-template";
import { emailClaimant, emailReviewers } from "@/lib/notify";
import { formatSGD } from "@/lib/money";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Claim, ClaimStatus } from "@/lib/types";

export type ActionResult = { ok: true } | { ok: false; error: string };

type Outcome = { claimant_id: string; claimant_name: string; amount_cents: number; budget_name: string; status: ClaimStatus };

const uuid = z.uuid();

// The database functions check who may do what and say why not, in words meant for the user.
function refusal(error: { code?: string; message: string }): ActionResult {
  if (["P0001", "P0002", "42501"].includes(error.code ?? "")) return { ok: false, error: error.message };
  console.error("claim action failed", { code: error.code });
  return { ok: false, error: "Something went wrong. Try again." };
}

// Whether the claim is a vendor invoice, to word its email (Finance pays the vendor, not the
// claimant), and what it was for, to name it. Read as the caller, who has just decided or paid it,
// so RLS shows it to them. null if the read fails; an approval's or payment's email is then
// skipped, since its wording would be a guess.
async function kindOf(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data, error } = await supabase
    .from("claims").select("kind, description, vendor_name").eq("id", id)
    .maybeSingle<Pick<Claim, "kind" | "description" | "vendor_name">>();
  if (error || !data) {
    console.error("notify claim read failed", { code: error?.code ?? "not_found" });
    return null;
  }
  return data;
}

export async function decideClaim(id: string, approve: boolean, reason?: string): Promise<ActionResult> {
  const me = await requireMember();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Claim not found." };
  if ((reason?.trim().length ?? 0) > 500) return { ok: false, error: "Keep the reason under 500 characters." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("decide_claim", { p_claim: id, p_approve: approve, p_reason: reason ?? null })
    .single<Outcome>();
  if (error) return refusal(error);

  const hi = `Hi ${data.claimant_name.split(" ")[0]},`;
  const amount = formatSGD(data.amount_cents);
  const link = { href: `/claims/${id}`, label: "View claim" };
  // The decision is saved; the email goes out after the response, so a slow mail server never
  // holds up (or seems to fail) the approval.
  if (data.status === "approved") {
    const claim = await kindOf(supabase, id);
    if (claim?.kind === "invoice") {
      after(() => emailClaimant(data.claimant_id, {
        subject: `Your invoice for ${amount} has been approved`,
        badge: { label: "Approved", tone: "success" },
        heading: "Your invoice has been approved",
        paragraphs: [hi, `Finance has approved the invoice you submitted and will pay ${claim.vendor_name} directly.`],
        details: claimDetails({ description: claim.description, vendor: claim.vendor_name, amount, budget: data.budget_name }),
        link: { ...link, label: "View invoice" },
      }));
    } else if (claim) {
      after(() => emailClaimant(data.claimant_id, {
        subject: `Your claim for ${amount} has been approved`,
        badge: { label: "Approved", tone: "success" },
        heading: "Your claim has been approved",
        paragraphs: [hi, "Finance has approved your claim. You'll be paid shortly, and we'll email you when the money is on its way."],
        details: claimDetails({ description: claim.description, amount, budget: data.budget_name }),
        link,
      }));
    }
  } else if (data.status === "rejected") {
    // The reason matters more than the wording, so this one is sent even if the claim can't be read.
    // Reading it waits for after the response too, so the reviewer isn't kept waiting for it.
    after(async () => {
      const claim = await kindOf(supabase, id);
      const thing = claim?.kind === "invoice" ? "invoice" : "claim";
      await emailClaimant(data.claimant_id, {
        subject: `Your ${thing} for ${amount} needs attention`,
        badge: { label: "Not approved", tone: "warning" },
        heading: `Your ${thing} wasn't approved`,
        paragraphs: [hi, "It couldn't be approved as it is, for the reason below."],
        details: claimDetails({ description: claim?.description, vendor: claim?.kind === "invoice" ? claim.vendor_name : null, amount, budget: data.budget_name }),
        callout: { label: "Reason", text: reason?.trim() ?? "" },
        closing: `You're welcome to submit a new ${thing} with the corrections.`,
        link: { ...link, label: `View ${thing}` },
      });
    });
  } else if (data.status === "pending_finance") {
    // Reviewed: tell Finance it's waiting for final approval, except whoever just reviewed it.
    after(() => emailReviewers(id, "pending_finance", me.id));
  }

  revalidatePath(`/claims/${id}`);
  revalidatePath("/review");
  return { ok: true };
}

// Records the payment and takes it off the chosen bank account's expected balance, in one database
// transaction (mark_paid).
export async function markPaid(id: string, reference: string, accountId: string): Promise<ActionResult> {
  await requireMember();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Claim not found." };
  if (!uuid.safeParse(accountId).success) return { ok: false, error: "Choose the account you paid from." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("mark_paid", { p_claim: id, p_reference: reference, p_account: accountId })
    .single<Outcome>();
  if (error) return refusal(error);

  const hi = `Hi ${data.claimant_name.split(" ")[0]},`;
  const amount = formatSGD(data.amount_cents);
  const claim = await kindOf(supabase, id);
  if (claim?.kind === "invoice") {
    after(() => emailClaimant(data.claimant_id, {
      subject: `Your invoice for ${amount} has been paid`,
      badge: { label: "Paid", tone: "paid" },
      heading: `We've paid ${claim.vendor_name}`,
      paragraphs: [hi, `We've paid ${claim.vendor_name} ${amount} for the invoice you submitted.`],
      details: claimDetails({ description: claim.description, vendor: claim.vendor_name, amount, budget: data.budget_name }),
      link: { href: `/claims/${id}`, label: "View invoice" },
    }));
  } else if (claim) {
    after(() => emailClaimant(data.claimant_id, {
      subject: `You've been paid ${amount}`,
      badge: { label: "Paid", tone: "paid" },
      heading: `You've been paid ${amount}`,
      paragraphs: [hi, `We've sent you ${amount} for your claim. Thank you for everything you do for New Normal!`],
      details: claimDetails({ description: claim.description, amount, budget: data.budget_name }),
      link: { href: `/claims/${id}`, label: "View claim" },
    }));
  }

  revalidatePath(`/claims/${id}`);
  revalidatePath("/payouts");
  return { ok: true };
}

// Adds receipts to an imported claim (attach_claim_files: Finance only, imported claims only, the
// caller's own uploads).
export async function attachClaimFiles(id: string, paths: string[]): Promise<ActionResult> {
  await requireMember();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Claim not found." };
  if (!paths.length || paths.length > 5 || paths.some((p) => typeof p !== "string" || p.length > 300)) {
    return { ok: false, error: "Choose up to 5 files." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("attach_claim_files", { p_claim: id, p_paths: paths });
  if (error) return refusal(error);
  revalidatePath(`/claims/${id}`);
  return { ok: true };
}
