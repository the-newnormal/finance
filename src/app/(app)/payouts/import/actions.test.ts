import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_COLUMNS } from "@/lib/import-claims";
import { createClient } from "@/lib/supabase/server";
import { importPaidClaims } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireFinance: vi.fn(async () => ({ id: "me", role: "finance" })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const rpc = vi.fn();
const csv = `${IMPORT_COLUMNS.join(",")}\nana@x.sg,Iftar,Food,Dates,42.50,,2026-03-05,TXN123,Joint A`;

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("importPaidClaims", () => {
  it("sends the parsed rows to the database in one call", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    expect(await importPaidClaims(csv)).toEqual({ ok: true, count: 1 });
    expect(rpc).toHaveBeenCalledWith("import_paid_claims", { p_rows: [expect.objectContaining({ email: "ana@x.sg", amount_cents: 4250, paid_on: "2026-03-05" })] });
  });

  it("refuses a bad file without calling the database", async () => {
    expect(await importPaidClaims("member email\nx")).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's row message", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: 'Row 1: no budget is called "Iftar".' } });
    expect(await importPaidClaims(csv)).toEqual({ ok: false, errors: ['Row 1: no budget is called "Iftar".'] });
  });

  it("hides unexpected errors and logs only the code", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret detail" } });
    expect(await importPaidClaims(csv)).toEqual({ ok: false, errors: ["The import couldn't be saved. Nothing was imported; try again."] });
    expect(console.error).toHaveBeenCalledWith("claim import failed", { code: "XX000" });
  });
});
