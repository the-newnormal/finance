import { describe, expect, it } from "vitest";
import { formatSGD, parseAmountToCents } from "./money";

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

  it.each(["", "0", "0.00", "-5", "1.234", "abc", "1e3", "12.", ".5", "1234567890"])("rejects %j", (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });

  it("avoids floating-point rounding", () => {
    expect(parseAmountToCents("1.15")).toBe(115);
    expect(parseAmountToCents("4.35")).toBe(435);
  });
});

describe("formatSGD", () => {
  it("formats cents as Singapore dollars", () => {
    expect(formatSGD(123456)).toBe("$1,234.56");
  });
});
