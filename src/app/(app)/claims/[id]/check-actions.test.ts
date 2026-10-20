import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptCheckError, receiptCheckEnabled, runReceiptCheck } from "@/lib/receipt-check";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { checkReceipts } from "./check-actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireMember: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// The real file handling and prompt; only the call to Claude (and the key check) is faked.
vi.mock("@/lib/receipt-check", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/receipt-check")>()),
  receiptCheckEnabled: vi.fn(() => true),
  runReceiptCheck: vi.fn(),
}));

const ID = "40000000-0000-4000-8000-000000000001";
const VOL = "00000000-0000-4000-8000-000000000001";
const LEAD = "00000000-0000-4000-8000-000000000002";
const claimRow = {
  id: ID, kind: "reimbursement", status: "pending_review", claimant_id: VOL, budget_id: "b1", category_id: "c1",
  description: "Taxi", amount_cents: 2540, expense_date: "2026-10-01", vendor_name: null,
  attachment_paths: [`${VOL}/x/3f2a9c1e-receipt.jpg`],
};
let claim: Record<string, unknown> | null;
let files: Record<string, Blob>;
const rpc = vi.fn();

function client() {
  const rows: Record<string, unknown> = {
    budgets: { name: "Iftar" }, categories: { name: "Transport" },
  };
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: table === "claims" ? claim : rows[table], error: null });
      q.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [{ title: "What your receipt must show", body: "• the date", applies_to: "reimbursement" }], error: null }).then(resolve);
      return q;
    },
    storage: { from: () => ({ download: async (path: string) => (files[path] ? { data: files[path], error: null } : { data: null, error: { message: "nope" } }) }) },
    rpc,
  };
}

const fields = [{ field: "Total Cost", shown: "yes", value: "$25.40" }];
const looksRight = {
  verdict: "looks_right", summary: "The receipt matches.", documents: [], document_kind: "receipt", fields,
  amount_matches: "yes", date_matches: "yes", missing: [], concerns: [],
};

beforeEach(() => {
  claim = { ...claimRow };
  files = { [claimRow.attachment_paths[0]]: new Blob([new Uint8Array(4)], { type: "image/jpeg" }) };
  rpc.mockReset().mockResolvedValue({ error: null });
  vi.mocked(requireMember).mockResolvedValue({ id: LEAD, role: "lead" } as never);
  vi.mocked(createClient).mockResolvedValue(client() as never);
  vi.mocked(receiptCheckEnabled).mockReturnValue(true);
  vi.mocked(runReceiptCheck).mockReset().mockResolvedValue({ result: looksRight as never, model: "claude-haiku-5-5" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("checkReceipts", () => {
  it("reads the receipts with Claude and saves the advice", async () => {
    expect(await checkReceipts(ID)).toEqual({ ok: true });
    const [blocks, text] = vi.mocked(runReceiptCheck).mock.calls[0];
    expect(blocks[0]).toEqual({ type: "text", text: "File 1: receipt.jpg" });
    expect(blocks[1]).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });
    expect(text).toContain("- Amount claimed: $25.40");
    expect(text).toContain("## What your receipt must show");
    expect(rpc).toHaveBeenCalledWith("record_receipt_check", {
      p_claim: ID, p_verdict: "looks_right", p_summary: "The receipt matches.", p_files_checked: 1, p_model: "claude-haiku-5-5",
      p_findings: { documents: [], document_kind: "receipt", fields, amount_matches: "yes", date_matches: "yes", missing: [], concerns: [], skipped: [] },
    });
  });

  it("records that nothing could be read without asking Claude", async () => {
    files = { [claimRow.attachment_paths[0]]: new Blob([new Uint8Array(4)], { type: "image/heic" }) };
    await checkReceipts(ID);
    expect(runReceiptCheck).not.toHaveBeenCalled();
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_verdict: "unreadable", p_files_checked: 0, p_model: "none" });
  });

  it("does nothing when the server has no API key", async () => {
    vi.mocked(receiptCheckEnabled).mockReturnValue(false);
    expect(await checkReceipts(ID)).toEqual({ ok: false, error: "The AI receipt check isn't set up on this server." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses the claimant's own claim before paying for a check", async () => {
    vi.mocked(requireMember).mockResolvedValue({ id: VOL, role: "volunteer" } as never);
    expect(await checkReceipts(ID)).toEqual({ ok: false, error: "You can't check your own claim." });
    expect(runReceiptCheck).not.toHaveBeenCalled();
  });

  it("lets Finance check its own claim", async () => {
    vi.mocked(requireMember).mockResolvedValue({ id: VOL, role: "finance" } as never);
    expect(await checkReceipts(ID)).toEqual({ ok: true });
  });

  it("only checks claims awaiting a decision", async () => {
    claim = { ...claimRow, status: "approved" };
    expect(await checkReceipts(ID)).toEqual({ ok: false, error: "Only claims awaiting a decision are checked." });
    expect(runReceiptCheck).not.toHaveBeenCalled();
  });

  it("says when the claim isn't there (or isn't the viewer's to see)", async () => {
    claim = null;
    expect(await checkReceipts(ID)).toEqual({ ok: false, error: "Claim not found." });
  });

  it("saves nothing when Claude can't check it, and logs a code only", async () => {
    vi.mocked(runReceiptCheck).mockRejectedValue(new ReceiptCheckError("api_529"));
    expect(await checkReceipts(ID)).toEqual({ ok: false, error: "The receipts couldn't be checked just now. Try again." });
    expect(rpc).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("receipt check failed", { code: "api_529" });
    vi.mocked(runReceiptCheck).mockRejectedValue(new ReceiptCheckError("refusal"));
    expect(await checkReceipts(ID)).toEqual({ ok: false, error: "The AI declined to check these receipts. Check them yourself." });
  });

  it("shows the database's own refusal to save", async () => {
    rpc.mockResolvedValue({ error: { code: "42501", message: "You can't check your own claim." } });
    expect(await checkReceipts(ID)).toEqual({ ok: false, error: "You can't check your own claim." });
  });
});
