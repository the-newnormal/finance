"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { emailClaimant } from "@/lib/notify";
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

// Whether the claim is a vendor invoice, to word its email: Finance pays the vendor, not the
// claimant. Read as the caller, who has just decided or paid it, so RLS shows it to them. null if
// the read fails; the email is then skipped, since its wording would be a guess.
async function kindOf(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data, error } = await supabase
    .from("claims").select("kind, vendor_name").eq("id", id)
    .maybeSingle<Pick<Claim, "kind" | "vendor_name">>();
  if (error || !data) {
    console.error("notify skipped", { code: error?.code ?? "not_found" });
    return null;
  }
  return data;
}

export async function decideClaim(id: string, approve: boolean, reason?: string): Promise<ActionResult> {
  await requireMember();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Claim not found." };
  if ((reason?.trim().length ?? 0) > 500) return { ok: false, error: "Keep the reason under 500 characters." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("decide_claim", { p_claim: id, p_approve: approve, p_reason: reason ?? null })
    .single<Outcome>();
  if (error) return refusal(error);

  const first = data.claimant_name.split(" ")[0];
  const amount = formatSGD(data.amount_cents);
  // The decision is saved; the email goes out after the response, so a slow mail server never
  // holds up (or seems to fail) the approval.
  if (data.status === "approved") {
    const claim = await kindOf(supabase, id);
    if (claim?.kind === "invoice") {
      after(() => emailClaimant(data.claimant_id, `Your invoice for ${amount} has been approved`, [
        `Hi ${first},`,
        `The invoice you submitted for ${data.budget_name} (${claim.vendor_name}, ${amount}) has been approved by Finance, who will pay the vendor directly.`,
      ], { href: `/claims/${id}`, label: "View invoice" }));
    } else if (claim) {
      after(() => emailClaimant(data.claimant_id, `Your claim for ${amount} has been approved`, [
        `Hi ${first},`,
        `Your claim of ${amount} for ${data.budget_name} has been approved by Finance. You'll be paid shortly.`,
      ], { href: `/claims/${id}`, label: "View claim" }));
    }
  } else if (data.status === "rejected") {
    after(() => emailClaimant(data.claimant_id, `Your claim for ${amount} needs attention`, [
      `Hi ${first},`,
      `Your claim for ${data.budget_name} was not approved.`,
      `Reason: ${reason?.trim()}`,
      "You're welcome to submit a new claim with the corrections.",
    ], { href: `/claims/${id}`, label: "View claim" }));
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

  const first = data.claimant_name.split(" ")[0];
  const amount = formatSGD(data.amount_cents);
  const claim = await kindOf(supabase, id);
  if (claim?.kind === "invoice") {
    after(() => emailClaimant(data.claimant_id, `Your invoice for ${amount} has been paid`, [
      `Hi ${first},`,
      `We've paid ${claim.vendor_name} ${amount} for the ${data.budget_name} invoice you submitted.`,
    ]));
  } else if (claim) {
    after(() => emailClaimant(data.claimant_id, `You've been paid ${amount}`, [
      `Hi ${first},`,
      `We've sent ${amount} for your ${data.budget_name} claim. Thank you for everything you do for New Normal!`,
    ]));
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
