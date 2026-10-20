import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { describeClaim, mediaTypeOf, prepareFiles, ReceiptCheckError, runReceiptCheck, savedCheck, StoredFindings, type CheckResult } from "./receipt-check";

const file = (name: string, mediaType: string, bytes = 10) => ({ name, mediaType, data: new Uint8Array(bytes) });

describe("mediaTypeOf", () => {
  it("trusts storage's type, else the extension", () => {
    expect(mediaTypeOf("r.jpg", "image/png")).toBe("image/png");
    expect(mediaTypeOf("r.JPG", undefined)).toBe("image/jpeg");
    expect(mediaTypeOf("scan.pdf", "application/octet-stream")).toBe("application/pdf");
    expect(mediaTypeOf("photo.heic", "")).toBe("image/heic");
    expect(mediaTypeOf("notes", undefined)).toBe("application/octet-stream");
  });
});

describe("prepareFiles", () => {
  it("labels each image and PDF and sends it as base64", () => {
    const { blocks, checked, skipped } = prepareFiles([file("a.jpg", "image/jpeg", 3), file("b.pdf", "application/pdf", 3)]);
    expect(blocks).toEqual([
      { type: "text", text: "File 1: a.jpg" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
      { type: "text", text: "File 2: b.pdf" },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "AAAA" } },
    ]);
    expect(checked).toEqual(["File 1: a.jpg", "File 2: b.pdf"]);
    expect(skipped).toEqual([]);
  });

  it("skips HEIC photos and other files, saying why", () => {
    const { blocks, skipped } = prepareFiles([file("p.heic", "image/heic"), file("x.zip", "application/zip")]);
    expect(blocks).toEqual([]);
    expect(skipped).toEqual([
      { name: "p.heic", reason: "HEIC photos can't be read; a JPEG, PNG or PDF can" },
      { name: "x.zip", reason: "this kind of file can't be read" },
    ]);
  });

  it("skips an image over the API's 10 MB (base64) limit, and files past the request's size", () => {
    const big = prepareFiles([file("big.png", "image/png", 8 * 1024 * 1024)]);
    expect(big.skipped[0]).toEqual({ name: "big.png", reason: "the image is too large to read (over about 7.5 MB)" });
    const pdf = 9 * 1024 * 1024; // 12 MB as base64
    const many = prepareFiles([file("1.pdf", "application/pdf", pdf), file("2.pdf", "application/pdf", pdf), file("3.pdf", "application/pdf", pdf)]);
    expect(many.checked).toEqual(["File 1: 1.pdf", "File 2: 2.pdf"]);
    expect(many.skipped).toEqual([{ name: "3.pdf", reason: "the claim's files are too large to read together" }]);
  });
});

describe("describeClaim", () => {
  const claim = {
    kind: "reimbursement" as const, amount_cents: 2540, expense_date: "2026-10-01", vendor_name: null,
    description: "Taxi to the venue", budgetName: "Iftar", categoryName: "Transport",
  };

  it("gives the claim, only the rules for its kind, and the files left out", () => {
    const text = describeClaim(claim, [
      { title: "What your receipt must show", body: "• the date", applies_to: "reimbursement" },
      { title: "What the invoice must show", body: "• the invoice number", applies_to: "invoice" },
      { title: "Before you submit", body: "Be accurate.", applies_to: "all" },
    ], [{ name: "p.heic", reason: "HEIC photos can't be read" }]);
    expect(text).toContain("- Amount claimed: $25.40");
    expect(text).toContain("- Date of purchase: 2026-10-01");
    expect(text).toContain('- Description: "Taxi to the venue"');
    expect(text).toContain("## What your receipt must show");
    expect(text).toContain("## Before you submit");
    expect(text).not.toContain("What the invoice must show");
    expect(text).toContain("- p.heic: HEIC photos can't be read");
  });

  it("lists TRP's mandatory fields for a receipt and for an invoice the claimant paid", () => {
    const text = describeClaim(claim, [], []);
    expect(text).toContain("Mandatory fields if the files are a receipt (receipt):\n- Date Of Transaction\n- Location Of Transaction");
    expect(text).toContain("- Proof Of Payment — Total Amount Paid");
  });

  it("lists the vendor invoice's fields, without proof of payment, for a vendor invoice", () => {
    const text = describeClaim({ ...claim, kind: "invoice", vendor_name: "The Hall Pte Ltd" }, [], []);
    expect(text).toContain("Mandatory fields (vendor_invoice):\n- Date Of Invoice");
    expect(text).not.toContain("Proof Of Payment");
    expect(text).not.toContain("Location Of Transaction");
  });

  it("names the vendor of an invoice", () => {
    expect(describeClaim({ ...claim, kind: "invoice", vendor_name: "The Hall Pte Ltd", expense_date: null }, [], []))
      .toContain("vendor invoice (Finance will pay the vendor, The Hall Pte Ltd)");
  });
});

describe("runReceiptCheck", () => {
  const result: CheckResult = {
    verdict: "looks_right", summary: "The receipt matches.", documents: [], document_kind: "receipt",
    fields: [{ field: "Total Cost", shown: "yes", value: "$25.40" }], amount_matches: "yes", date_matches: "yes", missing: [], concerns: [],
  };
  const client = (response: unknown) => {
    const parse = vi.fn(async () => response);
    return { parse, client: { messages: { parse } } as unknown as Anthropic };
  };

  it("asks Claude Haiku for the structured result, files before the claim, and reports the model", async () => {
    const { parse, client: c } = client({ stop_reason: "end_turn", parsed_output: result, model: "claude-haiku-5-5" });
    expect(await runReceiptCheck([{ type: "text", text: "File 1: a.jpg" }], "The claim: …", c))
      .toEqual({ result, model: "claude-haiku-5-5" });
    const params = (parse.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params).toMatchObject({ model: "claude-haiku-5-5" });
    // Haiku has no server-side fallback, so none is asked for.
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("betas");
    expect(params.output_config).toMatchObject({ effort: "medium" });
    expect(params.messages).toEqual([{ role: "user", content: [{ type: "text", text: "File 1: a.jpg" }, { type: "text", text: "The claim: …" }] }]);
  });

  it("throws a coded error on a refusal, a cut-off or an unparseable answer", async () => {
    for (const [response, code] of [
      [{ stop_reason: "refusal", parsed_output: null }, "refusal"],
      [{ stop_reason: "max_tokens", parsed_output: null }, "max_tokens"],
      [{ stop_reason: "end_turn", parsed_output: null }, "unparseable"],
    ] as const) {
      await expect(runReceiptCheck([], "x", client(response).client)).rejects.toEqual(new ReceiptCheckError(code));
    }
  });

  it("throws a coded error on an API failure, with its HTTP status", async () => {
    const failing = { messages: { parse: vi.fn(async () => { throw new Anthropic.APIError(529, undefined, "overloaded", new Headers()); }) } };
    await expect(runReceiptCheck([], "x", failing as unknown as Anthropic)).rejects.toEqual(new ReceiptCheckError("api_529"));
  });
});

describe("savedCheck", () => {
  const long = "x".repeat(5000);
  const doc = { file: long, kind: "receipt" as const, merchant: long, date: long, total: long, reference: long, payment_method: long, items: long };

  it("cuts a long answer down to what receipt_checks holds, keeping its shape", () => {
    const result: CheckResult = {
      verdict: "check_needed", summary: `  ${long}  `, documents: Array(9).fill(doc), document_kind: "receipt",
      fields: Array(40).fill({ field: long, shown: "no", value: long }), amount_matches: "no", date_matches: "unclear",
      missing: Array(40).fill(long), concerns: Array(40).fill(long),
    };
    const saved = savedCheck(result, Array(12).fill({ name: long, reason: long }));
    expect(saved.verdict).toBe("check_needed");
    expect(saved.summary).toHaveLength(1000);
    expect(saved.findings.documents).toHaveLength(5);
    expect(saved.findings.fields).toHaveLength(20);
    expect(saved.findings.missing).toHaveLength(10);
    expect(saved.findings.skipped).toHaveLength(10);
    // Well under the 50,000 characters the table allows, even if every character needed escaping.
    expect(JSON.stringify(saved.findings).length * 2).toBeLessThan(50_000);
    expect(StoredFindings.safeParse(saved.findings).success).toBe(true);
  });

  it("gives an empty summary words, and records an unreadable claim with its files", () => {
    expect(savedCheck({ ...{ verdict: "looks_right", documents: [], document_kind: "receipt", fields: [], amount_matches: "yes",
      date_matches: "yes", missing: [], concerns: [] }, summary: "   " }, []).summary).toBe("No summary was given.");
    expect(savedCheck(null, [{ name: "p.heic", reason: "HEIC photos can't be read" }])).toEqual({
      verdict: "unreadable", summary: "None of the attached files could be read.",
      findings: { documents: [], skipped: [{ name: "p.heic", reason: "HEIC photos can't be read" }] },
    });
  });

  it("never says a claim looks right when a file was left out", () => {
    const result: CheckResult = { verdict: "looks_right", summary: "Matches.", documents: [], document_kind: "receipt", fields: [],
      amount_matches: "yes", date_matches: "yes", missing: [], concerns: [] };
    expect(savedCheck(result, []).verdict).toBe("looks_right");
    const saved = savedCheck(result, [{ name: "p.heic", reason: "HEIC photos can't be read" }]);
    expect(saved.verdict).toBe("check_needed");
    expect(saved.findings.skipped).toEqual([{ name: "p.heic", reason: "HEIC photos can't be read" }]);
    expect(savedCheck({ ...result, verdict: "unreadable" }, [{ name: "p.heic", reason: "x" }]).verdict).toBe("unreadable");
  });

  it("refuses findings that aren't a check's shape", () => {
    expect(StoredFindings.safeParse({ fields: "x" }).success).toBe(false);
  });
});
