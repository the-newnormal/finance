import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailClaimant as sendEmail, emailReviewers } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { decideClaim, markPaid } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireMember: vi.fn(async () => ({ id: "me" })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ emailClaimant: vi.fn(), emailReviewers: vi.fn() }));
// after() schedules work for once the response is sent; here, run it straight away, and let a test
// wait for it with settled().
const scheduled = vi.hoisted(() => [] as unknown[]);
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void scheduled.push(fn()) }));
const settled = () => Promise.all(scheduled.splice(0));

const ID = "40000000-0000-4000-8000-000000000001";
const ACCOUNT = "50000000-0000-4000-8000-000000000001";
const outcome = { claimant_id: "00000000-0000-4000-8000-000000000b01", claimant_name: "Vol One", amount_cents: 2500, budget_name: "Iftar" };
const rpc = vi.fn();
// The claim's kind, description and vendor, read to word the email.
const claimRow = vi.fn();
const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: claimRow }) }) }));
const invoice = { data: { kind: "invoice", description: "Venue rental", vendor_name: "The Hall Pte Ltd" }, error: null };
const sent = () => vi.mocked(sendEmail).mock.calls[0][1];

function returns(result: { data?: unknown; error?: unknown }) {
  rpc.mockReturnValue({ single: () => Promise.resolve({ data: null, error: null, ...result }) });
}

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(sendEmail).mockReset();
  vi.mocked(emailReviewers).mockReset();
  claimRow.mockReset();
  claimRow.mockResolvedValue({ data: { kind: "reimbursement", description: "Taxi to the venue", vendor_name: null }, error: null });
  vi.mocked(createClient).mockResolvedValue({ rpc, from } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("decideClaim", () => {
  it("passes the decision to the database", async () => {
    returns({ data: { ...outcome, status: "pending_finance" } });
    expect(await decideClaim(ID, true)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("decide_claim", { p_claim: ID, p_approve: true, p_reason: null });
  });

  it("tells Finance, not the claimant, when a review sends it on to Finance", async () => {
    returns({ data: { ...outcome, status: "pending_finance" } });
    await decideClaim(ID, true);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(emailReviewers).toHaveBeenCalledExactlyOnceWith(ID, "pending_finance", "me");
  });

  it("tells no reviewer once Finance has decided", async () => {
    returns({ data: { ...outcome, status: "approved" } });
    await decideClaim(ID, true);
    returns({ data: { ...outcome, status: "rejected" } });
    await decideClaim(ID, false, "Blurry receipt");
    expect(emailReviewers).not.toHaveBeenCalled();
  });

  it("emails the claimant on final approval", async () => {
    returns({ data: { ...outcome, status: "approved" } });
    await decideClaim(ID, true);
    expect(sendEmail).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000b01", expect.objectContaining({ subject: "Your claim for $25.00 has been approved" }));
    expect(sent().details).toEqual([["For", "Taxi to the venue"], ["Amount", "$25.00"], ["Budget", "Iftar"]]);
  });

  it("tells the submitter of a vendor invoice that Finance pays the vendor", async () => {
    returns({ data: { ...outcome, status: "approved" } });
    claimRow.mockResolvedValue(invoice);
    await decideClaim(ID, true);
    expect(sent().subject).toBe("Your invoice for $25.00 has been approved");
    expect(sent().paragraphs.join(" ")).toContain("Finance has approved the invoice you submitted and will pay The Hall Pte Ltd directly");
    expect(sent().paragraphs.join(" ")).not.toContain("You'll be paid");
    expect(sent().details).toContainEqual(["Vendor", "The Hall Pte Ltd"]);
  });

  it("skips the email, not the decision, if the claim can't be read to word it", async () => {
    returns({ data: { ...outcome, status: "approved" } });
    claimRow.mockResolvedValue({ data: null, error: { code: "XX000" } });
    expect(await decideClaim(ID, true)).toEqual({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails the reason on rejection", async () => {
    returns({ data: { ...outcome, status: "rejected" } });
    await decideClaim(ID, false, " Blurry receipt ");
    await settled();
    expect(sent()).toMatchObject({ subject: "Your claim for $25.00 needs attention", callout: { label: "Reason", text: "Blurry receipt" } });
  });

  it("still emails a rejection's reason if the claim can't be read to word it", async () => {
    returns({ data: { ...outcome, status: "rejected" } });
    claimRow.mockResolvedValue({ data: null, error: { code: "XX000" } });
    await decideClaim(ID, false, "Blurry receipt");
    await settled();
    expect(sent()).toMatchObject({ callout: { text: "Blurry receipt" }, details: [["Amount", "$25.00"], ["Budget", "Iftar"]] });
  });

  it("doesn't keep the reviewer waiting on the read behind a rejection's email", async () => {
    returns({ data: { ...outcome, status: "rejected" } });
    claimRow.mockReturnValue(new Promise(() => {})); // a read that never comes back
    expect(await decideClaim(ID, false, "Blurry receipt")).toEqual({ ok: true });
    scheduled.splice(0);
  });

  it("calls a rejected invoice an invoice", async () => {
    returns({ data: { ...outcome, status: "rejected" } });
    claimRow.mockResolvedValue(invoice);
    await decideClaim(ID, false, "Wrong vendor");
    await settled();
    expect(sent()).toMatchObject({ subject: "Your invoice for $25.00 needs attention", heading: "Your invoice wasn't approved" });
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

  it("refuses a reason over 500 characters (the database keeps 500)", async () => {
    expect(await decideClaim(ID, false, "x".repeat(501))).toEqual({ ok: false, error: "Keep the reason under 500 characters." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a malformed id without calling the database", async () => {
    expect(await decideClaim("nope", true)).toEqual({ ok: false, error: "Claim not found." });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("markPaid", () => {
  it("records the payment and tells the claimant", async () => {
    returns({ data: { ...outcome, status: "paid" } });
    expect(await markPaid(ID, "TXN-1", ACCOUNT)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("mark_paid", { p_claim: ID, p_reference: "TXN-1", p_account: ACCOUNT });
    expect(sendEmail).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000b01", expect.objectContaining({ subject: "You've been paid $25.00" }));
  });

  it("tells the submitter of a vendor invoice that the vendor was paid", async () => {
    returns({ data: { ...outcome, status: "paid" } });
    claimRow.mockResolvedValue(invoice);
    await markPaid(ID, "TXN-1", ACCOUNT);
    expect(sent().subject).toBe("Your invoice for $25.00 has been paid");
    expect(sent().paragraphs.join(" ")).toContain("We've paid The Hall Pte Ltd $25.00");
  });

  it("needs the account it was paid from", async () => {
    expect(await markPaid(ID, "TXN-1", "")).toEqual({ ok: false, error: "Choose the account you paid from." });
    expect(rpc).not.toHaveBeenCalled();
  });
});
