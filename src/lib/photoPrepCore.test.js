import { describe, it, expect } from "vitest";
import { targetDimensions, MAX_DIMENSION, JPEG_QUALITY } from "./photoPrepCore.js";

describe("targetDimensions", () => {
  it("scales the long edge down to the max, preserving aspect ratio", () => {
    expect(targetDimensions(5120, 2560)).toEqual({ width: 2560, height: 1280 });
    expect(targetDimensions(2560, 5120)).toEqual({ width: 1280, height: 2560 });
  });

  it("rounds to whole pixels", () => {
    const { width, height } = targetDimensions(4032, 3024);
    expect(width).toBe(2560);
    expect(height).toBe(1920);
    expect(Number.isInteger(height)).toBe(true);
  });

  it("never upscales", () => {
    expect(targetDimensions(800, 600)).toEqual({ width: 800, height: 600 });
    expect(targetDimensions(MAX_DIMENSION, MAX_DIMENSION)).toEqual({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
    });
  });

  it("keeps at least 1px on degenerate inputs", () => {
    expect(targetDimensions(10000, 1)).toEqual({ width: 2560, height: 1 });
  });

  it("honors a custom max", () => {
    expect(targetDimensions(1000, 500, 100)).toEqual({ width: 100, height: 50 });
  });
});

describe("constants", () => {
  it("uses the agreed downscale settings", () => {
    expect(MAX_DIMENSION).toBe(2560);
    expect(JPEG_QUALITY).toBeCloseTo(0.82);
  });
});
