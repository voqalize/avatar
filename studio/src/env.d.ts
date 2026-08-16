/**
 * The one build-time constant this page has.
 *
 * `vite.config.ts` substitutes it, so the "start the server" message names the
 * URL `/api` is actually proxied to rather than a hard-coded guess at it.
 */
interface ImportMetaEnv {
  readonly VITE_AVATAR_SERVER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
