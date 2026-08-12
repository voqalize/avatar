# Presence director

> **Legacy experimental helper.** The behavior controller described in
> [contract-behavior.md](contract-behavior.md) is the runtime authority. This
> director is retained as a reference reel while its useful work program and
> action choreography migrate into the behavior catalog; do not add new host
> integrations to it.

`createPresenceDirector(avatar)` is an optional, application-level conductor
for the existing SVG avatar API. It does not add SVG parts, introduce a new
wire protocol, or require per-avatar state art. Its job is to turn meaningful
conversation and tool-lifecycle moments into combinations of the states and
clips every shipped avatar already supports.

## Why this exists

The avatar itself knows how to render `LISTENING`, `THINKING`, `TYPING`, gaze,
visemes, nods, and floor handoff. It cannot know whether a raw VAD pause was a
completed thought, whether a tool is genuinely running, or whether the host is
waiting for approval. That information belongs to the application.

The director is the small bridge between those semantic moments and the
existing avatar methods. It keeps that policy out of individual SVG modules,
which is essential when the product needs many customer-specific avatars.

## Use

```js
import { createAvatar, createPresenceDirector } from './src/avatar.js';

const avatar = createAvatar({ mount });
const presence = createPresenceDirector(avatar);

// VAD/endpointer: keeps the existing automatic listener informed and enters
// a durable attentive pose.
presence.setUserSpeaking(true);

// A transcript/turn analyser, not a blind VAD pause, declares a meaningful
// conversational moment. The result is a visual receipt using an existing
// clip, subject to a per-kind cooldown.
presence.acknowledge('RECEIPT');

// Tool lifecycle creates the existing typing/review/search loop only while
// work is actually happening.
presence.setToolStatus('WORKING');
presence.setToolStatus('COMPLETE');

// The application starts TTS/cues after the floor-claim lead; the director
// supplies the non-verbal transition and later invites the user back in.
presence.beginResponse({ leadMs: 350 });
avatar.speak({ audio, cues });
presence.endResponse();
```

## Behavioral vocabulary

The director composes shared rig primitives into eye-first understanding beats:

| Host moment | Existing visual material |
|---|---|
| User starts speaking | `LISTENING` plus the existing engagement layer |
| Ongoing clause | `ACK_CONTINUE`: brow/lid acknowledgement, no floor claim |
| Meaningful completed point | `ACK_RECEIVE`: eye-softening, small mouth receipt, lean and settle |
| New understanding | `ACK_REALIZE`: brow/lid discovery beat |
| Emotional disclosure | `ACK_EMPATHIZE`: inner brows and soft attention, no false agreement |
| Tool is active | Loop: `TYPING` → `REVIEWING_SCREEN` → `TYPING` → `SEARCHING_SCREEN` |
| Agent is about to speak | Pipecat `SPEAKING` when playout begins |
| Agent has finished | `WAITING_FOR_USER` |
| Text-only recovery | `TYPING_CHAT` with concerned affect |

`acknowledge()` is deliberately distinct from `setUserSpeaking(false)`. A VAD
pause is not inherently an acknowledgement opportunity. The host should call
it for a clause boundary, completed answer, tag question, emphasis, or other
moment it can actually justify.

`ACK_NOD` is the explicit two-stroke, slight-tilt nod. The other low-level nod
studies are private authoring material and are not host or wire actions.

The avatar never generates facial acknowledgement from VAD or a timer. If the
host sends no action, it remains in its current factual state.

## Deliberate boundaries

- It does not select screen gaze. The runtime already provides a gaze seam;
  application glue should resolve a highlighted DOM element into an
  avatar-relative target and call that seam.
- It does not replace direct wire events. Existing hosts can continue calling
  `setState`, `action`, `perform`, and `speak` directly.
- It does not define a customer-avatar authoring contract. All behavior lives
  above the artwork; future avatar packaging only needs normal rig calibration.

## Review

Open [`demo/rig/presence-reel.html`](../demo/rig/presence-reel.html) in a local
server. It drives the same neutral, acknowledgment, turn-handoff, and work-loop
scripts across every registered SVG avatar at production tile size.
