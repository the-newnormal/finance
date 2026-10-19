import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptPayout, encryptPayout, maskPayout, type PayoutDetails } from "./crypto";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const details: PayoutDetails = { type: "paynow_mobile", name: "Tan Ah Kow", proxy: "+6591234567" };

beforeEach(() => vi.stubEnv("PAYOUT_ENCRYPTION_KEY", randomBytes(32).toString("base64")));
afterEach(() => vi.unstubAllEnvs());

describe("payout encryption", () => {
  it("round-trips for the same owner", () => {
    expect(decryptPayout(encryptPayout(details, OWNER), OWNER)).toEqual(details);
  });

  it("uses a fresh IV every time", () => {
    expect(encryptPayout(details, OWNER)).not.toBe(encryptPayout(details, OWNER));
  });

  it("has the documented format", () => {
    const [v, iv, tag] = encryptPayout(details, OWNER).split(".");
    expect(v).toBe("v1");
    expect(Buffer.from(iv, "base64")).toHaveLength(12);
    expect(Buffer.from(tag, "base64")).toHaveLength(16);
  });

  it("refuses a ciphertext moved to another owner (AAD)", () => {
    expect(() => decryptPayout(encryptPayout(details, OWNER), OTHER)).toThrow();
  });

  it("refuses a tampered ciphertext", () => {
    const [v, iv, tag, data] = encryptPayout(details, OWNER).split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(() => decryptPayout([v, iv, tag, flipped.toString("base64")].join("."), OWNER)).toThrow();
  });

  it("refuses another key's ciphertext", () => {
    const token = encryptPayout(details, OWNER);
    vi.stubEnv("PAYOUT_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(() => decryptPayout(token, OWNER)).toThrow();
  });

  it("refuses a malformed key", () => {
    vi.stubEnv("PAYOUT_ENCRYPTION_KEY", "short");
    expect(() => encryptPayout(details, OWNER)).toThrow(/32 bytes/);
  });
});

describe("maskPayout", () => {
  it.each([
    [details, "Mobile •••• 4567"],
    [{ type: "paynow_uen", name: "Hall Pte Ltd", proxy: "201912345K" } as const, "UEN •••• 345K"],
    [{ type: "bank", name: "Tan", bankName: "DBS", accountNumber: "123-456-7890" } as const, "DBS •••• 7890"],
  ])("shows only the last four characters", (d, masked) => {
    expect(maskPayout(d)).toBe(masked);
  });
});
