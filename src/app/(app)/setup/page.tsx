import { PageHeader } from "@/components/page-header";
import { fetchAll } from "@/lib/fetch-all";
import { requireFinance } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Budget, Category, Division } from "@/lib/types";
import { SetupManager, type BudgetRow } from "./setup-manager";

export const metadata = { title: "Setup" };

export default async function SetupPage() {
  await requireFinance();
  const supabase = await createClient();
  // Every row: an edit form missing a guideline would save over (or drop) the real one.
  const [divisions, categories, budgets, guidelines] = await Promise.all([
    fetchAll<Division>((f, t) => supabase.from("divisions").select("id, name").order("id").range(f, t)),
    fetchAll<Category>((f, t) => supabase.from("categories").select("id, name, active, category_group").order("id").range(f, t)),
    fetchAll<Budget>((f, t) => supabase.from("budgets").select("id, name, kind, division_id, active, is_reserve").eq("is_reserve", false).order("id").range(f, t)),
    fetchAll<{ budget_id: string; category_id: string; guideline_cents: number }>((f, t) =>
      supabase.from("budget_guidelines").select("budget_id, category_id, guideline_cents").order("budget_id").order("category_id").range(f, t)),
  ]);
  const byName = <T extends { name: string }>(rows: T[]) => rows.sort((x, y) => x.name.localeCompare(y.name));
  const rows: BudgetRow[] = byName(budgets).map((b) => ({
    ...b,
    guidelines: guidelines
      .filter((g) => g.budget_id === b.id)
      .map((g) => ({ category_id: g.category_id, guideline_cents: Number(g.guideline_cents) })),
  }));

  return (
    <>
      <PageHeader title="Setup" description="Divisions, claim categories and their groups, and the budgets and events inside each division." />
      <SetupManager divisions={byName(divisions)} categories={byName(categories)} budgets={rows} />
    </>
  );
}
