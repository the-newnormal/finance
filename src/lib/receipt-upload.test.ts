import { heicTo } from "heic-to";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { heicPixels, heicToJpeg, isHeic, isOwnReceiptPath, MAX_HEIC_BYTES, uploadable } from "./receipt-upload";

vi.mock("heic-to", () => ({ heicTo: vi.fn() }));

const file = (name: string, type: string) => new File(["x"], name, { type, lastModified: 1 });

/** HEIC-like bytes with an 'ispe' box declaring the image's width and height. */
function ispe(width: number, height: number) {
  const bytes = new Uint8Array(40);
  bytes.set([0x69, 0x73, 0x70, 0x65], 20); // "ispe", then 4 bytes of version and flags
  const view = new DataView(bytes.buffer);
  view.setUint32(28, width);
  view.setUint32(32, height);
  return bytes;
}
const heic = (name: string, type: string, width = 4032, height = 3024) =>
  new File([ispe(width, height)], name, { type, lastModified: 1 });

beforeEach(() => {
  vi.mocked(heicTo).mockReset().mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }) as never);
});

describe("isHeic", () => {
  it("knows HEIC and HEIF photos by their type", () => {
    expect(isHeic(file("IMG_1.HEIC", "image/heic"))).toBe(true);
    expect(isHeic(file("photo", "image/heif"))).toBe(true);
    expect(isHeic(file("burst.heic", "image/heic-sequence"))).toBe(true);
  });

  it("knows them by their name when the browser gives no type", () => {
    expect(isHeic(file("IMG_1.HEIC", ""))).toBe(true);
    expect(isHeic(file("IMG_1.heif", "application/octet-stream"))).toBe(true);
  });

  it("leaves other files alone, whatever they're named", () => {
    expect(isHeic(file("receipt.jpg", "image/jpeg"))).toBe(false);
    expect(isHeic(file("receipt.pdf", "application/pdf"))).toBe(false);
    expect(isHeic(file("scan.heic", "image/jpeg"))).toBe(false);
    expect(isHeic(file("notes.txt", ""))).toBe(false);
  });
});

describe("heicToJpeg", () => {
  it("makes a JPEG named for the photo", async () => {
    const jpeg = await heicToJpeg(heic("IMG_1234.HEIC", ""));
    expect(heicTo).toHaveBeenCalledWith({ blob: expect.any(File), type: "image/jpeg", quality: 0.9 });
    expect(jpeg).toMatchObject({ name: "IMG_1234.jpg", type: "image/jpeg", lastModified: 1 });
    expect(await jpeg.text()).toBe("jpeg");
  });

  it("fails when the photo can't be read", async () => {
    vi.mocked(heicTo).mockRejectedValue(new Error("unsupported"));
    await expect(heicToJpeg(heic("IMG_1.heic", "image/heic"))).rejects.toThrow();
  });

  it("refuses, before converting, a photo declaring too many pixels or none", async () => {
    await expect(heicToJpeg(heic("big.heic", "image/heic", 100_000, 100_000))).rejects.toThrow();
    await expect(heicToJpeg(file("unknown.heic", "image/heic"))).rejects.toThrow();
    expect(heicTo).not.toHaveBeenCalled();
  });

  it("refuses a file too large to be a phone photo", async () => {
    const huge = heic("huge.heic", "image/heic");
    Object.defineProperty(huge, "size", { value: MAX_HEIC_BYTES + 1 });
    await expect(heicToJpeg(huge)).rejects.toThrow();
    expect(heicTo).not.toHaveBeenCalled();
  });

  it("gives up on a conversion that never finishes", async () => {
    vi.useFakeTimers();
    vi.mocked(heicTo).mockReturnValue(new Promise(() => {}) as never);
    const pending = expect(heicToJpeg(heic("slow.heic", "image/heic"))).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    vi.useRealTimers();
  });
});

describe("heicPixels", () => {
  it("reads the declared size, and null without one", () => {
    expect(heicPixels(ispe(4032, 3024))).toBe(4032 * 3024);
    expect(heicPixels(new Uint8Array(64))).toBeNull();
  });
});

describe("isOwnReceiptPath", () => {
  const uid = "00000000-0000-4000-8000-000000000001";
  const folder = "6f1c2a9e-0b7d-4c3e-9a5f-1d2e3f4a5b6c";
  it("accepts the member's own uploads, as the forms write them", () => {
    expect(isOwnReceiptPath(`${uid}/${folder}/1a2b3c4d-receipt.jpg`, uid)).toBe(true);
  });
  it.each([
    `00000000-0000-4000-8000-000000000002/${folder}/r.jpg`,
    `${uid}/../other/r.jpg`,
    `${uid}/${folder}/%2e%2e/r.jpg`,
    `${uid}/${folder}/..%2fr.jpg`,
    `${uid}/${folder}/r.jpg?x=1`,
    `${uid}/${folder}\\r.jpg`,
    `${uid}/r.jpg`,
  ])("refuses %s", (p) => expect(isOwnReceiptPath(p, uid)).toBe(false));
});

describe("uploadable", () => {
  it("converts only HEIC photos", async () => {
    const jpg = file("receipt.jpg", "image/jpeg");
    expect(await uploadable(jpg)).toBe(jpg);
    expect((await uploadable(heic("IMG_1.heic", ""))).name).toBe("IMG_1.jpg");
    expect(heicTo).toHaveBeenCalledTimes(1);
  });
});
