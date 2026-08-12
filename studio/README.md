# Avatar Studio

The local authoring and integration workbench for the SVG avatar runtime.

```sh
npm install
npm run dev
# or, from the repository root:
pm2 start ecosystem.config.cjs
```

Open <http://127.0.0.1:4173/#/rig/review>.

Studio has five contract routes plus a shared speech-fixture route:

- `#/rig/review` — inspect raw pose extremes and renderer conformance.
- `#/rig/visemes` — inspect individual visemes and curated transitions.
- `#/behavior` — exercise durable client states and finite library actions.
- `#/wire` — send the production avatar envelope and emulate factual Pipecat lifecycle events.
- `#/connection` — persist a backend connection profile locally and attach an actual Pipecat client supplied by the host.
- `#/fixtures` — play checked-in WAV/cue pairs through the same lifecycle path as a real response.

Fixtures are shared evidence: avatar authors use them to assess articulation,
while wire developers use them to assess real cue/lifecycle alignment.

## Real Pipecat connections

`@pipecat-ai/client-js` is client/transport neutral: a URL alone does not define a transport. Studio therefore does not guess whether a deployment uses Daily, WebSocket, or a custom transport. It stores the endpoint and credentials locally for the deployment, and an integration can attach its constructed `PipecatClient` in the browser console or a host adapter:

```js
window.avatarStudio.attachPipecat(pipecatClient)
```

The attached client supplies standard Pipecat lifecycle events; server messages use the production avatar wire envelope described in `../docs/contract-protocol.md`.
