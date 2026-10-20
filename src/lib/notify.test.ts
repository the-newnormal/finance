import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/email";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { emailReviewers } from "./notify";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: vi.fn() }));

const CLAIM = "40000000-0000-4000-8000-000000000001";
const DIVISION = "10000000-0000-4000-8000-000000000001";
const VOL = "00000000-0000-4000-8000-000000000001";
const LEAD = "00000000-0000-4000-8000-000000000002";
const OTHER_LEAD = "00000000-0000-4000-8000-000000000003";
const FIN = "00000000-0000-4000-8000-000000000004";
const FIN2 = "00000000-0000-4000-8000-000000000005";

type Row = Record<string, unknown>;
let db: Record<string, Row[]>;
let failing: Set<string>; // tables whose reads fail

// Just enough of the Supabase query builder: select, eq, in, maybeSingle and await.
function service() {
  return {
    from(table: string) {
      let rows = db[table] ?? [];
      const error = failing.has(table) ? { code: "XX000" } : null;
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] === val)), q),
        in: (col: string, vals: unknown[]) => ((rows = rows.filter((r) => vals.includes(r[col]))), q),
        maybeSingle: () => Promise.resolve(error ? { data: null, error } : { data: rows[0] ?? null, error }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(error ? { data: null, error } : { data: rows, error }).then(resolve),
      };
      return q;
    },
  };
}

const claim = (over: Row = {}) => ({
  id: CLAIM, status: "pending_review", division_id: DIVISION, claimant_id: VOL, claimant_name: "Vol One",
  amount_cents: 2500, kind: "reimbursement", vendor_name: null, budget_id: "b1", ...over,
});
const sentTo = () => vi.mocked(sendEmail).mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(createServiceRoleClient).mockReturnValue(service() as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
  failing = new Set();
  db = {
    claims: [claim()],
    budgets: [{ id: "b1", name: "Iftar" }],
    division_leads: [{ member_id: LEAD, division_id: DIVISION }, { member_id: OTHER_LEAD, division_id: "elsewhere" }],
    members: [
      { id: VOL, email: "vol@x.sg", name: "Vol One", role: "volunteer", active: true },
      { id: LEAD, email: "lead@x.sg", name: "Lee Lead", role: "lead", active: true },
      { id: OTHER_LEAD, email: "other@x.sg", name: "Other Lead", role: "lead", active: true },
      { id: FIN, email: "fin@x.sg", name: "Fin One", role: "finance", active: true },
      { id: FIN2, email: "fin2@x.sg", name: "Fin Two", role: "finance", active: true },
    ],
  };
});

describe("emailReviewers", () => {
  it("emails the leads of the claim's division when it awaits review", async () => {
    await emailReviewers(CLAIM, "pending_review");
    expect(sentTo()).toEqual(["lead@x.sg"]);
    const [, subject, paragraphs, link] = vi.mocked(sendEmail).mock.calls[0];
    expect(subject).toBe("A claim is waiting for your review");
    expect(paragraphs).toEqual(["Hi Lee,", expect.stringContaining("Vol One has submitted a claim of $25.00 for Iftar")]);
    expect(link).toEqual({ href: `/claims/${CLAIM}`, label: "Review claim" });
  });

  it("emails Finance instead when the division has no active lead", async () => {
    db.members.find((m) => m.id === LEAD)!.active = false;
    await emailReviewers(CLAIM, "pending_review");
    expect(sentTo()).toEqual(["fin@x.sg", "fin2@x.sg"]);
  });

  it("emails Finance, except whoever just acted, when it awaits final approval", async () => {
    db.claims = [claim({ status: "pending_finance" })];
    await emailReviewers(CLAIM, "pending_finance", FIN);
    expect(sentTo()).toEqual(["fin2@x.sg"]);
    expect(vi.mocked(sendEmail).mock.calls[0][1]).toBe("A claim is waiting for Finance approval");
  });

  it("never emails the claimant, even when they are Finance", async () => {
    db.claims = [claim({ status: "pending_finance", claimant_id: FIN })];
    await emailReviewers(CLAIM, "pending_finance");
    expect(sentTo()).toEqual(["fin2@x.sg"]);
  });

  it("emails nobody for a stage the claim has already left (whoever moved it emails the next one)", async () => {
    db.claims = [claim({ status: "pending_finance" })];
    await emailReviewers(CLAIM, "pending_review");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still emails, naming no budget, if the budget can't be read, and logs the code", async () => {
    failing.add("budgets");
    await emailReviewers(CLAIM, "pending_review");
    expect(vi.mocked(sendEmail).mock.calls[0][2][1]).toContain("a claim of $25.00 for a budget");
    expect(console.error).toHaveBeenCalledWith("notify reviewers lookup failed", { code: "XX000" });
  });

  it("emails nobody, and logs a code, when the reviewers can't be looked up", async () => {
    failing.add("division_leads");
    await emailReviewers(CLAIM, "pending_review");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("notify reviewers lookup failed", { code: "XX000" });
  });

  it("names the vendor for an invoice", async () => {
    db.claims = [claim({ status: "pending_finance", kind: "invoice", vendor_name: "The Hall Pte Ltd", claimant_id: LEAD })];
    await emailReviewers(CLAIM, "pending_finance");
    const [, subject, paragraphs, link] = vi.mocked(sendEmail).mock.calls[0];
    expect(subject).toBe("An invoice is waiting for Finance approval");
    expect(paragraphs[1]).toContain("an invoice from The Hall Pte Ltd for $25.00 (Iftar)");
    expect(link).toMatchObject({ label: "Review invoice" });
  });

  it("emails nobody once the claim is decided", async () => {
    for (const status of ["approved", "rejected", "paid"]) {
      db.claims = [claim({ status })];
      await emailReviewers(CLAIM, "pending_finance");
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails nobody, and logs a code, when the claim can't be found", async () => {
    db.claims = [];
    await emailReviewers(CLAIM, "pending_review");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("notify reviewers lookup failed", { code: "not_found" });
  });

  it("emails nobody without the service key", async () => {
    vi.mocked(createServiceRoleClient).mockImplementation(() => { throw new Error("missing"); });
    await emailReviewers(CLAIM, "pending_review");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
