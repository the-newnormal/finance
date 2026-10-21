import { describe, expect, it } from "vitest";
import { describeEdit, signedSGD } from "./bank-edits";

const names: Record<string, string> = { a: "DBS Joint", b: "DBS Second" };
const name = (id: string) => names[id] ?? "—";
const before = { account_id: "a", amount_cents: -2500, entry_date: "2026-02-10", note: "Vol · TXN-1" };

describe("describeEdit", () => {
  it("names every field that changed, in order", () => {
    expect(describeEdit({ before, after: { account_id: "b", amount_cents: -3000, entry_date: "2026-02-12", note: "Vol · TXN-2" } }, name)).toEqual([
      "Amount −$25.00 → −$30.00",
      "Date 10 Feb 2026 → 12 Feb 2026",
      "Account DBS Joint → DBS Second",
      "Note “Vol · TXN-1” → “Vol · TXN-2”",
    ]);
  });

  it("leaves out what stayed the same", () => {
    expect(describeEdit({ before, after: { ...before, amount_cents: -2000 } }, name)).toEqual(["Amount −$25.00 → −$20.00"]);
    expect(describeEdit({ before, after: before }, name)).toEqual([]);
  });
});

describe("signedSGD", () => {
  it("shows money in and out as the ledger does", () => {
    expect(signedSGD(1050)).toBe("+$10.50");
    expect(signedSGD(-1050)).toBe("−$10.50");
    expect(signedSGD(0)).toBe("$0.00");
  });
});
