import buildLibheif from "heic-to/libheif";
import { decodeHeic, type HeifLibrary } from "./receipt-heic-decoder";

const worker = self as unknown as {
  onmessage: (event: MessageEvent<ArrayBuffer>) => void;
  postMessage(message: { image?: ImageData; error?: string }): void;
};

worker.onmessage = async ({ data }) => {
  try {
    const image = await decodeHeic(buildLibheif() as HeifLibrary, data);
    worker.postMessage({ image });
  } catch {
    worker.postMessage({ error: "HEIF decoding failed" });
  }
};
