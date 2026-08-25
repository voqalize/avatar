/**
 * The close webcam crop shared by every avatar renderer.
 *
 * The head gets most of the tile because lip sync and listening expressions
 * are the information the avatar is there to carry. The remaining lower band
 * leaves enough neck and shoulder for posture to read without turning the
 * call tile into a half-body portrait.
 */
export const CALL_CAMERA = Object.freeze({
  aspect: 4 / 3,
  headroom: 0.06,
  head: 0.70,
  body: 0.24,
});

/** Derive a camera rectangle from three landmarks in the drawing's own units. */
export function viewBoxForHead({ centerX, crownY, chinY }) {
  if (![centerX, crownY, chinY].every(Number.isFinite) || chinY <= crownY) {
    throw new TypeError('viewBoxForHead: expected a finite centre and crown above chin');
  }
  const h = (chinY - crownY) / CALL_CAMERA.head;
  const w = h * CALL_CAMERA.aspect;
  return {
    x: centerX - w / 2,
    y: crownY - h * CALL_CAMERA.headroom,
    w,
    h,
  };
}
