import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/session", () => ({ getMe: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const DIV = "10000000-0000-4000-8000-000000000001";
const BUDGET = "20000000-0000-4000-8000-000000000001";
const claim = (id: string, created_at: string) => ({
  id, created_at, kind: "reimbursement", status: "paid", claimant_name: "Vol One", budget_id: BUDGET, category_id: "c1",
  expense_date: null, vendor_name: null, due_date: null, description: "Taxi", amount_cents: 1500, payout_type: "bank",
  payment_reference: "REF",
});

let rows: Record<string, unknown[]>;
let calls: Record<string, [string, ...unknown[]][]>;

// Records each table's filters; every query resolves to that table's rows.
function client() {
  return {
    from(table: string) {
      calls[table] = [];
      const q: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows[table], error: null }).then(resolve),
      };
      for (const m of ["select", "eq", "gte", "lt", "order", "range"]) {
        q[m] = (...args: unknown[]) => (calls[table].push([m, ...args]), q);
      }
      return q;
    },
  };
}

const get = (query = "") => GET(new NextRequest(`https://finance.test/api/export${query}`));
const filters = (table: string) => calls[table].filter(([m]) => m === "eq" || m === "gte" || m === "lt");

beforeEach(() => {
  vi.mocked(getMe).mockResolvedValue({ user: true, member: { id: "fin", role: "finance" } } as never);
  vi.mocked(createClient).mockResolvedValue(client() as never);
  rows = {
    claims: [claim("a", "2026-01-05T02:00:00Z"), claim("b", "2026-02-05T02:00:00Z")],
    budgets: [{ id: BUDGET, name: "Iftar" }],
    categories: [{ id: "c1", name: "Transport & Logistics", category_group: "operations" }],
    // Paid on 31 Jan and 1 Mar in Singapore.
    claim_events: [{ claim_id: "a", at: "2026-01-31T03:00:00Z" }, { claim_id: "b", at: "2026-02-28T17:00:00Z" }],
  };
  calls = {};
});

describe("GET /api/export", () => {
  it("is for Finance only", async () => {
    vi.mocked(getMe).mockResolvedValue({ user: true, member: { id: "v", role: "volunteer" } } as never);
    expect((await get()).status).toBe(403);
  });

  it("exports every claim when nothing is chosen", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(filters("claims")).toEqual([]);
    expect((await res.text()).split("\r\n")).toHaveLength(3); // header and two claims
  });

  it("gives each claim its category's group, then its category", async () => {
    const [header, first] = (await (await get()).text()).split("\r\n");
    expect(header).toContain('"budget","category_group","category","purchase_date"');
    expect(first).toContain('"Iftar","Operations & Admin","Transport & Logistics"');
  });

  it("gives a row per item bought, each with its share of the claim under its own category, and a claim without items whole", async () => {
    rows.categories.push({ id: "c2", name: "F&B – Participants", category_group: "programme" });
    rows.claims = [
      { ...claim("a", "2026-01-05T02:00:00Z"), amount_cents: 2180, items: [
        { description: "Water", amount_cents: 1200, category_id: "c2" },
        { description: "Taxi", amount_cents: 800, category_id: null },
      ] },
      claim("b", "2026-02-05T02:00:00Z"),
    ];
    const res = await get("?rows=items");
    expect(res.headers.get("Content-Disposition")).toContain("nn-items-");
    const [header, ...lines] = (await res.text()).split("\r\n");
    expect(header).toBe('"claim_id","submitted","kind","status","claimant","budget","paid_on","item","item_amount_sgd","category_group","category","spend_sgd"');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"(not itemised)","","Operations & Admin","Transport & Logistics","15.00"');
    expect(lines[1]).toContain('"Water","12.00","Programme","F&B – Participants","13.08"');
    expect(lines[2]).toContain('"Taxi","8.00","Operations & Admin","Transport & Logistics","8.72"');
  });

  it("refuses a malformed filter instead of exporting the wrong claims", async () => {
    const res = await get("?from=2026-04-01&to=2026-03-01");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("The start date is after the end date.");
  });

  it("filters by division, budget, status and Singapore submitted dates in the query", async () => {
    await get(`?from=2026-01-01&to=2026-01-31&division=${DIV}&budget=${BUDGET}&status=paid`);
    expect(filters("claims")).toEqual([
      ["eq", "division_id", DIV], ["eq", "budget_id", BUDGET], ["eq", "status", "paid"],
      ["gte", "created_at", "2026-01-01T00:00:00+08:00"], ["lt", "created_at", "2026-02-01T00:00:00+08:00"],
    ]);
  });

  it("filters by the Singapore date each claim was paid", async () => {
    const res = await get("?dates=paid&from=2026-03-01&to=2026-03-31");
    expect(filters("claims")).toEqual([]);
    const csv = await res.text();
    expect(csv.split("\r\n")).toHaveLength(2); // header and claim b
    expect(csv).toContain('"b"');
    expect(csv).not.toContain('"a"');
    expect(csv).toContain('"2026-03-01"');
  });
});
