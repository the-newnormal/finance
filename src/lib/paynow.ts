import { singaporeDate } from "./dates";

/**
 * Builds an SGQR / EMVCo-compliant PayNow payload. Scanning the resulting QR
 * in any Singapore banking app pre-fills the payee, amount and reference; the
 * Finance user still confirms the transfer in their bank app.
 */

function tlv(id: string, value: string) {
  return id + value.length.toString().padStart(2, "0") + value;
}

function crc16(input: string) {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function clean(s: string, max: number) {
  return s.normalize("NFKD").replace(/[^\x20-\x7E]/g, "").trim().slice(0, max);
}

// Singapore UEN formats: businesses (8 digits + letter), local companies (year + 5 digits +
// letter), and other entities (T/S/R + 2-digit year + 2-letter entity type + 4 digits + letter).
const UEN = /^(\d{8}[A-Z]|\d{9}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z])$/;

export function normaliseUen(input: string): string | null {
  const uen = input.replace(/\s/g, "").toUpperCase();
  return UEN.test(uen) ? uen : null;
}

export function normaliseSgMobile(input: string): string | null {
  // Only digits and the usual separators; anything else (a letter, say) is a typo, not formatting.
  if (!/^\+?[\d\s\-()]+$/.test(input.trim())) return null;
  const digits = input.replace(/\D/g, "").replace(/^65(?=\d{8}$)/, "");
  return /^[89]\d{7}$/.test(digits) ? `+65${digits}` : null;
}

export function buildPayNowPayload(opts: {
  proxyType: "mobile" | "uen";
  proxy: string;
  amountCents: number;
  payeeName: string;
  reference: string;
  expiresInDays?: number;
}) {
  // The expiry is a calendar date, so take it in Singapore time (a UTC date is a day early before 8am).
  const expiry = new Date(Date.now() + (opts.expiresInDays ?? 7) * 86_400_000);
  const yyyymmdd = singaporeDate(expiry).replace(/-/g, "");

  const merchant =
    tlv("00", "SG.PAYNOW") +
    tlv("01", opts.proxyType === "mobile" ? "0" : "2") +
    tlv("02", opts.proxy) +
    tlv("03", "0") + // amount not editable
    tlv("04", yyyymmdd);

  const body =
    tlv("00", "01") +
    tlv("01", "12") + // dynamic QR
    tlv("26", merchant) +
    tlv("52", "0000") +
    tlv("53", "702") + // SGD
    tlv("54", (opts.amountCents / 100).toFixed(2)) +
    tlv("58", "SG") +
    tlv("59", clean(opts.payeeName, 25) || "NA") +
    tlv("60", "Singapore") +
    tlv("62", tlv("01", clean(opts.reference, 25).replace(/[^A-Za-z0-9-]/g, ""))) +
    "6304";

  return body + crc16(body);
}
