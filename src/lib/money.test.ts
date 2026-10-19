import { describe, expect, it } from "vitest";
import { formatSGD, parseAmountToCents, parseBudgetToCents } from "./money";

describe("parseAmountToCents", () => {
  it.each([
    ["42", 4200],
    ["42.5", 4250],
    ["42.50", 4250],
    ["$1,200.05", 120005],
    [" 0.01 ", 1],
    ["0.10", 10],
  ])("%j -> %i", (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents);
  });

  it.each(["", "0", "0.00", "-5", "1.234", "abc", "1e3", "12.", ".5", "1234567890", "1,2", "12,34", "1,2345", ",100", "1 200"])("rejects %j", (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });

  it("avoids floating-point rounding", () => {
    expect(parseAmountToCents("1.15")).toBe(115);
    expect(parseAmountToCents("4.35")).toBe(435);
  });
});

describe("parseBudgetToCents", () => {
  it.each([["0", 0], ["0.00", 0], ["$0", 0], ["1500", 150000]])("%j -> %i", (input, cents) => {
    expect(parseBudgetToCents(input)).toBe(cents);
  });
  it.each(["", "-1", "abc"])("rejects %j", (input) => expect(parseBudgetToCents(input)).toBeNull());
});

describe("formatSGD", () => {
  it("formats cents as Singapore dollars", () => {
    expect(formatSGD(123456)).toBe("$1,234.56");
  });
});
