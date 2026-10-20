import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { addToReserve } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireFinance: vi.fn(async () => ({ id: "me", role: "finance" })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const rpc = vi.fn();
const ok = { amount: "500", direction: "in" as const, date: "2026-10-20", note: "Grant from the council" };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 1, error: null });
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("addToReserve", () => {
  it("records an addition in cents", async () => {
    expect(await addToReserve(ok)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("add_to_reserve", { p_amount_cents: 50000, p_date: "2026-10-20", p_note: "Grant from the council" });
  });

  it("records money out as a negative addition", async () => {
    await addToReserve({ ...ok, direction: "out", amount: "12.50" });
    expect(rpc).toHaveBeenCalledWith("add_to_reserve", expect.objectContaining({ p_amount_cents: -1250 }));
  });

  it.each([["abc"], ["0"], ["-5"]])("refuses the amount %j", async (amount) => {
    expect(await addToReserve({ ...ok, amount })).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("needs a note", async () => {
    expect(await addToReserve({ ...ok, note: " x " })).toEqual({ ok: false, error: "Add a note saying where the funds come from" });
  });

  it("shows the database's message, and hides others", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "P0001", message: "The date can't be in the future." } });
    expect(await addToReserve(ok)).toEqual({ ok: false, error: "The date can't be in the future." });
    rpc.mockResolvedValueOnce({ error: { code: "XX000", message: "detail" } });
    expect(await addToReserve(ok)).toEqual({ ok: false, error: "That couldn't be saved. Try again." });
    expect(console.error).toHaveBeenCalledWith("reserve addition failed", { code: "XX000" });
  });
});
