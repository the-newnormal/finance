import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptCheckError, receiptCheckEnabled, runReceiptCheck } from "@/lib/receipt-check";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { precheckClaim } from "./precheck-actions";

vi.mock("@/lib/session", () => ({ requireMember: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// The real file handling and prompt; only the call to Claude (and the key check) is faked.
vi.mock("@/lib/receipt-check", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/receipt-check")>()),
  receiptCheckEnabled: vi.fn(() => true),
  runReceiptCheck: vi.fn(),
}));

const VOL = "00000000-0000-4000-8000-000000000001";
const input = {
  kind: "reimbursement" as const, budgetId: "10000000-0000-4000-8000-000000000001", categoryId: "20000000-0000-4000-8000-000000000001",
  description: "Taxi", amount: "25.40", expenseDate: "2026-10-01", attachmentPaths: [`${VOL}/x/3f2a9c1e-receipt.jpg`],
};
let files: Record<string, Blob>;
const download = vi.fn();

function client() {
  const rows: Record<string, unknown> = { budgets: { name: "Iftar" }, categories: { name: "Transport" } };
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "range"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: rows[table], error: null });
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      return q;
    },
    storage: { from: () => ({ download }) },
  };
}

const flagged = {
  verdict: "check_needed", summary: "No payment method.", documents: [], document_kind: "receipt",
  fields: [{ field: "Payment Method", shown: "no", value: null }], amount_matches: "yes", date_matches: "yes",
  missing: [], concerns: ["Looks edited"],
};

beforeEach(() => {
  files = { [input.attachmentPaths[0]]: new Blob([new Uint8Array(4)], { type: "image/jpeg" }) };
  download.mockReset().mockImplementation(async (path: string) =>
    files[path] ? { data: files[path], error: null } : { data: null, error: { message: "nope" } });
  vi.mocked(requireMember).mockResolvedValue({ id: VOL, role: "volunteer" } as never);
  vi.mocked(createClient).mockResolvedValue(client() as never);
  vi.mocked(receiptCheckEnabled).mockReturnValue(true);
  vi.mocked(runReceiptCheck).mockReset().mockResolvedValue({ result: flagged as never, model: "claude-haiku-5-5" });
});

describe("precheckClaim", () => {
  it("reads the claimant's files against what they entered, and says what to fix, never the concerns", async () => {
    expect(await precheckClaim(input)).toEqual({ ok: true, fixes: ["The receipt doesn't show: Payment Method."] });
    expect(download).toHaveBeenCalledWith(input.attachmentPaths[0]);
    const [, text] = vi.mocked(runReceiptCheck).mock.calls[0];
    expect(text).toContain("Amount claimed: $25.40");
    expect(text).toContain("Date of purchase: 2026-10-01");
    expect(text).toContain("Budget: Iftar; category: Transport");
  });

  it("has nothing to fix when the files look right", async () => {
    vi.mocked(runReceiptCheck).mockResolvedValue({ result: { ...flagged, verdict: "looks_right", fields: [] } as never, model: "m" });
    expect(await precheckClaim(input)).toEqual({ ok: true, fixes: [] });
  });

  it("tells them about a photo it can't read, without calling the AI", async () => {
    const heic = `${VOL}/x/3f2a9c1e-photo.heic`;
    files = { [heic]: new Blob([new Uint8Array(4)], { type: "image/heic" }) };
    expect(await precheckClaim({ ...input, attachmentPaths: [heic] })).toEqual({
      ok: true, fixes: ["Couldn't read photo.heic: HEIC photos can't be read; a JPEG, PNG or PDF can."],
    });
    expect(runReceiptCheck).not.toHaveBeenCalled();
  });

  it("only reads files in the claimant's own folder", async () => {
    const theirs = "00000000-0000-4000-8000-000000000009/x/3f2a9c1e-receipt.jpg";
    expect(await precheckClaim({ ...input, attachmentPaths: [theirs] })).toEqual({ ok: false });
    expect(await precheckClaim({ ...input, attachmentPaths: [`${VOL}/../x.jpg`] })).toEqual({ ok: false });
    expect(download).not.toHaveBeenCalled();
  });

  it("says nothing when the check is off or can't run, so the claim goes in as usual", async () => {
    vi.mocked(receiptCheckEnabled).mockReturnValue(false);
    expect(await precheckClaim(input)).toEqual({ ok: false });
    vi.mocked(receiptCheckEnabled).mockReturnValue(true);
    vi.mocked(runReceiptCheck).mockRejectedValue(new ReceiptCheckError("api_529"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await precheckClaim(input)).toEqual({ ok: false });
    expect(log).toHaveBeenCalledWith("receipt precheck failed", { step: "check", code: "api_529" });
    expect(await precheckClaim({ ...input, amount: "abc" })).toEqual({ ok: false });
    log.mockRestore();
  });
});
