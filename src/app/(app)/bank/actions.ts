"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmountToCents, parseBudgetToCents } from "@/lib/money";
import { requireFinance } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type BankResult = { ok: true } | { ok: false; error: string };

// Every write goes through a database function that checks the caller is Finance or an admin and
// stamps who did it (supabase/migrations/0002_bank_accounts.sql). Logs carry codes only.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const uuid = z.uuid("Choose an account");
const note = z.string().trim().max(300);

function done(error: { code?: string; message: string } | null): BankResult {
  if (!error) {
    revalidatePath("/bank");
    return { ok: true };
  }
  // Our functions' and constraints' own messages are written for Finance.
  if (["P0001", "P0002", "42501"].includes(error.code ?? "")) return { ok: false, error: error.message };
  if (error.code === "23505") return { ok: false, error: "An account with that name already exists." };
  if (error.code === "23514") return { ok: false, error: "Check the details: the last four digits must be four numbers." };
  console.error("bank action failed", { code: error.code });
  return { ok: false, error: "That couldn't be saved. Try again." };
}

const newAccount = z.object({
  name: z.string().trim().min(1, "Name the account").max(80),
  bank: z.string().trim().max(40),
  last4: z.string().trim().regex(/^\d{4}$/, "Enter the account number's last four digits"),
  opening: z.string(),
  asOf: date,
});

export async function addAccount(input: z.input<typeof newAccount>): Promise<BankResult> {
  await requireFinance();
  const parsed = newAccount.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const opening = parseBudgetToCents(v.opening);
  if (opening === null) return { ok: false, error: "Enter the opening balance, e.g. 12500.00 (or 0)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_bank_account", {
    p_name: v.name, p_bank: v.bank, p_last4: v.last4, p_opening_cents: opening, p_as_of: v.asOf,
  });
  return done(error);
}

const entry = z.object({
  accountId: uuid,
  kind: z.enum(["grant", "adjustment"]),
  direction: z.enum(["in", "out"]),
  amount: z.string(),
  date,
  note: note.min(3, "Add a note saying what this is"),
  /** The balance the "match DBS" shortcut computed from; the database refuses it if that changed. */
  expectedBalanceCents: z.number().int().optional(),
});

/** A grant (money in) or an adjustment (in or out) to match the bank. */
export async function recordEntry(input: z.input<typeof entry>): Promise<BankResult> {
  await requireFinance();
  const parsed = entry.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const cents = parseAmountToCents(v.amount);
  if (!cents) return { ok: false, error: "Enter a valid amount, e.g. 2500.00." };
  const signed = v.kind === "grant" || v.direction === "in" ? cents : -cents;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_bank_entry", {
    p_account: v.accountId, p_kind: v.kind, p_amount_cents: signed, p_date: v.date, p_note: v.note,
    p_expected_balance_cents: v.expectedBalanceCents ?? null,
  });
  return done(error);
}

const transferInput = z.object({ from: uuid, to: uuid, amount: z.string(), date, note });

export async function transfer(input: z.input<typeof transferInput>): Promise<BankResult> {
  await requireFinance();
  const parsed = transferInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const cents = parseAmountToCents(v.amount);
  if (!cents) return { ok: false, error: "Enter a valid amount, e.g. 2500.00." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_between_accounts", {
    p_from: v.from, p_to: v.to, p_amount_cents: cents, p_date: v.date, p_note: v.note || null,
  });
  return done(error);
}

export async function setAccountActive(accountId: string, active: boolean): Promise<BankResult> {
  await requireFinance();
  if (!uuid.safeParse(accountId).success) return { ok: false, error: "Choose an account." };
  const supabase = await createClient();
  const { error } = await supabase.from("bank_accounts").update({ active }).eq("id", accountId);
  return done(error);
}
