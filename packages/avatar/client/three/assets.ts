/**
 * Where the three compiled characters are, resolved against this module's own
 * location.
 *
 * `new URL(…, import.meta.url)` and not a bundler's asset import: these files
 * are fetched at runtime by a consumer's app, and the spelling has to survive
 * Vite, webpack, Rollup, esbuild, a plain `tsc` output and a browser loading
 * the module directly. The query-suffix form this used to carry is Vite syntax —
 * every other toolchain, including the compiler that now builds this directory,
 * passes it through verbatim and produces an import of a file that is not there.
 *
 * The depth is the same from the source tree and from the compiled one
 * (`client/three/` and `dist/three/` are siblings), so one literal is correct in
 * both — and literal is load-bearing, because a bundler can only follow this
 * pattern when it can read the path without running anything.
 */
export const ASSETS = Object.freeze({
  tara: new URL("../../assets/tara.glb", import.meta.url).href,
  tushar: new URL("../../assets/tushar.glb", import.meta.url).href,
  tanya: new URL("../../assets/tanya.glb", import.meta.url).href,
});

/** Every compiled character, in build order. */
export type CharacterName = keyof typeof ASSETS;
