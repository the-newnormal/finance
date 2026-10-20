import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptPayout, encryptPayout } from "@/lib/crypto";
import { emailReviewers } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { submitClaim, type ClaimInput } from "./actions";

const ME = "00000000-0000-4000-8000-000000000001";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireMember: vi.fn(async () => ({ id: ME, role: "volunteer" })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ emailReviewers: vi.fn() }));
// after() schedules work for once the response is sent; here, run it straight away.
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

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
  vi.mocked(emailReviewers).mockClear();
  tables = { claims: table({ data: { id: "claim-1", status: "pending_review" }, error: null }), member_payouts: table({ data: null, error: null }) };
  vi.mocked(createClient).mockResolvedValue({ from: (t: string) => tables[t] } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const base: ClaimInput = {
  kind: "reimbursement",
  budgetId: "20000000-0000-4000-8000-000000000001",
  categoryId: "30000000-0000-4000-8000-000000000001",
  description: "Taxi to the venue",
  amount: "25.40",
  expenseDate: "2026-10-01",
  attachmentPaths: [`${ME}/abc/0-r.jpg`],
  payout: { type: "paynow_mobile", name: "Tan Ah Kow", proxy: "9123 4567" },
  submissionId: "60000000-0000-4000-8000-000000000001",
};

describe("submitClaim", () => {
  it("encrypts the payout details for this member and inserts the claim", async () => {
    expect(await submitClaim(base)).toEqual({ ok: true, id: "claim-1", payoutSaved: true });
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
    const enc = encryptPayout({ type: "bank", name: "Tan", bankName: "DBS", accountNumber: "1234567890" }, ME);
    tables.member_payouts = table({ data: { payout_type: "bank", payout_masked: "DBS •••• 7890", payout_enc: enc }, error: null });
    await submitClaim({ ...base, payout: { type: "saved" } });
    expect(tables.claims.insert).toHaveBeenCalledWith(expect.objectContaining({ payout_type: "bank", payout_enc: enc }));
  });

  it("refuses saved details Finance couldn't read, and forgets them", async () => {
    tables.member_payouts = table({ data: { payout_type: "bank", payout_masked: "DBS •••• 1234", payout_enc: "v1.x.y.z" }, error: null });
    expect(await submitClaim({ ...base, payout: { type: "saved" } })).toEqual({
      ok: false, error: "Your saved payout details can no longer be used. Please enter them again.",
    });
    expect(tables.member_payouts.delete).toHaveBeenCalled();
    expect(tables.claims.insert).not.toHaveBeenCalled();
  });

  it("sends the submission id, and a retry returns the claim already made", async () => {
    await submitClaim(base);
    expect(tables.claims.insert).toHaveBeenCalledWith(expect.objectContaining({ submission_id: base.submissionId }));
    tables.claims = table({ data: { id: "claim-1" }, error: { code: "23505", message: "duplicate" } });
    expect(await submitClaim(base)).toEqual({ ok: true, id: "claim-1", payoutSaved: true });
  });

  it("tells the claim's reviewers it's waiting, once: not again on a retry", async () => {
    await submitClaim(base);
    expect(emailReviewers).toHaveBeenCalledExactlyOnceWith("claim-1", "pending_review");
    tables.claims = table({ data: { id: "claim-1" }, error: { code: "23505", message: "duplicate" } });
    await submitClaim(base);
    expect(emailReviewers).toHaveBeenCalledTimes(1);
  });

  it("tells nobody about a claim the database refused", async () => {
    tables.claims = table({ data: null, error: { code: "P0001", message: "That budget is not open for claims." } });
    await submitClaim(base);
    expect(emailReviewers).not.toHaveBeenCalled();
  });

  it("on a retry, saves the payout details again and reports that attempt", async () => {
    tables.claims = table({ data: { id: "claim-1" }, error: { code: "23505", message: "duplicate" } });
    tables.member_payouts = table({ data: null, error: { code: "XX000" } });
    expect(await submitClaim({ ...base, savePayout: true })).toEqual({ ok: true, id: "claim-1", payoutSaved: false });
  });

  it("keeps saved details when the server's key is missing (a config fault, not bad data)", async () => {
    vi.stubEnv("PAYOUT_ENCRYPTION_KEY", "");
    tables.member_payouts = table({ data: { payout_type: "bank", payout_masked: "DBS •••• 1234", payout_enc: "v1.x.y.z" }, error: null });
    await expect(submitClaim({ ...base, payout: { type: "saved" } })).rejects.toThrow(/PAYOUT_ENCRYPTION_KEY/);
    expect(tables.member_payouts.delete).not.toHaveBeenCalled();
  });

  it("says when the details couldn't be remembered, though the claim went in", async () => {
    tables.member_payouts = table({ data: null, error: { code: "XX000" } });
    expect(await submitClaim({ ...base, savePayout: true })).toEqual({ ok: true, id: "claim-1", payoutSaved: false });
  });

  it("refuses a future purchase date", async () => {
    expect(await submitClaim({ ...base, expenseDate: "2999-01-01" })).toEqual({ ok: false, error: "The purchase date can't be in the future." });
    expect(tables.claims.insert).not.toHaveBeenCalled();
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

describe("submitClaim limits", () => {
  it("explains the maximum amount", async () => {
    expect(await submitClaim({ ...base, amount: "1000000.01" })).toEqual({ ok: false, error: "A single claim can be at most $1,000,000." });
  });
});
