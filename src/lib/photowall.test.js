import { describe, it, expect } from "vitest";
import {
  MAX_UPLOADER_NAME,
  MAX_CAPTION,
  ACCEPTED_INPUT_TYPES,
  cleanUploaderName,
  cleanCaption,
  photowallErrorKey,
} from "./photowall.js";

describe("cleanUploaderName / cleanCaption", () => {
  it("trims and clamps to the server limits", () => {
    expect(cleanUploaderName("  Aunty May  ")).toBe("Aunty May");
    expect(cleanUploaderName("x".repeat(200))).toHaveLength(MAX_UPLOADER_NAME);
    expect(cleanCaption("x".repeat(500))).toHaveLength(MAX_CAPTION);
  });

  it("returns empty string for nullish input", () => {
    expect(cleanUploaderName(null)).toBe("");
    expect(cleanCaption(undefined)).toBe("");
  });
});

describe("photowallErrorKey", () => {
  it("maps every server error code to its i18n key", () => {
    expect(photowallErrorKey("invalid_pin")).toBe("wedding.photowall.err.pinInvalid");
    expect(photowallErrorKey("too_many_attempts")).toBe("wedding.photowall.err.tooManyAttempts");
    expect(photowallErrorKey("photowall_disabled")).toBe("wedding.photowall.err.disabled");
    expect(photowallErrorKey("photowall_full")).toBe("wedding.photowall.err.full");
    expect(photowallErrorKey("too_large")).toBe("wedding.photowall.err.tooLarge");
    expect(photowallErrorKey("bad_type")).toBe("wedding.photowall.err.badType");
    expect(photowallErrorKey("unsupported_image")).toBe("wedding.photowall.err.unsupported");
    expect(photowallErrorKey("upload_not_found")).toBe("wedding.photowall.err.uploadFailed");
  });

  it("falls back to the generic key for unknown codes", () => {
    expect(photowallErrorKey("weird")).toBe("wedding.photowall.err.generic");
    expect(photowallErrorKey(undefined)).toBe("wedding.photowall.err.generic");
  });
});

describe("constants", () => {
  it("keeps client limits in sync with the server module", () => {
    expect(MAX_UPLOADER_NAME).toBe(80);
    expect(MAX_CAPTION).toBe(280);
  });

  it("accepts the camera/gallery types the prep step can decode", () => {
    expect(ACCEPTED_INPUT_TYPES).toContain("image/jpeg");
    expect(ACCEPTED_INPUT_TYPES).toContain("image/png");
    expect(ACCEPTED_INPUT_TYPES).toContain("image/webp");
    expect(ACCEPTED_INPUT_TYPES).toContain("image/heic");
  });
});
