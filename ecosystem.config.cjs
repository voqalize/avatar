/** PM2 entrypoint for the local Avatar Studio authoring environment. */
module.exports = {
  apps: [
    {
      name: "avatar-studio",
      cwd: __dirname,
      script: "npm",
      args: "--prefix studio run dev",
      interpreter: "none",
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "development",
        AVATAR_STUDIO_PORT: "4173",
      },
    },
  ],
};
