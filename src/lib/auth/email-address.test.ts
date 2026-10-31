import { describe, expect, it } from "vitest";
import { isEmailAddress } from "./email-address";

describe("isEmailAddress", () => {
  it.each(["ada@normal.sg", "a.b+c@mail.example.org"])("accepts %s", (e) => expect(isEmailAddress(e)).toBe(true));
  it.each(["", "ada", "@normal.sg", "ada@", "ada@normal", "ada@.sg", "ada@normal.", "a@b@c.sg", "ada @normal.sg"])(
    "refuses %j", (e) => expect(isEmailAddress(e)).toBe(false));
  it("refuses an over-long value at once", () => {
    const crafted = `a@${".".repeat(50_000)}@`;
    const start = performance.now();
    expect(isEmailAddress(crafted)).toBe(false);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
