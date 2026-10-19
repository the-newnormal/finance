import { describe, expect, it } from "vitest";
import { singaporeDate, singaporeToday } from "./dates";

describe("Singapore dates", () => {
  it("uses Singapore's calendar day, not UTC's", () => {
    // 2026-10-19 23:30 UTC is 2026-10-20 07:30 in Singapore.
    expect(singaporeToday(new Date("2026-10-19T23:30:00Z"))).toBe("2026-10-20");
    expect(singaporeDate("2026-10-19T15:59:59Z")).toBe("2026-10-19");
    expect(singaporeDate("2026-10-19T16:00:00Z")).toBe("2026-10-20");
  });
});
