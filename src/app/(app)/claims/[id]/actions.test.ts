import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import { decideClaim, markPaid } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireMember: vi.fn(async () => ({ id: "me" })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

const ID = "40000000-0000-4000-8000-000000000001";
const outcome = { claimant_email: "v@test.local", claimant_name: "Vol One", amount_cents: 2500, pool_name: "Iftar" };
const rpc = vi.fn();

function returns(result: { data?: unknown; error?: unknown }) {
  rpc.mockReturnValue({ single: () => Promise.resolve({ data: null, error: null, ...result }) });
}

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(sendEmail).mockReset();
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("decideClaim", () => {
  it("passes the decision to the database", async () => {
    returns({ data: { ...outcome, status: "pending_finance" } });
    expect(await decideClaim(ID, true)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("decide_claim", { p_claim: ID, p_approve: true, p_reason: null });
  });

  it("emails nobody when a review only sends it on to Finance", async () => {
    returns({ data: { ...outcome, status: "pending_finance" } });
    await decideClaim(ID, true);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails the claimant on final approval", async () => {
    returns({ data: { ...outcome, status: "approved" } });
    await decideClaim(ID, true);
    expect(sendEmail).toHaveBeenCalledWith("v@test.local", "Your claim for $25.00 has been approved", expect.any(Array), expect.any(Object));
  });

  it("emails the reason on rejection", async () => {
    returns({ data: { ...outcome, status: "rejected" } });
    await decideClaim(ID, false, " Blurry receipt ");
    expect(vi.mocked(sendEmail).mock.calls[0][2]).toContain("Reason: Blurry receipt");
  });

  it("shows the database's refusal", async () => {
    returns({ error: { code: "42501", message: "You can't decide this claim." } });
    expect(await decideClaim(ID, true)).toEqual({ ok: false, error: "You can't decide this claim." });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("hides unexpected errors", async () => {
    returns({ error: { code: "XX000", message: "internal" } });
    expect(await decideClaim(ID, true)).toEqual({ ok: false, error: "Something went wrong. Try again." });
  });

  it("refuses a malformed id without calling the database", async () => {
    expect(await decideClaim("nope", true)).toEqual({ ok: false, error: "Claim not found." });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("markPaid", () => {
  it("records the payment and tells the claimant", async () => {
    returns({ data: { ...outcome, status: "paid" } });
    expect(await markPaid(ID, "TXN-1")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("mark_paid", { p_claim: ID, p_reference: "TXN-1" });
    expect(sendEmail).toHaveBeenCalledWith("v@test.local", "You've been paid $25.00", expect.any(Array));
  });
});
