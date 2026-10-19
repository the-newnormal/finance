import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { PayoutType } from "./types";

// Payout details are encrypted here, on the server, before they reach the database, with
// AES-256-GCM: a fresh random 96-bit IV per value, a 128-bit tag, and the claimant's member id as
// additional authenticated data (AAD). The AAD binds a ciphertext to its owner: copied onto
// someone else's claim it fails to decrypt instead of paying the wrong account.
// Stored as "v1.<iv>.<tag>.<ciphertext>", each part standard base64.

export interface PayoutDetails {
  type: PayoutType;
  name: string; // account holder / payee
  proxy?: string; // PayNow mobile (+65…) or UEN
  bankName?: string;
  accountNumber?: string;
}

function key() {
  const raw = process.env.PAYOUT_ENCRYPTION_KEY;
  if (!raw) throw new Error("PAYOUT_ENCRYPTION_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("PAYOUT_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

/** Throws if the server's key is missing or malformed: a configuration fault, not bad data. */
export function assertPayoutKey() {
  key();
}

export function encryptPayout(details: PayoutDetails, ownerId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(ownerId, "utf8"));
  const data = Buffer.concat([cipher.update(JSON.stringify(details), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

/** Throws if the value was tampered with, belongs to another owner, or was made with another key. */
export function decryptPayout(token: string, ownerId: string): PayoutDetails {
  const [version, iv, tag, data, ...rest] = token.split(".");
  if (version !== "v1" || !iv || !tag || !data || rest.length) throw new Error("Unknown payout format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(ownerId, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as PayoutDetails;
}

/** What everyone but Finance sees, e.g. "Mobile •••• 4567". */
export function maskPayout(d: PayoutDetails): string {
  const last4 = (s = "") => "•••• " + s.replace(/\s/g, "").slice(-4);
  if (d.type === "bank") return `${d.bankName} ${last4(d.accountNumber)}`.slice(0, 60);
  return `${d.type === "paynow_uen" ? "UEN" : "Mobile"} ${last4(d.proxy)}`;
}
