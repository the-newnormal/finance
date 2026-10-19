"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseBudgetToCents } from "@/lib/money";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "../people/actions";

// Everything here writes as the signed-in admin: RLS (private.is_admin()) decides.

const name = (max: number) => z.string().trim().min(1).max(max);

function done(error: { code?: string; message?: string } | null, what: string): Result {
  if (!error) {
    revalidatePath("/admin/setup");
    return { ok: true };
  }
  if (error.code === "23505") return { ok: false, error: `That ${what} already exists.` };
  if (error.code === "P0001" && "message" in error) return { ok: false, error: String(error.message) };
  console.error(`setup ${what} failed`, { code: error.code });
  return { ok: false, error: `The ${what} couldn't be saved.` };
}

export async function addDivision(input: string): Promise<Result> {
  await requireAdmin();
  const v = name(80).safeParse(input);
  if (!v.success) return { ok: false, error: "Enter a name." };
  const supabase = await createClient();
  return done((await supabase.from("divisions").insert({ name: v.data })).error, "division");
}

export async function addCategory(input: string): Promise<Result> {
  await requireAdmin();
  const v = name(60).safeParse(input);
  if (!v.success) return { ok: false, error: "Enter a name." };
  const supabase = await createClient();
  return done((await supabase.from("categories").insert({ name: v.data })).error, "category");
}

export async function setCategoryActive(id: string, active: boolean): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  return done((await supabase.from("categories").update({ active }).eq("id", id)).error, "category");
}

export async function setPoolActive(id: string, active: boolean): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  return done((await supabase.from("pools").update({ active }).eq("id", id)).error, "budget");
}

const poolInput = z.object({
  name: name(100),
  kind: z.enum(["event", "general"]),
  divisionId: z.uuid(),
  allocated: z.string(),
});

export async function savePool(id: string | null, input: z.input<typeof poolInput>): Promise<Result> {
  await requireAdmin();
  const parsed = poolInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Fill in the name, division and budget." };
  const v = parsed.data;
  const allocated_cents = parseBudgetToCents(v.allocated);
  if (allocated_cents === null) return { ok: false, error: "Enter a valid budget, e.g. 1500 or 1500.00." };

  // The budget and its amount in one transaction, as the admin (admin_save_pool; RLS decides).
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_pool", {
    p_id: id, p_name: v.name, p_kind: v.kind, p_division: v.divisionId, p_allocated_cents: allocated_cents,
  });
  return done(error, "budget");
}
