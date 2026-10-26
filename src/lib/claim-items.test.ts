import { describe, expect, it } from "vitest";
import { comparedFixes, shareAmount, type ReadDocument } from "./claim-items";

const doc = (kind: ReadDocument["kind"], total_cents: number | null, date: string | null): ReadDocument => ({ kind, total_cents, date });
const item = (amount_cents: number | null) => ({ description: "x", amount_cents, category_id: null });

describe("comparedFixes", () => {
  it("compares the receipts' total and date with what was entered", () => {
    expect(comparedFixes([doc("receipt", 2540, "2026-10-01")], { amountCents: 2540, expenseDate: "2026-10-01" })).toEqual([]);
    expect(comparedFixes([doc("receipt", 2540, "2026-10-01")], { amountCents: 2600, expenseDate: "2026-10-02" })).toEqual([
      "The total on the documents doesn't match the amount claimed.",
      "The date on the documents doesn't match the date on the claim.",
    ]);
  });

  it("adds receipts up, allows $0.50, and leaves payment proofs out", () => {
    const docs = [doc("receipt", 1000, "2026-10-01"), doc("receipt", 1540, "2026-10-02"), doc("payment_proof", 2540, "2026-10-03")];
    expect(comparedFixes(docs, { amountCents: 2590, expenseDate: "2026-10-02" })).toEqual([]);
    expect(comparedFixes(docs, { amountCents: 2591, expenseDate: "2026-10-03" })).toHaveLength(2);
  });

  it("says nothing it can't compare: no total or date read, or none entered", () => {
    expect(comparedFixes([doc("receipt", null, null), doc("other", 99, "2020-01-01")], { amountCents: 2540, expenseDate: "2026-10-01" })).toEqual([]);
    expect(comparedFixes([doc("receipt", 2540, "2026-10-01")], { amountCents: null, expenseDate: null })).toEqual([]);
  });
});

describe("shareAmount", () => {
  it("shares the claim, tax included, in proportion to the items, adding up exactly", () => {
    // $20 of items, $21.80 paid with GST: 1200 and 800 become 1308 and 872.
    expect(shareAmount(2180, [item(1200), item(800)])).toEqual([1308, 872]);
    const shares = shareAmount(1000, [item(1), item(1), item(1)])!;
    expect(shares).toEqual([334, 333, 333]);
  });

  it("nets discounts, and gives an unpriced item nothing", () => {
    expect(shareAmount(900, [item(1000), item(-100), item(null)])).toEqual([1000, -100, 0]);
  });

  it("can't share across items with no amount, or a total of nothing", () => {
    expect(shareAmount(500, [item(null)])).toBeNull();
    expect(shareAmount(500, [item(100), item(-100)])).toBeNull();
    expect(shareAmount(500, [])).toBeNull();
  });
});
