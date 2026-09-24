/**
 * Where tanvi's compiled GLB is. One character, one module — see
 * [tara-asset.ts](./tara-asset.ts) for why that separation is load-bearing and
 * why the `new URL` literal is spelled exactly this way.
 */
export const TANVI_GLB = new URL("../../assets/tanvi.glb", import.meta.url).href;
