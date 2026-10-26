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

/** A HEIC or HEIF photo as a JPEG, named for it ("IMG_1234.HEIC" → "IMG_1234.jpg"). Throws if it can't be read. */
export async function heicToJpeg(file: File): Promise<File> {
  const { heicTo } = await import("heic-to"); // about 3 MB, so only loaded when a HEIC photo is chosen
  const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
  const name = `${file.name.replace(/\.hei[cf]$/i, "")}.jpg`;
  return new File([jpeg], name, { type: "image/jpeg", lastModified: file.lastModified });
}

/** The file to upload for one that was chosen: a HEIC or HEIF photo as a JPEG, anything else as it is. */
export async function uploadable(file: File): Promise<File> {
  return isHeic(file) ? heicToJpeg(file) : file;
}
