// Client-side photo preparation for the guest photowall (#138): every upload
// is re-encoded through a canvas, which (a) strips ALL metadata — EXIF, GPS,
// serial numbers — and (b) downscales phone photos to gallery size so uploads
// stay fast on venue Wi-Fi. DOM/canvas code is deliberately thin; the testable
// math lives in photoPrepCore.js.
import { targetDimensions, JPEG_QUALITY } from "./photoPrepCore.js";

async function decodeToBitmap(file) {
  if (typeof createImageBitmap === "function") {
    // imageOrientation bakes the EXIF rotation into the pixels — without it,
    // portrait phone photos re-encode sideways (orientation tag is gone after
    // the canvas strip).
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  // Fallback: modern browsers apply EXIF orientation to natural dimensions.
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

// -> { blob, contentType: "image/jpeg", width, height }
// Throws Error with .code = "unsupported_image" when the browser can't decode
// the file (e.g. HEIC outside Safari).
export async function prepareImage(file) {
  let source;
  try {
    source = await decodeToBitmap(file);
  } catch {
    const err = new Error("cannot decode image");
    err.code = "unsupported_image";
    throw err;
  }

  const srcWidth = source.width || source.naturalWidth;
  const srcHeight = source.height || source.naturalHeight;
  const { width, height } = targetDimensions(srcWidth, srcHeight);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(source, 0, 0, width, height);
  if (typeof source.close === "function") source.close();

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) {
    const err = new Error("re-encode failed");
    err.code = "unsupported_image";
    throw err;
  }
  return { blob, contentType: "image/jpeg", width, height };
}
