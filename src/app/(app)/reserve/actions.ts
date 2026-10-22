"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmountToCents } from "@/lib/money";
import { requireFinance } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type ReserveResult = { ok: true } | { ok: false; error: string };

const input = z.object({
  amount: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  note: z.string().trim().min(3, "Add a note saying where the funds come from").max(300),
});

// add_to_reserve checks the caller is Finance and stamps who did it (0006_reserve.sql). Additions are
// money in only (0010): money leaves the reserve only through a claim or a loan.
export async function addToReserve(raw: z.input<typeof input>): Promise<ReserveResult> {
  await requireFinance();
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const cents = parseAmountToCents(v.amount);
  if (!cents) return { ok: false, error: "Enter a valid amount, e.g. 500.00." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_to_reserve", {
    p_amount_cents: cents,
    p_date: v.date,
    p_note: v.note,
  });
  if (error) {
    if (["P0001", "42501"].includes(error.code ?? "")) return { ok: false, error: error.message };
    console.error("reserve addition failed", { code: error.code });
    return { ok: false, error: "That couldn't be saved. Try again." };
  }
  revalidatePath("/reserve");
  revalidatePath("/budgets");
  return { ok: true };
}
