import { describe, expect, it } from "vitest";
import { csvCell } from "./csv";

describe("csvCell", () => {
  it("quotes and escapes quotes", () => expect(csvCell('Say "hi", ok')).toBe('"Say ""hi"", ok"'));
  it.each(["=SUM(A1)", "+1", "-1+1", "@cmd", "\t=1", "\r=1", "\n=1"])("defuses formula %j", (v) => {
    expect(csvCell(v)).toBe(`"'${v}"`);
  });
  it("leaves ordinary text alone", () => expect(csvCell("Taxi")).toBe('"Taxi"'));
});
