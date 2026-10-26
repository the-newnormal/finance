import { describe, expect, it } from "vitest";
import { recentlySignedIn } from "./recent";

const now = 1_800_000_000;

describe("recentlySignedIn", () => {
  it("accepts a sign-in in the last 15 minutes", () => {
    expect(recentlySignedIn({ amr: [{ method: "otp", timestamp: now - 60 }] }, now)).toBe(true);
  });
  it("uses the newest sign-in", () => {
    expect(recentlySignedIn({ amr: [{ method: "otp", timestamp: now - 9999 }, { method: "password", timestamp: now - 10 }] }, now)).toBe(true);
  });
  it("refuses an older one, and a token without sign-in times", () => {
    expect(recentlySignedIn({ amr: [{ method: "otp", timestamp: now - 16 * 60 }] }, now)).toBe(false);
    expect(recentlySignedIn({ iat: now }, now)).toBe(false);
    expect(recentlySignedIn(null, now)).toBe(false);
  });
});
