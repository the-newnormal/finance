import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { IMPORT_COLUMNS, parseDate, parseImport } from "./import-claims";

const header = IMPORT_COLUMNS.join(",");
const row = 'ana@x.sg,Iftar 2026,Food,"Dates, water",42.50,1/3/2026,2026-03-05,TXN123,Joint A';

describe("parseCsv", () => {
  it("reads quoted commas, quotes and newlines", () => {
    expect(parseCsv('a,"b, c","say ""hi""","x\ny"\r\n1,2,3,4')).toEqual([["a", "b, c", 'say "hi"', "x\ny"], ["1", "2", "3", "4"]]);
  });
  it("drops a BOM and blank lines", () => expect(parseCsv("﻿a,b\n\n,\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]));
});

describe("parseDate", () => {
  it.each([["2026-03-05", "2026-03-05"], ["5/3/2026", "2026-03-05"], ["05-03-26", "2026-03-05"]])("%s", (s, d) =>
    expect(parseDate(s)).toBe(d));
  it.each(["31/2/2026", "2026-13-01", "March 5", ""])("refuses %j", (s) => expect(parseDate(s)).toBeNull());
});

describe("parseImport", () => {
  it("reads a filled-in template", () => {
    expect(parseImport(`${header}\n${row}`)).toEqual({ ok: true, rows: [{
      email: "ana@x.sg", budget: "Iftar 2026", category: "Food", description: "Dates, water", amount_cents: 4250,
      expense_date: "2026-03-01", paid_on: "2026-03-05", reference: "TXN123", account: "Joint A",
    }] });
  });

  it("matches columns by header, in any order and case", () => {
    const cols = [...IMPORT_COLUMNS].reverse().map((c) => c.toUpperCase()).join(",");
    const cells = row.match(/("[^"]*"|[^,]+)/g)!.reverse().join(",");
    expect(parseImport(`${cols}\n${cells}`).ok).toBe(true);
  });

  it("allows a blank purchase date", () => {
    const r = parseImport(`${header}\nana@x.sg,B,C,Taxi,10,,2026-03-05,TXN1,A`);
    expect(r.ok && r.rows[0].expense_date).toBeNull();
  });

  it("names missing columns", () => {
    expect(parseImport("member email,budget\nx,y")).toEqual({ ok: false, errors: [expect.stringContaining("category")] });
  });

  it("reports every bad row by number", () => {
    const r = parseImport(`${header}\n${row}\nnot-an-email,B,C,Taxi,abc,yesterday,,TX,A\n${row}`);
    expect(r).toEqual({ ok: false, errors: ["Row 2: check the member email, amount, paid date, purchase date, payment reference."] });
  });

  it("refuses an empty file and a header with no rows", () => {
    expect(parseImport("")).toEqual({ ok: false, errors: ["The file is empty."] });
    expect(parseImport(header)).toEqual({ ok: false, errors: ["There are no rows under the headers."] });
  });
});
