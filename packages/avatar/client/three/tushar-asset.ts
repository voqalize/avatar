/**
 * Where tushar's compiled GLB is. One character, one module — see
 * [tara-asset.ts](./tara-asset.ts) for why that separation is load-bearing and
 * why the `new URL` literal is spelled exactly this way.
 */
export const TUSHAR_GLB = new URL("../../assets/tushar.glb", import.meta.url).href;
