/** Measurable limits for one 3-D avatar at its shipping surface. */
export const SHIPPING_SURFACE = Object.freeze({
  cssWidth: 400,
  cssHeight: 300,
  maxDevicePixelRatio: 2,
});

/** Keep the physical drawing buffer inside the shipping ceiling at any mount size. */
export function pixelRatioFor(width: number, height: number, devicePixelRatio: number): number {
  const maxWidth = SHIPPING_SURFACE.cssWidth * SHIPPING_SURFACE.maxDevicePixelRatio;
  const maxHeight = SHIPPING_SURFACE.cssHeight * SHIPPING_SURFACE.maxDevicePixelRatio;
  return Math.max(0.1, Math.min(
    SHIPPING_SURFACE.maxDevicePixelRatio,
    devicePixelRatio,
    maxWidth / Math.max(1, width),
    maxHeight / Math.max(1, height),
  ));
}

/** Crossing one of these is a failed asset/runtime review, not a suggestion. */
export const HARD_BUDGET = Object.freeze({
  assetBytes: 6 * 1024 * 1024,
  triangles: 60_000,
  drawCalls: 30,
  bones: 40,
  morphTargets: 40,
});
