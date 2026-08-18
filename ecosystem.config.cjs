/**
 * pm2 entrypoint for the three local surfaces.
 *
 * Studio is a client of `apps/server/`, not a second server: its `/api` proxy
 * points at the server below, so running `avatar-studio` without `avatar-server`
 * gives a page that mounts and can never connect. They start and stop together.
 *
 * `avatar-authoring` is the static workshop, and it must be served by
 * `apps/authoring/serve.py` rather than `python3 -m http.server` — the stdlib
 * server sends `Last-Modified` with no `Cache-Control`, so browsers stop
 * revalidating modules you have edited.
 *
 * Ports are declared HERE and nowhere else — no config file in this repo names
 * one. The local nginx (/opt/homebrew/etc/nginx/servers/voqalize.conf) has the
 * same numbers written out; change one, change the other in the same commit.
 */

'use strict';

// Bind IPv4 loopback explicitly. A vite/astro dev server left on its default
// `localhost` binds ::1 only on macOS, and nginx proxies to 127.0.0.1 — the
// symptom is a 502 from a process pm2 swears is online.
const HOST = '127.0.0.1';

const SERVER_PORT = 7860;
const STUDIO_PORT = 4173;
const AUTHORING_PORT = 8777;

module.exports = {
  apps: [
    {
      name: "avatar-server",
      cwd: __dirname + "/packages/avatar-py",
      script: "uv",
      args: `run --group server python ../../apps/server/server.py --port ${SERVER_PORT}`,
      interpreter: "none",
      autorestart: true,
      watch: false,
    },
    {
      name: "avatar-studio",
      cwd: __dirname,
      script: "pnpm",
      args: `--filter @voqalize/avatar-studio exec vite --host ${HOST} --port ${STUDIO_PORT} --strictPort`,
      interpreter: "none",
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "development",
        // Where the studio's /api proxy sends the SDP offer.
        AVATAR_SERVER_URL: `http://${HOST}:${SERVER_PORT}`,
      },
    },
    {
      name: "avatar-authoring",
      cwd: __dirname,
      script: "python3",
      args: `apps/authoring/serve.py ${AUTHORING_PORT}`,
      interpreter: "none",
      autorestart: true,
      watch: false,
    },
  ],
};
