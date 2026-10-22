import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assignGrant, loanFromReserve, recordGrant, repayReserve, setGrantCommitment } from "./funding-actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireFinance: vi.fn(async () => ({ id: "me", role: "finance" })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const rpc = vi.fn();
const budget = "11111111-1111-4111-8111-111111111111";
const account = "22222222-2222-4222-8222-222222222222";
const ok = { budget, amount: "1,200.50", date: "2026-10-20", note: "First tranche" };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 1, error: null });
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  vi.mocked(revalidatePath).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recordGrant", () => {
  it("records the grant on the account and budget, in cents", async () => {
    expect(await recordGrant({ ...ok, account })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("record_grant",
      { p_budget: budget, p_account: account, p_amount_cents: 120050, p_date: "2026-10-20", p_note: "First tranche" });
    expect(revalidatePath).toHaveBeenCalledWith(`/budgets/${budget}`);
    expect(revalidatePath).toHaveBeenCalledWith("/bank");
  });

  it("needs an account", async () => {
    expect(await recordGrant({ ...ok, account: "" })).toEqual({ ok: false, error: "Choose the bank account it arrived in" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("loanFromReserve and repayReserve", () => {
  it("call their functions", async () => {
    await loanFromReserve(ok);
    expect(rpc).toHaveBeenCalledWith("loan_from_reserve", { p_budget: budget, p_amount_cents: 120050, p_date: "2026-10-20", p_note: "First tranche" });
    await repayReserve({ ...ok, amount: "5" });
    expect(rpc).toHaveBeenCalledWith("repay_reserve", expect.objectContaining({ p_amount_cents: 500 }));
  });

  it.each([["abc"], ["0"], ["-5"]])("refuses the amount %j", async (amount) => {
    expect(await loanFromReserve({ ...ok, amount })).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("needs a note", async () => {
    expect(await repayReserve({ ...ok, note: " x " })).toEqual({ ok: false, error: "Add a note saying what this is" });
  });

  it("shows the database's message, and hides others", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "P0001", message: "The reserve has only $10.00 available to lend." } });
    expect(await loanFromReserve(ok)).toEqual({ ok: false, error: "The reserve has only $10.00 available to lend." });
    rpc.mockResolvedValueOnce({ error: { code: "XX000", message: "detail" } });
    expect(await loanFromReserve(ok)).toEqual({ ok: false, error: "That couldn't be saved. Try again." });
    expect(console.error).toHaveBeenCalledWith("reserve loan failed", { code: "XX000" });
  });
});

describe("setGrantCommitment", () => {
  it("allows zero", async () => {
    expect(await setGrantCommitment({ budget, amount: "0" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_grant_commitment", { p_budget: budget, p_cents: 0 });
  });

  it("refuses nonsense", async () => {
    expect(await setGrantCommitment({ budget, amount: "lots" })).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("assignGrant", () => {
  it("assigns a bank-page grant to the budget", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    expect(await assignGrant({ budget: budget, entry: "12", note: "First tranche" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("assign_grant", { p_bank_entry: 12, p_budget: budget, p_note: "First tranche" });
  });

  it("needs a grant and a note", async () => {
    expect(await assignGrant({ budget: budget, entry: "", note: "First tranche" })).toMatchObject({ ok: false });
    expect(await assignGrant({ budget: budget, entry: "12", note: "x" })).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});
