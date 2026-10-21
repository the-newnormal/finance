import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { addAccount, editEntry, recordEntry, transfer } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireFinance: vi.fn(async () => ({ id: "fin" })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const A = "50000000-0000-4000-8000-000000000001";
const B = "50000000-0000-4000-8000-000000000002";
const rpc = vi.fn();

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const base = { accountId: A, direction: "in" as const, amount: "1,250.50", date: "2026-10-19", note: "NAC grant" };

describe("recordEntry", () => {
  it("records a grant as money in", async () => {
    expect(await recordEntry({ ...base, kind: "grant", direction: "out" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("record_bank_entry", {
      p_account: A, p_kind: "grant", p_amount_cents: 125050, p_date: "2026-10-19", p_note: "NAC grant",
      p_expected_balance_cents: null,
    });
  });

  it("signs an adjustment by its direction", async () => {
    await recordEntry({ ...base, kind: "adjustment", direction: "out", amount: "3.50", note: "DBS fee" });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_kind: "adjustment", p_amount_cents: -350 });
  });

  it("passes the balance a DBS correction was computed from", async () => {
    await recordEntry({ ...base, kind: "adjustment", direction: "in", amount: "1", note: "Match DBS balance", expectedBalanceCents: 99_900 });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_amount_cents: 100, p_expected_balance_cents: 99_900 });
  });

  it("needs a note", async () => {
    expect(await recordEntry({ ...base, kind: "grant", note: " " })).toEqual({ ok: false, error: "Add a note saying what this is" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a bad amount", async () => {
    expect((await recordEntry({ ...base, kind: "grant", amount: "-5" })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's own refusal", async () => {
    rpc.mockResolvedValue({ error: { code: "P0001", message: "That bank account is closed." } });
    expect(await recordEntry({ ...base, kind: "grant" })).toEqual({ ok: false, error: "That bank account is closed." });
  });
});

describe("transfer", () => {
  it("sends a positive amount; the database writes both sides", async () => {
    await transfer({ from: A, to: B, amount: "100", date: "2026-10-19", note: "" });
    expect(rpc).toHaveBeenCalledWith("transfer_between_accounts", {
      p_from: A, p_to: B, p_amount_cents: 10000, p_date: "2026-10-19", p_note: null,
    });
  });
});

describe("addAccount", () => {
  it("accepts a zero opening balance", async () => {
    expect(await addAccount({ name: "DBS Joint A", bank: "DBS", last4: "1234", opening: "0", asOf: "2026-10-01" })).toEqual({ ok: true });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_opening_cents: 0, p_last4: "1234" });
  });

  it("refuses more than the last four digits", async () => {
    const res = await addAccount({ name: "DBS Joint A", bank: "DBS", last4: "0123456789", opening: "10", asOf: "2026-10-01" });
    expect(res).toEqual({ ok: false, error: "Enter the account number's last four digits" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("editEntry", () => {
  const was = { account_id: A, amount_cents: -2500, entry_date: "2026-02-10", note: "Vol · TXN-1" };
  const edit = { entryId: 7, amount: "30.00", date: "2026-02-12", reason: "typo in the amount", was };

  it("signs the amount by the entry's kind", async () => {
    for (const [kind, sign] of [["grant", 1], ["transfer_in", 1], ["payout", -1], ["transfer_out", -1]] as const) {
      rpc.mockClear();
      await editEntry({ ...edit, kind, note: "NAC grant" });
      expect(rpc.mock.calls[0][1]).toMatchObject({ p_amount_cents: sign * 3000 });
    }
    rpc.mockClear();
    await editEntry({ ...edit, kind: "adjustment", direction: "out", note: "DBS fee" });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_amount_cents: -3000 });
  });

  it("corrects a payout's reference, not its note, and refreshes its claim", async () => {
    rpc.mockResolvedValue({ data: "c1", error: null });
    expect(await editEntry({ ...edit, kind: "payout", accountId: B, note: "ignored", reference: "TXN-2" })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("edit_bank_entry", {
      p_entry: 7, p_account: B, p_amount_cents: -3000, p_date: "2026-02-12", p_note: null, p_reference: "TXN-2",
      p_reason: "typo in the amount", p_was: was,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/claims/c1");
    expect(revalidatePath).toHaveBeenCalledWith("/budgets", "layout");
  });

  it("accepts a zero opening balance, and nothing else at zero", async () => {
    expect(await editEntry({ ...edit, kind: "opening", amount: "0" })).toEqual({ ok: true });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_amount_cents: 0, p_note: null });
    expect((await editEntry({ ...edit, kind: "grant", amount: "0", note: "NAC grant" })).ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("needs a reason", async () => {
    expect(await editEntry({ ...edit, kind: "grant", note: "NAC grant", reason: " " })).toEqual({ ok: false, error: "Say why you're changing it" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's own refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Nothing has changed." } });
    expect(await editEntry({ ...edit, kind: "grant", note: "NAC grant" })).toEqual({ ok: false, error: "Nothing has changed." });
  });
});
