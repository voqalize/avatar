/**
 * pm2 entrypoint for the one local surface this repository has.
 *
 * `apps/server/` is the pipecat demo call: canned LLM and TTS behind the real
 * pipecat interfaces, zero API keys, and the only place lipsync is ever judged.
 *
 * Studio and the rig workshop are not here — they are part of the working tree,
 * which is private (CONTRIBUTING.md). They are also clients of this server
 * rather than second servers, so the arrangement survives the split unchanged:
 * Studio's `/api` proxy sends its offer to the port below, from whichever
 * checkout it is running in.
 *
 * Ports are declared HERE and nowhere else — no config file in this repo names
 * one. The local nginx (/opt/homebrew/etc/nginx/servers/voqalize.conf) has the
 * same numbers written out; change one, change the other in the same commit.
 */

'use strict';

const SERVER_PORT = 7860;

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
  ],
};
