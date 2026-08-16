/**
 * PM2 entrypoint for the three local surfaces.
 *
 * Studio is a client of `apps/server/`, not a second server: its `/api` proxy
 * points at 7860, so running `avatar-studio` without `avatar-server` gives a
 * page that mounts and can never connect. They start and stop together.
 *
 * `avatar-authoring` is the static workshop, and it must be served by
 * `apps/authoring/serve.py` rather than `python3 -m http.server` — the stdlib
 * server sends `Last-Modified` with no `Cache-Control`, so browsers stop
 * revalidating modules you have edited.
 */
module.exports = {
  apps: [
    {
      name: "avatar-server",
      cwd: __dirname + "/packages/avatar-py",
      script: "uv",
      args: "run --group server python ../../apps/server/server.py",
      interpreter: "none",
      autorestart: true,
      watch: false,
    },
    {
      name: "avatar-studio",
      cwd: __dirname,
      script: "npm",
      args: "--prefix apps/studio run dev",
      interpreter: "none",
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "development",
        AVATAR_STUDIO_PORT: "4173",
      },
    },
    {
      name: "avatar-authoring",
      cwd: __dirname,
      script: "python3",
      args: "apps/authoring/serve.py 8777",
      interpreter: "none",
      autorestart: true,
      watch: false,
    },
  ],
};
