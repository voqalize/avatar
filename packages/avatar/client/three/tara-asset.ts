/**
 * Where tara's compiled GLB is — one character, one module, on purpose.
 *
 * `new URL(…, import.meta.url)` and not a bundler's asset import: these files
 * are fetched at runtime by a consumer's app, and the spelling has to survive
 * Vite, webpack, Rollup, esbuild, a plain `tsc` output and a browser loading the
 * module directly. The query-suffix form this used to carry is Vite syntax —
 * every other toolchain, including the compiler that now builds this directory,
 * passes it through verbatim and produces an import of a file that is not there.
 *
 * The depth is the same from the source tree and from the compiled one
 * (`client/three/` and `dist/three/` are siblings), so one literal is correct in
 * both — and literal is load-bearing, because a bundler can only follow this
 * pattern when it can read the path without running anything.
 *
 * **One module per character is the whole point, and it is a bundling fact, not
 * tidiness.** A bundler that can follow `new URL` emits the file it names, and
 * it decides what to emit per *module*: three literals in one object meant a
 * consumer who imported one character shipped all three GLBs — ~1.3 MB of a
 * character they never mount, in every build we checked. Splitting them is what
 * makes `@voqalize/avatar/avatars/tara` cost tara. Nothing that a character
 * module loads may reach for another character's URL, which is also why the rig
 * takes its `url` from its caller instead of defaulting to tara's.
 */
export const TARA_GLB = new URL("../../assets/tara.glb", import.meta.url).href;
