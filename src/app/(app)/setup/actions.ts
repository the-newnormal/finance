"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseBudgetToCents } from "@/lib/money";
import { requireFinance } from "@/lib/session";
import { CATEGORY_GROUP_LABEL, type CategoryGroup } from "@/lib/types";
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

const group = z.enum(Object.keys(CATEGORY_GROUP_LABEL) as [CategoryGroup, ...CategoryGroup[]]);

export async function addCategory(input: string, inGroup: CategoryGroup): Promise<Result> {
  await requireFinance();
  const v = name(60).safeParse(input);
  if (!v.success) return { ok: false, error: "Enter a name of up to 60 characters." };
  const g = group.safeParse(inGroup);
  if (!g.success) return { ok: false, error: "Choose the category's group." };
  const supabase = await createClient();
  return done((await supabase.from("categories").insert({ name: v.data, category_group: g.data })).error, "category");
}

// Moving a category moves what was claimed against it to the new group in reports.
export async function setCategoryGroup(id: string, inGroup: CategoryGroup): Promise<Result> {
  await requireFinance();
  const g = group.safeParse(inGroup);
  if (!g.success) return { ok: false, error: "Choose the category's group." };
  const supabase = await createClient();
  return done((await supabase.from("categories").update({ category_group: g.data }).eq("id", id)).error, "category");
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

// Claim rules (0007): notices the claim form shows. Plain text; a link must be https.
const ruleInput = z.object({
  title: z.string().trim().min(1, "Give the rule a title.").max(100, "Keep the title under 100 characters."),
  body: z.string().trim().min(1, "Write the rule.").max(2000, "Keep the rule under 2,000 characters."),
  appliesTo: z.enum(["all", "reimbursement", "invoice"]),
  linkLabel: z.string().trim().max(60, "Keep the link text under 60 characters."),
  linkUrl: z.string().trim().max(500, "That link is too long."),
  sortOrder: z.number().int().min(0).max(1000),
  active: z.boolean(),
});

export type ClaimRuleInput = z.input<typeof ruleInput>;

function ruleDone(error: { code?: string; message?: string } | null): Result {
  const res = done(error, "rule");
  if (res.ok) revalidatePath("/claims/new");
  return res;
}

// An update or delete that matched no row isn't an error: the rule is gone (another Finance member).
function ruleChanged({ data, error }: { data: unknown[] | null; error: { code?: string; message?: string } | null }): Result {
  if (!error && !data?.length) return { ok: false, error: "That rule wasn't found." };
  return ruleDone(error);
}

export async function saveClaimRule(id: string | null, input: ClaimRuleInput): Promise<Result> {
  await requireFinance();
  if (id !== null && !z.uuid().safeParse(id).success) return { ok: false, error: "That rule wasn't found." };
  const parsed = ruleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (!v.linkLabel !== !v.linkUrl) return { ok: false, error: "Give the link both its text and its address, or neither." };
  if (v.linkUrl && !/^https:\/\/[^\s<>"]+$/.test(v.linkUrl)) return { ok: false, error: "The link must start with https://." };
  const row = {
    title: v.title, body: v.body, applies_to: v.appliesTo, sort_order: v.sortOrder, active: v.active,
    link_label: v.linkLabel || null, link_url: v.linkUrl || null,
  };
  const supabase = await createClient();
  if (id === null) return ruleDone((await supabase.from("claim_rules").insert(row)).error);
  return ruleChanged(await supabase.from("claim_rules").update(row).eq("id", id).select("id"));
}

export async function setClaimRuleActive(id: string, active: boolean): Promise<Result> {
  await requireFinance();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "That rule wasn't found." };
  const supabase = await createClient();
  return ruleChanged(await supabase.from("claim_rules").update({ active }).eq("id", id).select("id"));
}

export async function deleteClaimRule(id: string): Promise<Result> {
  await requireFinance();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "That rule wasn't found." };
  const supabase = await createClient();
  return ruleChanged(await supabase.from("claim_rules").delete().eq("id", id).select("id"));
}
