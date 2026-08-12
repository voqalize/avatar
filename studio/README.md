# Avatar Studio

The local authoring and integration workbench for avatar runtimes. SVG is the
current built-in renderer, not a requirement of the Studio or its contracts.

```sh
npm install
npm run dev
# or, from the repository root:
pm2 start ecosystem.config.cjs
```

Open <http://127.0.0.1:4173/#/rig/review>.

Studio has review routes at each ownership layer, plus integration routes:

- `#/rig/review` — inspect raw pose extremes and renderer conformance.
- `#/rig/visemes` — inspect individual visemes and curated transitions.
- `#/rig/gestures` — inspect deterministic hand/face filmstrips for every
  visible gesture, including entry and exit frames.
- `#/behavior` — exercise durable client states and finite library actions.
- `#/wire` — send the production avatar envelope and emulate factual Pipecat lifecycle events.
- `#/connection` — persist a backend connection profile locally and attach an actual Pipecat client supplied by the host.
- `#/fixtures` — play checked-in WAV/cue pairs through the same lifecycle path as a real response.

Fixtures are shared evidence: avatar authors use them to assess articulation,
while wire developers use them to assess real cue/lifecycle alignment.

## Authoring workflow

The Studio is ordered by the layer that owns a decision. Start at the renderer,
then move upward only after the lower layer is sound:

1. **Rig review** is a deterministic contact sheet of the shared raw pose
   controls. Select a card to inspect the same frame in the live stage. A card
   should have a distinct silhouette at normal tile size; if it does not, fix
   the renderer rather than adding behavior-layer compensation.
2. **Rig visemes** is the corresponding mouth sheet plus the transition
   sequences that reveal closure failures and shape bleed. The review-sheet
   cards are fixed frames; the transition controls exercise the live smoother.
3. **Gesture review** verifies the hand and matching face timeline as a
   sequence. A final pose is not sufficient evidence: entry, readable hold,
   and exit must all survive at normal tile size.
4. **Behavior** evaluates durable client states and finite actions, assuming
   the selected avatar has passed its lower-level review.
5. **Wire Lab** exercises only the narrow production envelope and Pipecat
   lifecycle facts. **Fixtures** is the end-to-end audio/cue check.

## Real Pipecat connections

`@pipecat-ai/client-js` is client/transport neutral: a URL alone does not define a transport. Studio therefore does not guess whether a deployment uses Daily, WebSocket, or a custom transport. It stores the endpoint and credentials locally for the deployment, and an integration can attach its constructed `PipecatClient` in the browser console or a host adapter:

```js
window.avatarStudio.attachPipecat(pipecatClient)
```

The attached client supplies standard Pipecat lifecycle events; server messages use the production avatar wire envelope described in `../docs/contract-protocol.md`.
