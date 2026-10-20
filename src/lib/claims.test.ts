import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { paidFor, withNames } from "./claims";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const RESERVE = "20000000-0000-4000-8000-0000000000f0";
const OPEN = "20000000-0000-4000-8000-000000000001";
const HIDDEN = "20000000-0000-4000-8000-000000000002";
const CATEGORY = "30000000-0000-4000-8000-000000000001";

// What RLS hands this viewer: the open budget and the category, not the reserve or the hidden budget.
const readable: Record<string, { id: string; name: string }[]> = {
  budgets: [{ id: OPEN, name: "Iftar" }],
  categories: [{ id: CATEGORY, name: "Transport" }],
};

const row = (budget_id: string, division_id: string | null) => ({
  id: crypto.randomUUID(), kind: "reimbursement" as const, status: "paid" as const, claimant_name: "Vol One",
  description: "Taxi", amount_cents: 1500, vendor_name: null, created_at: "2026-02-01T00:00:00Z",
  budget_id, category_id: CATEGORY, division_id,
});

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue({
    from: (table: string) => ({
      select: () => ({
        in: async (_: string, ids: string[]) => ({ data: readable[table].filter((r) => ids.includes(r.id)), error: null }),
      }),
    }),
  } as never);
});

describe("withNames", () => {
  it("names the budgets and categories the viewer can read", async () => {
    const [claim] = await withNames([row(OPEN, "10000000-0000-4000-8000-000000000001")]);
    expect(claim).toMatchObject({ budgetName: "Iftar", categoryName: "Transport" });
  });

  it("calls the reserve Reserve for a claimant who can't read it (Finance imported their reimbursement)", async () => {
    const [claim] = await withNames([row(RESERVE, null)]);
    expect(claim.budgetName).toBe("Reserve");
  });

  it("shows a dash for any other budget the viewer can't read", async () => {
    const [claim] = await withNames([row(HIDDEN, "10000000-0000-4000-8000-000000000002")]);
    expect(claim.budgetName).toBe("—");
  });
});

describe("paidFor", () => {
  it("names a claim by its description, and an invoice by its vendor too", () => {
    expect(paidFor({ kind: "reimbursement", description: "Snacks for volunteers", vendor_name: null })).toBe("Snacks for volunteers");
    expect(paidFor({ kind: "invoice", description: "Venue rental", vendor_name: "The Hall Pte Ltd" })).toBe("Venue rental · The Hall Pte Ltd");
  });
});
