import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptCheckError, receiptCheckEnabled, runReceiptRead, type ReadResult } from "@/lib/receipt-check";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { precheckClaim } from "./precheck-actions";

vi.mock("@/lib/session", () => ({ requireMember: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// The real file handling and prompt; only the call to Claude (and the key check) is faked.
vi.mock("@/lib/receipt-check", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/receipt-check")>()),
  receiptCheckEnabled: vi.fn(() => true),
  runReceiptRead: vi.fn(),
}));

const VOL = "00000000-0000-4000-8000-000000000001";
const WATER = "20000000-0000-4000-8000-000000000001";
const CUPS = "20000000-0000-4000-8000-000000000002";
const input = { kind: "reimbursement" as const, attachmentPaths: [`${VOL}/x/3f2a9c1e-receipt.jpg`] };
let files: Record<string, Blob>;
let tables: Record<string, unknown[]>;
const download = vi.fn();

function client() {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "range"]) q[m] = () => q;
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve);
      return q;
    },
    storage: { from: () => ({ download }) },
  };
}

const read: ReadResult = {
  documents: [{ file: "File 1: receipt.jpg", kind: "receipt", merchant: "FairPrice", date: "2026-10-01", total_cents: 2180 }],
  document_kind: "receipt",
  fields: [{ field: "Payment Method", shown: "no", value: null }],
  missing: [],
  items: [
    { description: " Bottled water, 24 x 500 ml ", amount_cents: 1200, category: "f&b – participants" },
    { description: "Paper cups", amount_cents: 800, category: "Materials & Consumables" },
    { description: "Mystery", amount_cents: null, category: "Snacks" },
    { description: "   ", amount_cents: 5, category: null },
  ],
};

beforeEach(() => {
  tables = {
    claim_rules: [{ title: "Itemised receipts", body: "Receipts must list each item.", applies_to: "all" }],
    categories: [
      { id: WATER, name: "F&B – Participants", category_group: "programme" },
      { id: CUPS, name: "Materials & Consumables", category_group: "programme" },
    ],
  };
  files = { [input.attachmentPaths[0]]: new Blob([new Uint8Array(4)], { type: "image/jpeg" }) };
  download.mockReset().mockImplementation(async (path: string) =>
    files[path] ? { data: files[path], error: null } : { data: null, error: { message: "nope" } });
  vi.mocked(requireMember).mockResolvedValue({ id: VOL, role: "volunteer" } as never);
  vi.mocked(createClient).mockResolvedValue(client() as never);
  vi.mocked(receiptCheckEnabled).mockReturnValue(true);
  vi.mocked(runReceiptRead).mockReset().mockResolvedValue({ result: read, model: "claude-haiku-5-5" });
});

describe("precheckClaim", () => {
  it("reads the claimant's files as they attach them: what to fix, what each document shows, and the items bought", async () => {
    expect(await precheckClaim(input)).toEqual({
      ok: true,
      fixes: ["The receipt doesn't show: Payment Method."],
      documents: [{ kind: "receipt", total_cents: 2180, date: "2026-10-01" }],
      items: [
        { description: "Bottled water, 24 x 500 ml", amount_cents: 1200, category_id: WATER },
        { description: "Paper cups", amount_cents: 800, category_id: CUPS },
        { description: "Mystery", amount_cents: null, category_id: null },
      ],
    });
    expect(download).toHaveBeenCalledWith(input.attachmentPaths[0]);
    const [, text] = vi.mocked(runReceiptRead).mock.calls[0];
    expect(text).toContain("## Itemised receipts");
    expect(text).toContain("- F&B – Participants (Programme)");
    expect(text).toContain("Mandatory fields if the files are a receipt (receipt):");
  });

  it("tells them about a photo it can't read, without calling the AI", async () => {
    const zip = `${VOL}/x/3f2a9c1e-scan.zip`;
    files = { [zip]: new Blob([new Uint8Array(4)], { type: "application/zip" }) };
    expect(await precheckClaim({ ...input, attachmentPaths: [zip] })).toEqual({
      ok: true, fixes: ["Couldn't read scan.zip: this kind of file can't be read."], documents: [], items: [],
    });
    expect(runReceiptRead).not.toHaveBeenCalled();
  });

  it("only reads files in the claimant's own folder", async () => {
    const theirs = "00000000-0000-4000-8000-000000000009/x/3f2a9c1e-receipt.jpg";
    expect(await precheckClaim({ ...input, attachmentPaths: [theirs] })).toEqual({ ok: false });
    expect(await precheckClaim({ ...input, attachmentPaths: [`${VOL}/../x.jpg`] })).toEqual({ ok: false });
    expect(await precheckClaim({ ...input, attachmentPaths: [] })).toEqual({ ok: false });
    expect(download).not.toHaveBeenCalled();
  });

  it("says nothing when the check is off or can't run, so the claim goes in as usual", async () => {
    vi.mocked(receiptCheckEnabled).mockReturnValue(false);
    expect(await precheckClaim(input)).toEqual({ ok: false });
    vi.mocked(receiptCheckEnabled).mockReturnValue(true);
    vi.mocked(runReceiptRead).mockRejectedValue(new ReceiptCheckError("api_529"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await precheckClaim(input)).toEqual({ ok: false });
    expect(log).toHaveBeenCalledWith("receipt precheck failed", { step: "read", code: "api_529" });
    log.mockRestore();
  });
});
