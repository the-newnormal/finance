import { describe, expect, it } from "vitest";
import { buildPayNowPayload, normaliseSgMobile, normaliseUen } from "./paynow";

// CRC-16/CCITT-FALSE, written independently of the implementation.
function crc(s: string) {
  let c = 0xffff;
  for (const b of Buffer.from(s)) {
    c ^= b << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c.toString(16).toUpperCase().padStart(4, "0");
}

// Splits an EMVCo TLV string into { id: value }.
function tlv(s: string) {
  const out: Record<string, string> = {};
  for (let i = 0; i < s.length; ) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    out[id] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

describe("buildPayNowPayload", () => {
  const payload = buildPayNowPayload({
    proxyType: "mobile",
    proxy: "+6591234567",
    amountCents: 4250,
    payeeName: "Tan Ah Kow",
    reference: "NN-ABCD1234",
  });
  const fields = tlv(payload);

  it("ends with a correct CRC", () => {
    expect(payload.slice(-4)).toBe(crc(payload.slice(0, -4)));
  });

  it("is a dynamic SGD QR with the amount locked", () => {
    expect(fields["00"]).toBe("01");
    expect(fields["01"]).toBe("12");
    expect(fields["53"]).toBe("702");
    expect(fields["54"]).toBe("42.50");
    expect(fields["58"]).toBe("SG");
    expect(fields["59"]).toBe("Tan Ah Kow");
  });

  it("carries the PayNow proxy and reference", () => {
    const merchant = tlv(fields["26"]);
    expect(merchant["00"]).toBe("SG.PAYNOW");
    expect(merchant["01"]).toBe("0"); // mobile
    expect(merchant["02"]).toBe("+6591234567");
    expect(merchant["03"]).toBe("0"); // not editable
    expect(tlv(fields["62"])["01"]).toBe("NN-ABCD1234");
  });

  it("uses proxy type 2 for a UEN", () => {
    const p = buildPayNowPayload({ proxyType: "uen", proxy: "201912345K", amountCents: 100, payeeName: "Hall", reference: "R1" });
    expect(tlv(tlv(p)["26"])["01"]).toBe("2");
  });
});

describe("normalisers", () => {
  it.each([["9123 4567", "+6591234567"], ["+65 8123 4567", "+6581234567"], ["6591234567", "+6591234567"]])(
    "mobile %j -> %j",
    (input, out) => expect(normaliseSgMobile(input)).toBe(out),
  );
  it.each(["6123 4567", "912345", "+1 415 555 0100"])("rejects mobile %j", (input) => {
    expect(normaliseSgMobile(input)).toBeNull();
  });
  it("accepts a UEN and upper-cases it", () => expect(normaliseUen(" 201912345k ")).toBe("201912345K"));
  it("rejects a short UEN", () => expect(normaliseUen("1234")).toBeNull());
});
