"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseBudgetToCents } from "@/lib/money";
import { requireFinance } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "../people/actions";

// Everything here writes as the signed-in Finance member: RLS (private.is_finance()) decides.

const name = (max: number) => z.string().trim().min(1).max(max);

function done(error: { code?: string; message?: string } | null, what: string): Result {
  if (!error) {
    revalidatePath("/setup");
    revalidatePath("/budgets");
    return { ok: true };
  }
  if (error.code === "23505") return { ok: false, error: `That ${what} already exists.` };
  if ((error.code === "P0001" || error.code === "P0002") && error.message) return { ok: false, error: error.message };
  console.error(`setup ${what} failed`, { code: error.code });
  return { ok: false, error: `The ${what} couldn't be saved.` };
}

export async function addDivision(input: string): Promise<Result> {
  await requireFinance();
  const v = name(80).safeParse(input);
  if (!v.success) return { ok: false, error: "Enter a name of up to 80 characters." };
  const supabase = await createClient();
  return done((await supabase.from("divisions").insert({ name: v.data })).error, "division");
}

export async function addCategory(input: string): Promise<Result> {
  await requireFinance();
  const v = name(60).safeParse(input);
  if (!v.success) return { ok: false, error: "Enter a name of up to 60 characters." };
  const supabase = await createClient();
  return done((await supabase.from("categories").insert({ name: v.data })).error, "category");
}

export async function setCategoryActive(id: string, active: boolean): Promise<Result> {
  await requireFinance();
  const supabase = await createClient();
  return done((await supabase.from("categories").update({ active }).eq("id", id)).error, "category");
}

export async function setBudgetActive(id: string, active: boolean): Promise<Result> {
  await requireFinance();
  const supabase = await createClient();
  return done((await supabase.from("budgets").update({ active }).eq("id", id)).error, "budget");
}

const budgetInput = z.object({
  name: name(100),
  kind: z.enum(["event", "general"]),
  divisionId: z.uuid(),
  active: z.boolean(),
  guidelines: z.array(z.object({ categoryId: z.uuid(), amount: z.string() })).min(1).max(100),
});

export type BudgetInput = z.input<typeof budgetInput>;

export async function saveBudget(id: string | null, input: BudgetInput): Promise<Result> {
  await requireFinance();
  const parsed = budgetInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Fill in the name and division, and provision at least one category." };
  const v = parsed.data;
  if (new Set(v.guidelines.map((g) => g.categoryId)).size !== v.guidelines.length) {
    return { ok: false, error: "Each category can be provisioned once per budget." };
  }
  const guidelines: { category_id: string; guideline_cents: number }[] = [];
  for (const g of v.guidelines) {
    const cents = parseBudgetToCents(g.amount);
    if (cents === null) return { ok: false, error: "Enter a valid guideline for every category, e.g. 1500 or 1500.00." };
    guidelines.push({ category_id: g.categoryId, guideline_cents: cents });
  }

  // The budget and its guidelines in one transaction, as Finance (save_budget; RLS decides).
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_budget", {
    p_id: id, p_name: v.name, p_kind: v.kind, p_division: v.divisionId, p_active: v.active, p_guidelines: guidelines,
  });
  return done(error, "budget");
}
