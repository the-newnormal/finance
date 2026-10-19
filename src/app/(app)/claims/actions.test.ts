import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptPayout } from "@/lib/crypto";
import { createClient } from "@/lib/supabase/server";
import { submitClaim, type ClaimInput } from "./actions";

const ME = "00000000-0000-4000-8000-000000000001";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireMember: vi.fn(async () => ({ id: ME, role: "volunteer", finance: false })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

function table(result: { data?: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "insert", "upsert", "delete", "eq"]) q[m] = vi.fn(() => q);
  q.single = vi.fn(() => Promise.resolve(result));
  q.maybeSingle = vi.fn(() => Promise.resolve(result));
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return q;
}
let tables: Record<string, ReturnType<typeof table>>;

beforeEach(() => {
  vi.stubEnv("PAYOUT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  tables = { claims: table({ data: { id: "claim-1" }, error: null }), member_payouts: table({ data: null, error: null }) };
  vi.mocked(createClient).mockResolvedValue({ from: (t: string) => tables[t] } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const base: ClaimInput = {
  kind: "reimbursement",
  poolId: "20000000-0000-4000-8000-000000000001",
  categoryId: "30000000-0000-4000-8000-000000000001",
  description: "Taxi to the venue",
  amount: "25.40",
  expenseDate: "2026-10-01",
  attachmentPaths: [`${ME}/abc/0-r.jpg`],
  payout: { type: "paynow_mobile", name: "Tan Ah Kow", proxy: "9123 4567" },
};

describe("submitClaim", () => {
  it("encrypts the payout details for this member and inserts the claim", async () => {
    expect(await submitClaim(base)).toEqual({ ok: true, id: "claim-1" });
    const row = (tables.claims.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ amount_cents: 2540, payout_type: "paynow_mobile", payout_masked: "Mobile •••• 4567", vendor_name: null });
    expect(decryptPayout(row.payout_enc as string, ME)).toEqual({ type: "paynow_mobile", name: "Tan Ah Kow", proxy: "+6591234567" });
    expect(row).not.toHaveProperty("status");
    expect(row).not.toHaveProperty("claimant_id");
  });

  it("refuses a non-Singapore PayNow number before inserting", async () => {
    const res = await submitClaim({ ...base, payout: { type: "paynow_mobile", name: "Tan", proxy: "+1 415 555 0100" } });
    expect(res).toEqual({ ok: false, error: "Enter a Singapore mobile number registered with PayNow." });
    expect(tables.claims.insert).not.toHaveBeenCalled();
  });

  it("reuses the saved payout details as stored", async () => {
    tables.member_payouts = table({ data: { payout_type: "bank", payout_masked: "DBS •••• 1234", payout_enc: "v1.x.y.z" }, error: null });
    await submitClaim({ ...base, payout: { type: "saved" } });
    expect(tables.claims.insert).toHaveBeenCalledWith(expect.objectContaining({ payout_type: "bank", payout_enc: "v1.x.y.z" }));
  });

  it("saves the details for next time when asked", async () => {
    await submitClaim({ ...base, savePayout: true });
    expect(tables.member_payouts.upsert).toHaveBeenCalledWith(expect.objectContaining({ member_id: ME, payout_type: "paynow_mobile" }));
  });

  it("shows the database's own refusal", async () => {
    tables.claims = table({ data: null, error: { code: "P0001", message: "That budget is not open for claims." } });
    expect(await submitClaim(base)).toEqual({ ok: false, error: "That budget is not open for claims." });
  });

  it("hides unexpected database errors", async () => {
    tables.claims = table({ data: null, error: { code: "XX000", message: "internal detail" } });
    expect(await submitClaim(base)).toEqual({ ok: false, error: "The claim couldn't be submitted. Try again." });
  });

  it.each(["0", "12.345", "abc"])("refuses the amount %j", async (amount) => {
    expect((await submitClaim({ ...base, amount })).ok).toBe(false);
  });
});
