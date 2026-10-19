"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmountToCents } from "@/lib/money";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "../people/actions";

// Everything here writes as the signed-in admin: RLS (private.is_admin()) decides.

const name = (max: number) => z.string().trim().min(1).max(max);

function done(error: { code?: string } | null, what: string): Result {
  if (!error) {
    revalidatePath("/admin/setup");
    return { ok: true };
  }
  if (error.code === "23505") return { ok: false, error: `That ${what} already exists.` };
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
  const allocated_cents = v.allocated.trim() === "0" ? 0 : parseAmountToCents(v.allocated);
  if (allocated_cents === null) return { ok: false, error: "Enter a valid budget, e.g. 1500 or 1500.00." };

  const supabase = await createClient();
  const pool = { name: v.name, kind: v.kind, division_id: v.divisionId };
  let poolId = id;
  if (poolId) {
    const { error } = await supabase.from("pools").update(pool).eq("id", poolId);
    if (error) return done(error, "budget");
  } else {
    const { data, error } = await supabase.from("pools").insert(pool).select("id").single();
    if (error) return done(error, "budget");
    poolId = data.id as string;
  }
  const { error } = await supabase.from("pool_budgets").upsert({ pool_id: poolId, allocated_cents });
  return done(error, "budget");
}
