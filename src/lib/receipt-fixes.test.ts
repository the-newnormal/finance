import { describe, expect, it } from "vitest";
import { receiptFixes, rejectionReason } from "./receipt-fixes";

const fields = [
  { field: "Date Of Transaction", shown: "yes" as const, value: "2026-10-01" },
  { field: "Receipt/Reference Number", shown: "no" as const, value: null },
  { field: "Payment Method", shown: "no" as const, value: null },
  { field: "Total Cost", shown: "unclear" as const, value: null },
];

describe("receiptFixes", () => {
  it("says what the claimant can fix, in their words", () => {
    expect(receiptFixes({
      verdict: "check_needed",
      findings: {
        document_kind: "receipt", fields, amount_matches: "no", date_matches: "no",
        missing: ["The receipt must be itemised"], concerns: ["The total looks edited"],
        skipped: [{ name: "photo.heic", reason: "HEIC photos can't be read; a JPEG, PNG or PDF can" }],
      },
    })).toEqual([
      "The receipt doesn't show: Receipt/Reference Number, Payment Method.",
      "These can't be read clearly: Total Cost.",
      "The total on the documents doesn't match the amount claimed.",
      "The date on the documents doesn't match the date on the claim.",
      "The receipt must be itemised.",
      "Couldn't read photo.heic: HEIC photos can't be read; a JPEG, PNG or PDF can.",
    ]);
  });

  it("names a document it was given but couldn't make out", () => {
    const blurry = { file: "File 2: photo.jpg", kind: "unreadable" as const, merchant: null, date: null, total: null,
      reference: null, payment_method: null, items: null };
    expect(receiptFixes({ verdict: "check_needed", findings: { documents: [blurry] } }))
      .toEqual(["Couldn't read photo.jpg clearly. Please attach a clearer copy."]);
    expect(receiptFixes({ verdict: "unreadable", findings: { documents: [blurry] } }))
      .toEqual(["Couldn't read photo.jpg clearly. Please attach a clearer copy."]);
  });

  it("leaves the reviewer's concerns out, and has nothing to say when the claim looks right", () => {
    expect(receiptFixes({ verdict: "check_needed", findings: { concerns: ["Signs of editing"] } })).toEqual([]);
    expect(receiptFixes({ verdict: "looks_right", findings: { document_kind: "receipt", fields } })).toEqual([]);
  });

  it("names the document by its kind, and says so when nothing could be read", () => {
    const missing = [{ field: "Date Of Invoice", shown: "no" as const, value: null }];
    expect(receiptFixes({ verdict: "check_needed", findings: { document_kind: "paid_invoice", fields: missing } }))
      .toEqual(["The invoice doesn't show: Date Of Invoice."]);
    expect(receiptFixes({ verdict: "check_needed", findings: { document_kind: "unclear", fields: missing } }))
      .toEqual(["The documents don't show: Date Of Invoice."]);
    expect(receiptFixes({ verdict: "unreadable", findings: {} }))
      .toEqual(["The attached files couldn't be read. Please attach a clearer copy."]);
  });
});

describe("rejectionReason", () => {
  it("joins the fixes, keeping to whole sentences within 500 characters", () => {
    const findings = { missing: Array.from({ length: 20 }, (_, i) => `Item ${i} is required ${"x".repeat(40)}`) };
    const reason = rejectionReason({ verdict: "check_needed", findings })!;
    expect(reason.length).toBeLessThanOrEqual(500);
    expect(reason).toMatch(/^Item 0 is required x+\. Item 1/);
    expect(reason.endsWith(".")).toBe(true);
  });

  it("leaves out a fix too long to fit, and still adds the shorter ones after it", () => {
    const reason = rejectionReason({
      verdict: "check_needed",
      findings: {
        missing: ["a".repeat(250), "b".repeat(300)],
        skipped: [{ name: "photo.heic", reason: "HEIC photos can't be read; a JPEG, PNG or PDF can" }],
      },
    })!;
    expect(reason).toBe(`${"a".repeat(250)}. Couldn't read photo.heic: HEIC photos can't be read; a JPEG, PNG or PDF can.`);
  });

  it("cuts a single long fix down, and gives none when there's nothing to fix", () => {
    expect(rejectionReason({ verdict: "check_needed", findings: { missing: ["y".repeat(900)] } })).toHaveLength(500);
    expect(rejectionReason({ verdict: "looks_right", findings: {} })).toBeNull();
  });
});
