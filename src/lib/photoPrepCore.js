// Pure math for the client-side photo downscale (guest photowall, #138) —
// kept separate from photoPrep.js so it is testable in the node test env
// (no canvas/DOM).

// Long-edge cap for re-encoded guest photos: keeps a 12 MB phone photo around
// ~1 MB while staying plenty sharp for a gallery wall.
export const MAX_DIMENSION = 2560;
export const JPEG_QUALITY = 0.82;

// Scale (never up) so the longest edge fits max, preserving aspect ratio.
export function targetDimensions(width, height, max = MAX_DIMENSION) {
  const longEdge = Math.max(width, height);
  if (longEdge <= max) return { width, height };
  const scale = max / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
