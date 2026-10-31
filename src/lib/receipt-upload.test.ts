import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { heicToJpeg, isHeic, isOwnReceiptPath, MAX_HEIC_BYTES, uploadable } from "./receipt-upload";

const file = (name: string, type: string) => new File(["x"], name, { type, lastModified: 1 });
const heic = (name: string, type: string) => file(name, type);

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: { image?: ImageData; error?: string } }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(public url: URL, public options: WorkerOptions) { FakeWorker.instances.push(this); }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("document", { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ putImageData: vi.fn() }),
    toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["jpeg"], { type: "image/jpeg" })),
  }) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function startedWorker() {
  // File.arrayBuffer() completes asynchronously before the worker is created.
  await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
  return FakeWorker.instances[0];
}

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
  it("makes a JPEG named for the photo and terminates the worker", async () => {
    const pending = heicToJpeg(heic("IMG_1234.HEIC", ""));
    const worker = await startedWorker();
    worker.onmessage!({ data: { image: { width: 2, height: 2 } as ImageData } });
    const jpeg = await pending;
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(jpeg).toMatchObject({ name: "IMG_1234.jpg", type: "image/jpeg", lastModified: 1 });
    expect(await jpeg.text()).toBe("jpeg");
  });

  it("terminates the worker when decoding fails", async () => {
    const pending = expect(heicToJpeg(heic("broken.heic", "image/heic"))).rejects.toThrow();
    const worker = await startedWorker();
    worker.onmessage!({ data: { error: "bad image" } });
    await pending;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("refuses a file too large before starting a worker", async () => {
    const huge = heic("huge.heic", "image/heic");
    Object.defineProperty(huge, "size", { value: MAX_HEIC_BYTES + 1 });
    await expect(heicToJpeg(huge)).rejects.toThrow();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("terminates a worker when conversion takes too long", async () => {
    vi.useFakeTimers();
    const pending = expect(heicToJpeg(heic("slow.heic", "image/heic"))).rejects.toThrow("timed out");
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(worker.terminate).toHaveBeenCalledOnce();
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
    const pending = uploadable(heic("IMG_1.heic", ""));
    const worker = await startedWorker();
    worker.onmessage!({ data: { image: { width: 2, height: 2 } as ImageData } });
    expect((await pending).name).toBe("IMG_1.jpg");
  });
});
