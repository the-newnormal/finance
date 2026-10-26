import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { addCategory, saveBudget, setCategoryActive, setCategoryGroup } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireFinance: vi.fn(async () => ({ id: "fin" })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const DIV = "60000000-0000-4000-8000-000000000001";
const VENUE = "70000000-0000-4000-8000-000000000001";
const FOOD = "70000000-0000-4000-8000-000000000002";
const BUDGET = "80000000-0000-4000-8000-000000000001";
const rpc = vi.fn();

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: BUDGET, error: null });
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const base = {
  name: " Community Iftar 2026 ", kind: "event" as const, divisionId: DIV, active: true,
  guidelines: [{ categoryId: VENUE, amount: "1,500" }, { categoryId: FOOD, amount: "250.50" }],
};

describe("saveBudget", () => {
  it("saves the budget and its guidelines in one call", async () => {
    expect(await saveBudget(null, base)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("save_budget", {
      p_id: null, p_name: "Community Iftar 2026", p_kind: "event", p_division: DIV, p_active: true,
      p_guidelines: [{ category_id: VENUE, guideline_cents: 150000 }, { category_id: FOOD, guideline_cents: 25050 }],
    });
  });

  it("passes the id when editing, and a closed budget", async () => {
    await saveBudget(BUDGET, { ...base, active: false });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_id: BUDGET, p_active: false });
  });

  it("allows a zero guideline", async () => {
    await saveBudget(null, { ...base, guidelines: [{ categoryId: VENUE, amount: "0" }] });
    expect(rpc.mock.calls[0][1].p_guidelines).toEqual([{ category_id: VENUE, guideline_cents: 0 }]);
  });

  it("needs at least one category", async () => {
    expect((await saveBudget(null, { ...base, guidelines: [] })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a category provisioned twice", async () => {
    const res = await saveBudget(null, { ...base, guidelines: [{ categoryId: VENUE, amount: "1" }, { categoryId: VENUE, amount: "2" }] });
    expect(res).toEqual({ ok: false, error: "Each category can be provisioned once per budget." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a bad guideline amount", async () => {
    expect((await saveBudget(null, { ...base, guidelines: [{ categoryId: VENUE, amount: "abc" }] })).ok).toBe(false);
    expect((await saveBudget(null, { ...base, guidelines: [{ categoryId: VENUE, amount: "-5" }] })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a missing name or division", async () => {
    expect((await saveBudget(null, { ...base, name: "  " })).ok).toBe(false);
    expect((await saveBudget(null, { ...base, divisionId: "nope" })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's own refusal", async () => {
    const message = "This budget already has claims, so it can't move to another division. Close it and create a new one there.";
    rpc.mockResolvedValue({ error: { code: "P0001", message } });
    expect(await saveBudget(BUDGET, base)).toEqual({ ok: false, error: message });
  });

  it("hides other errors behind a generic message and logs the code only", async () => {
    rpc.mockResolvedValue({ error: { code: "42501", message: "permission denied for table budgets" } });
    expect(await saveBudget(null, base)).toEqual({ ok: false, error: "The budget couldn't be saved." });
    expect(console.error).toHaveBeenCalledWith("setup budget failed", { code: "42501" });
  });
});

describe("categories", () => {
  const CATEGORY = "70000000-0000-4000-8000-000000000003";
  let error: { code: string; message: string } | null;
  const insert = vi.fn(async () => ({ error }));
  const eq = vi.fn(async () => ({ error }));
  const update = vi.fn(() => ({ eq }));

  beforeEach(() => {
    error = null;
    vi.clearAllMocks();
    vi.mocked(createClient).mockResolvedValue({ from: () => ({ insert, update }) } as never);
  });

  it("adds a category in its group", async () => {
    expect(await addCategory(" Prizes & Gifts ", "programme")).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith({ name: "Prizes & Gifts", category_group: "programme" });
  });

  it("refuses a category without a group, or with one that isn't a group", async () => {
    expect(await addCategory("Prizes & Gifts", "" as never)).toEqual({ ok: false, error: "Choose the category's group." });
    expect(await setCategoryGroup(CATEGORY, "food" as never)).toEqual({ ok: false, error: "Choose the category's group." });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("moves a category to another group", async () => {
    expect(await setCategoryGroup(CATEGORY, "people")).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ category_group: "people" });
    expect(eq).toHaveBeenCalledWith("id", CATEGORY);
  });

  it("says why a category not grouped yet can't be hidden", async () => {
    error = { code: "P0001", message: "Choose a group for the category first, so reports count its spending." };
    expect(await setCategoryActive(CATEGORY, false))
      .toEqual({ ok: false, error: "Choose a group for the category first, so reports count its spending." });
  });
});
