import { heicTo } from "heic-to";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { heicToJpeg, isHeic, uploadable } from "./receipt-upload";

vi.mock("heic-to", () => ({ heicTo: vi.fn() }));

const file = (name: string, type: string) => new File(["x"], name, { type, lastModified: 1 });

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
    const jpeg = await heicToJpeg(file("IMG_1234.HEIC", ""));
    expect(heicTo).toHaveBeenCalledWith({ blob: expect.any(File), type: "image/jpeg", quality: 0.9 });
    expect(jpeg).toMatchObject({ name: "IMG_1234.jpg", type: "image/jpeg", lastModified: 1 });
    expect(await jpeg.text()).toBe("jpeg");
  });

  it("fails when the photo can't be read", async () => {
    vi.mocked(heicTo).mockRejectedValue(new Error("unsupported"));
    await expect(heicToJpeg(file("IMG_1.heic", "image/heic"))).rejects.toThrow();
  });
});

describe("uploadable", () => {
  it("converts only HEIC photos", async () => {
    const jpg = file("receipt.jpg", "image/jpeg");
    expect(await uploadable(jpg)).toBe(jpg);
    expect((await uploadable(file("IMG_1.heic", ""))).name).toBe("IMG_1.jpg");
    expect(heicTo).toHaveBeenCalledTimes(1);
  });
});
