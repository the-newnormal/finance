import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { deleteClaimRule, saveBudget, saveClaimRule, setClaimRuleActive } from "./actions";

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

describe("claim rules", () => {
  const RULE = "90000000-0000-4000-8000-000000000001";
  const rule = {
    title: " What your receipt must show ", body: "Attach a receipt.", appliesTo: "reimbursement" as const,
    linkLabel: "", linkUrl: "", sortOrder: 10, active: true,
  };
  // claim_rules: insert(row), update(row).eq(id).select(), delete().eq(id), update(patch).eq(id).
  let result: { data?: unknown; error: unknown };
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  beforeEach(() => {
    result = { data: [{ id: RULE }], error: null };
    for (const m of ["insert", "update", "delete", "eq", "select"]) {
      q[m] = vi.fn(() => Object.assign(Promise.resolve(result), q));
    }
    vi.mocked(createClient).mockResolvedValue({ from: () => q } as never);
  });

  it("adds a rule, trimmed, with no link", async () => {
    expect(await saveClaimRule(null, rule)).toEqual({ ok: true });
    expect(q.insert).toHaveBeenCalledWith({
      title: "What your receipt must show", body: "Attach a receipt.", applies_to: "reimbursement", sort_order: 10,
      active: true, link_label: null, link_url: null,
    });
  });

  it("edits a rule by id, and says when it's gone", async () => {
    expect(await saveClaimRule(RULE, rule)).toEqual({ ok: true });
    expect(q.eq).toHaveBeenCalledWith("id", RULE);
    result = { data: [], error: null };
    expect(await saveClaimRule(RULE, rule)).toEqual({ ok: false, error: "That rule wasn't found." });
  });

  it("needs the link's text and address together, and https", async () => {
    expect(await saveClaimRule(null, { ...rule, linkLabel: "Policy" }))
      .toEqual({ ok: false, error: "Give the link both its text and its address, or neither." });
    expect(await saveClaimRule(null, { ...rule, linkLabel: "Policy", linkUrl: "javascript:alert(1)" }))
      .toEqual({ ok: false, error: "The link must start with https://." });
    expect(await saveClaimRule(null, { ...rule, linkLabel: "Policy", linkUrl: "http://example.org" }))
      .toEqual({ ok: false, error: "The link must start with https://." });
    expect(q.insert).not.toHaveBeenCalled();
    expect(await saveClaimRule(null, { ...rule, linkLabel: "Policy", linkUrl: "https://example.org/pdpa" })).toEqual({ ok: true });
    expect(q.insert.mock.calls[0][0]).toMatchObject({ link_label: "Policy", link_url: "https://example.org/pdpa" });
  });

  it("refuses an empty title or text", async () => {
    expect((await saveClaimRule(null, { ...rule, title: "  " })).ok).toBe(false);
    expect((await saveClaimRule(null, { ...rule, body: "" })).ok).toBe(false);
    expect(q.insert).not.toHaveBeenCalled();
  });

  it("hides, shows and deletes a rule by id, and refuses a malformed id", async () => {
    expect(await setClaimRuleActive(RULE, false)).toEqual({ ok: true });
    expect(q.update).toHaveBeenCalledWith({ active: false });
    expect(await deleteClaimRule(RULE)).toEqual({ ok: true });
    expect(q.delete).toHaveBeenCalled();
    expect(await deleteClaimRule("nope")).toEqual({ ok: false, error: "That rule wasn't found." });
  });
});
