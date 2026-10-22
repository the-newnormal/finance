import { describe, expect, it } from "vitest";
import { inRange, nextDay, parseExportFilters, singaporeDayStart } from "./export-filters";

const parse = (q: string) => parseExportFilters(new URLSearchParams(q));
const DIV = "10000000-0000-4000-8000-000000000001";
const BUDGET = "20000000-0000-4000-8000-000000000001";

describe("parseExportFilters", () => {
  it("exports everything when nothing is chosen (blank fields included)", () => {
    for (const q of ["", "from=&to=&division=&budget=&status="]) {
      expect(parse(q)).toEqual({
        ok: true, filters: { from: null, to: null, dates: "submitted", divisionId: null, budgetId: null, status: null },
      });
    }
  });

  it("reads every filter", () => {
    expect(parse(`from=2026-01-01&to=2026-03-31&dates=paid&division=${DIV}&budget=${BUDGET}&status=paid`)).toEqual({
      ok: true, filters: { from: "2026-01-01", to: "2026-03-31", dates: "paid", divisionId: DIV, budgetId: BUDGET, status: "paid" },
    });
  });

  it("refuses dates that aren't real calendar dates, or a range that ends before it starts", () => {
    expect(parse("from=2026-02-30")).toEqual({ ok: false, error: "Enter dates as YYYY-MM-DD." });
    expect(parse("to=31/03/2026")).toEqual({ ok: false, error: "Enter dates as YYYY-MM-DD." });
    expect(parse("from=2026-04-01&to=2026-03-31")).toEqual({ ok: false, error: "The start date is after the end date." });
    expect(parse("from=2026-03-31&to=2026-03-31").ok).toBe(true);
  });

  it("refuses anything not offered in the lists", () => {
    expect(parse("dates=purchase")).toEqual({ ok: false, error: "Choose submitted or disbursement dates." });
    expect(parse("division=nope")).toEqual({ ok: false, error: "Choose a division and budget from the lists." });
    expect(parse("budget=1;drop")).toEqual({ ok: false, error: "Choose a division and budget from the lists." });
    expect(parse("status=deleted")).toEqual({ ok: false, error: "Choose a status from the list." });
  });
});

describe("date bounds", () => {
  it("starts a day at Singapore midnight", () => {
    expect(new Date(singaporeDayStart("2026-03-01")).toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });

  it("finds the next day across months and leap years", () => {
    expect(nextDay("2026-01-31")).toBe("2026-02-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("includes both ends of a range", () => {
    const f = { from: "2026-01-01", to: "2026-01-31" };
    expect([inRange("2025-12-31", f), inRange("2026-01-01", f), inRange("2026-01-31", f), inRange("2026-02-01", f)])
      .toEqual([false, true, true, false]);
    expect(inRange("1999-01-01", { from: null, to: null })).toBe(true);
  });
});
