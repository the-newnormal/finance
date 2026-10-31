// What members attach to a claim, and HEIC photos (iPhones' default) made into JPEGs as they're chosen:
// browsers other than Safari can't show HEIC to reviewers, the AI receipt check can't read it, and
// Chrome and Firefox often give HEIC files no type, which the receipts bucket refuses.

/** The types the receipts bucket accepts (supabase/migrations/0003_claims.sql). */
export const ACCEPTED = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif", "application/pdf"];

/** A file input's `accept`: those types, and HEIC's extensions for pickers that don't know its type. */
export const ACCEPT_ATTR = [...ACCEPTED, ".heic", ".heif"].join(",");

const HEIC_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

/** Whether a chosen file is a HEIC or HEIF photo: by its type, or by its name when it has none. */
export function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  if (HEIC_TYPES.includes(type)) return true;
  return (!type || type === "application/octet-stream") && /\.hei[cf]$/i.test(file.name);
}

/** The largest HEIC photo converted: well above any phone's (a 48 MP iPhone photo is about 8 MB). */
export const MAX_HEIC_BYTES = 25 * 1024 * 1024;
/** The most pixels converted: a 48 MP photo, with room. The converter allocates them all up front. */
export const MAX_HEIC_PIXELS = 60_000_000;
const HEIC_TIMEOUT_MS = 30_000;

/**
 * A HEIC file's largest image size, read from its 'ispe' (image spatial extent) boxes in the first
 * megabyte, where the file's metadata lives. null if there are none, so the file can't be checked.
 */
export function heicPixels(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let most: number | null = null;
  // An ispe box: "ispe", then 4 bytes of version and flags, then width and height (32-bit, big-endian).
  for (let i = 0; i + 16 <= bytes.length; i++) {
    if (bytes[i] !== 0x69 || bytes[i + 1] !== 0x73 || bytes[i + 2] !== 0x70 || bytes[i + 3] !== 0x65) continue;
    const pixels = view.getUint32(i + 8) * view.getUint32(i + 12);
    most = Math.max(most ?? 0, pixels);
  }
  return most;
}

/**
 * A HEIC or HEIF photo as a JPEG, named for it ("IMG_1234.HEIC" → "IMG_1234.jpg"). Throws if it
 * can't be read. The converter allocates the whole decoded image before reading any of it, so a
 * small crafted file claiming a huge size could freeze the tab: the file's size and its declared
 * pixel count are checked first, and a conversion taking more than 30 seconds is given up on.
 */
export async function heicToJpeg(file: File): Promise<File> {
  if (file.size > MAX_HEIC_BYTES) throw new Error("heic too large");
  const pixels = heicPixels(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()));
  if (pixels === null || pixels > MAX_HEIC_PIXELS) throw new Error("heic size unknown or too large");
  const { heicTo } = await import("heic-to"); // about 3 MB, so only loaded when a HEIC photo is chosen
  let timer: ReturnType<typeof setTimeout> | undefined;
  const jpeg = await Promise.race([
    heicTo({ blob: file, type: "image/jpeg", quality: 0.9 }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("heic conversion timed out")), HEIC_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
  const name = `${file.name.replace(/\.hei[cf]$/i, "")}.jpg`;
  return new File([jpeg], name, { type: "image/jpeg", lastModified: file.lastModified });
}

/** The file to upload for one that was chosen: a HEIC or HEIF photo as a JPEG, anything else as it is. */
export async function uploadable(file: File): Promise<File> {
  return isHeic(file) ? heicToJpeg(file) : file;
}

const RECEIPT_FILE = /^[0-9a-f-]{36}\/[A-Za-z0-9_.-]{1,100}$/;

/**
 * Whether a receipt path is one of this member's own uploads, written exactly as the forms write
 * them: `<their id>/<random uuid>/<letters, digits, _ . ->`, with no "..". Anything else (a "%2e%2e",
 * a backslash, a query) is refused before the path reaches Storage, whose URL handling could
 * otherwise resolve it to someone else's file.
 */
export function isOwnReceiptPath(path: string, uid: string): boolean {
  if (!path.startsWith(`${uid}/`) || path.includes("..")) return false;
  return RECEIPT_FILE.test(path.slice(uid.length + 1));
}
