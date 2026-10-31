import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeHeic, type HeifLibrary } from "./receipt-heic-decoder";
import { MAX_HEIC_PIXELS } from "./receipt-heic-limits";

function library(width: number, height: number) {
  const context = { $$: { ptr: 123 } };
  const image = {
    get_width: () => width, get_height: () => height,
    display: vi.fn((data: ImageData, callback: (data: ImageData | null) => void) => callback(data)),
    free: vi.fn(),
  };
  const lib = {
    heif_context_alloc: vi.fn(() => context), heif_context_free: vi.fn(),
    heif_context_set_maximum_image_size_limit: vi.fn(),
    heif_context_read_from_memory: vi.fn(() => ({ code: 0 })),
    heif_error_code: { heif_error_Ok: 0 },
    heif_js_context_get_list_of_top_level_image_IDs: vi.fn(() => [1]),
    heif_js_context_get_image_handle: vi.fn(() => ({})),
    HeifImage: vi.fn(function () { return image; }),
  };
  return { lib, context, image };
}

afterEach(() => vi.unstubAllGlobals());

describe("decodeHeic", () => {
  it("sets libheif's pixel limit before parsing and decodes within the limit", async () => {
    const { lib, context, image } = library(3, 2);
    const ImageDataMock = vi.fn(function (width: number, height: number) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    });
    vi.stubGlobal("ImageData", ImageDataMock);
    const decoded = await decodeHeic(lib as unknown as HeifLibrary, new ArrayBuffer(1));
    expect(lib.heif_context_set_maximum_image_size_limit).toHaveBeenCalledWith(context.$$.ptr, Math.floor(Math.sqrt(MAX_HEIC_PIXELS)));
    expect(lib.heif_context_set_maximum_image_size_limit.mock.invocationCallOrder[0]).toBeLessThan(lib.heif_context_read_from_memory.mock.invocationCallOrder[0]);
    expect(decoded.data[3]).toBe(255);
    expect(image.display).toHaveBeenCalledOnce();
    expect(image.free).toHaveBeenCalledOnce();
    expect(lib.heif_context_free).toHaveBeenCalledWith(context);
  });

  it("frees the image and context when libheif refuses decoding", async () => {
    const { lib, image, context } = library(3, 2);
    vi.stubGlobal("ImageData", function (width: number, height: number) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    });
    image.display.mockImplementation((_data, callback) => callback(null));
    await expect(decodeHeic(lib as unknown as HeifLibrary, new ArrayBuffer(1))).rejects.toThrow("decoding failed");
    expect(image.free).toHaveBeenCalledOnce();
    expect(lib.heif_context_free).toHaveBeenCalledWith(context);
  });

  it.each([[100_000, 100_000], [0, 1]])("rejects dimensions %ix%i before allocating pixels", async (width, height) => {
    const { lib, image, context } = library(width, height);
    const ImageDataMock = vi.fn();
    vi.stubGlobal("ImageData", ImageDataMock);
    await expect(decodeHeic(lib as unknown as HeifLibrary, new ArrayBuffer(1))).rejects.toThrow();
    expect(ImageDataMock).not.toHaveBeenCalled();
    expect(image.display).not.toHaveBeenCalled();
    expect(image.free).toHaveBeenCalledOnce();
    expect(lib.heif_context_free).toHaveBeenCalledWith(context);
  });
});
