import { MAX_HEIC_PIXELS } from "./receipt-heic-limits";

// The pinned heic-to build uses Emscripten's embind for context objects, but exposes the
// security-limit setter as a raw C function. Its pointer is needed before reading the file.
type Context = { $$: { ptr: number } };
type Image = {
  get_width(): number;
  get_height(): number;
  display(data: ImageData, callback: (data: ImageData | null) => void): void;
  free(): void;
};
type Handle = object & { code?: unknown };
export type HeifLibrary = {
  heif_context_alloc(): Context | null;
  heif_context_free(context: Context): void;
  heif_context_set_maximum_image_size_limit(context: number, width: number): void;
  heif_context_read_from_memory(context: Context, buffer: ArrayBuffer): { code: unknown };
  heif_error_code: { heif_error_Ok: unknown };
  heif_js_context_get_list_of_top_level_image_IDs(context: Context): number[] | { code: unknown };
  heif_js_context_get_image_handle(context: Context, id: number): Handle | null;
  HeifImage: new (handle: Handle) => Image;
};

/** Decode only after libheif has a pixel limit for coded and derived images. */
export async function decodeHeic(lib: HeifLibrary, buffer: ArrayBuffer): Promise<ImageData> {
  const context = lib.heif_context_alloc();
  if (!context) throw new Error("HEIF context unavailable");
  let image: Image | undefined;
  try {
    // This API takes a maximum width and squares it. Round down to stay within the budget.
    if (!Number.isInteger(context.$$.ptr) || context.$$.ptr <= 0) throw new Error("HEIF context unavailable");
    lib.heif_context_set_maximum_image_size_limit(context.$$.ptr, Math.floor(Math.sqrt(MAX_HEIC_PIXELS)));
    const result = lib.heif_context_read_from_memory(context, buffer);
    if (result.code !== lib.heif_error_code.heif_error_Ok) throw new Error("HEIF file unreadable");
    const ids = lib.heif_js_context_get_list_of_top_level_image_IDs(context);
    if (!Array.isArray(ids)) throw new Error("HEIF image unavailable");
    for (const id of ids) {
      const handle = lib.heif_js_context_get_image_handle(context, id);
      if (handle && !handle.code) { image = new lib.HeifImage(handle); break; }
    }
    if (!image) throw new Error("HEIF image unavailable");
    const width = image.get_width();
    const height = image.get_height();
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_HEIC_PIXELS) {
      throw new Error("HEIF image too large");
    }
    const pixels = new ImageData(width, height);
    for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
    return await new Promise((resolve, reject) => {
      image!.display(pixels, (data) => data ? resolve(data) : reject(new Error("HEIF decoding failed")));
    });
  } finally {
    image?.free();
    lib.heif_context_free(context);
  }
}
