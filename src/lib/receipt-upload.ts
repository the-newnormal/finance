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

export { MAX_HEIC_BYTES, MAX_HEIC_PIXELS } from "./receipt-heic-limits";
import { MAX_HEIC_BYTES } from "./receipt-heic-limits";

const HEIC_TIMEOUT_MS = 30_000;

/** A HEIC or HEIF photo as a JPEG, named for it. */
export async function heicToJpeg(file: File): Promise<File> {
  if (file.size > MAX_HEIC_BYTES) throw new Error("heic too large");
  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL("./receipt-heic-worker.ts", import.meta.url), { type: "module" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let image: ImageData;
  try {
    image = await new Promise<ImageData>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("heic conversion timed out")), HEIC_TIMEOUT_MS);
      worker.onmessage = ({ data }: MessageEvent<{ image?: ImageData; error?: string }>) => {
        if (data.image) resolve(data.image);
        else reject(new Error(data.error || "heic conversion failed"));
      };
      worker.onerror = () => reject(new Error("heic conversion failed"));
      worker.onmessageerror = () => reject(new Error("heic conversion failed"));
      worker.postMessage(buffer, [buffer]);
    });
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
  const canvas = document.createElement("canvas");
  try {
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.putImageData(image, 0, 0);
    const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("JPEG conversion failed")), "image/jpeg", 0.9,
    ));
    const name = `${file.name.replace(/\.hei[cf]$/i, "")}.jpg`;
    return new File([jpeg], name, { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
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
