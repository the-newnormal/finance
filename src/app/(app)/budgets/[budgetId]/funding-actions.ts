"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmountToCents, parseBudgetToCents } from "@/lib/money";
import { requireFinance } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type FundingResult = { ok: true } | { ok: false; error: string };

// Each function below checks the caller is Finance, locks what it reads and stamps who did it
// (0010_budget_funding.sql); the checks here only catch typing mistakes early.
const budget = z.string().uuid("Choose a budget");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const note = z.string().trim().min(3, "Add a note saying what this is").max(300);
const fund = z.object({ budget, amount: z.string(), date, note });
const grant = fund.extend({ account: z.string().uuid("Choose the bank account it arrived in") });
const commitment = z.object({ budget, amount: z.string() });

async function call(fn: string, args: Record<string, unknown>, budgetId: string, log: string): Promise<FundingResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    if (["P0001", "P0002", "42501"].includes(error.code ?? "")) return { ok: false, error: error.message };
    console.error(log, { code: error.code });
    return { ok: false, error: "That couldn't be saved. Try again." };
  }
  revalidatePath(`/budgets/${budgetId}`);
  revalidatePath("/budgets");
  revalidatePath("/reserve");
  if (fn === "record_grant") revalidatePath("/bank");
  return { ok: true };
}

/** Grant monies arrive: into a bank account and onto the budget's balance. */
export async function recordGrant(raw: z.input<typeof grant>): Promise<FundingResult> {
  await requireFinance();
  const parsed = grant.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const cents = parseAmountToCents(v.amount);
  if (!cents) return { ok: false, error: "Enter a valid amount, e.g. 500.00." };
  return call("record_grant",
    { p_budget: v.budget, p_account: v.account, p_amount_cents: cents, p_date: v.date, p_note: v.note },
    v.budget, "grant record failed");
}

/** The reserve lends the budget money until its grant arrives. */
export async function loanFromReserve(raw: z.input<typeof fund>): Promise<FundingResult> {
  return moveFunds("loan_from_reserve", raw, "reserve loan failed");
}

/** The budget pays its loans from the reserve back. */
export async function repayReserve(raw: z.input<typeof fund>): Promise<FundingResult> {
  return moveFunds("repay_reserve", raw, "reserve repayment failed");
}

async function moveFunds(fn: string, raw: z.input<typeof fund>, log: string): Promise<FundingResult> {
  await requireFinance();
  const parsed = fund.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const cents = parseAmountToCents(v.amount);
  if (!cents) return { ok: false, error: "Enter a valid amount, e.g. 500.00." };
  return call(fn, { p_budget: v.budget, p_amount_cents: cents, p_date: v.date, p_note: v.note }, v.budget, log);
}

/** The grant committed to the budget (0 allowed: none). */
export async function setGrantCommitment(raw: z.input<typeof commitment>): Promise<FundingResult> {
  await requireFinance();
  const parsed = commitment.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const cents = parseBudgetToCents(v.amount);
  if (cents === null) return { ok: false, error: "Enter a valid amount, e.g. 5000.00." };
  return call("set_grant_commitment", { p_budget: v.budget, p_cents: cents }, v.budget, "grant commitment failed");
}
