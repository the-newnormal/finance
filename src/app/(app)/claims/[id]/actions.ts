"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { emailClaimant } from "@/lib/notify";
import { formatSGD } from "@/lib/money";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { ClaimStatus } from "@/lib/types";

export type ActionResult = { ok: true } | { ok: false; error: string };

type Outcome = { claimant_id: string; claimant_name: string; amount_cents: number; pool_name: string; status: ClaimStatus };

const uuid = z.uuid();

// The database functions check who may do what and say why not, in words meant for the user.
function refusal(error: { code?: string; message: string }): ActionResult {
  if (["P0001", "P0002", "42501"].includes(error.code ?? "")) return { ok: false, error: error.message };
  console.error("claim action failed", { code: error.code });
  return { ok: false, error: "Something went wrong. Try again." };
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
    after(() => emailClaimant(data.claimant_id, `Your claim for ${amount} has been approved`, [
      `Hi ${first},`,
      `Your claim of ${amount} for ${data.pool_name} has been approved by Finance. You'll be paid shortly.`,
    ], { href: `/claims/${id}`, label: "View claim" }));
  } else if (data.status === "rejected") {
    after(() => emailClaimant(data.claimant_id, `Your claim for ${amount} needs attention`, [
      `Hi ${first},`,
      `Your claim for ${data.pool_name} was not approved.`,
      `Reason: ${reason?.trim()}`,
      "You're welcome to submit a new claim with the corrections.",
    ], { href: `/claims/${id}`, label: "View claim" }));
  }

  revalidatePath(`/claims/${id}`);
  revalidatePath("/review");
  return { ok: true };
}

export async function markPaid(id: string, reference: string): Promise<ActionResult> {
  await requireMember();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Claim not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_paid", { p_claim: id, p_reference: reference }).single<Outcome>();
  if (error) return refusal(error);

  after(() => emailClaimant(data.claimant_id, `You've been paid ${formatSGD(data.amount_cents)}`, [
    `Hi ${data.claimant_name.split(" ")[0]},`,
    `We've sent ${formatSGD(data.amount_cents)} for your ${data.pool_name} claim. Thank you for everything you do for New Normal!`,
  ]));

  revalidatePath(`/claims/${id}`);
  revalidatePath("/payouts");
  return { ok: true };
}
