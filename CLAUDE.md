# The avatar — project brief

## What this is

A JavaScript-programmable 2-D "talking head" widget for AI voice calls. The
avatar sits in a video-call tile opposite a human user, listens most of the
time, speaks with server-synced lipsync, and signals application state
(thinking, typing, can't-hear-you) through motion instead of spinners. It began
as **Kiran**, an AI interviewer; on 2026-08-05 the requester reframed it —
*"that is a narrow framing. This is an avatar for online AI based calls. The
avatar can take multiple roles, and can be named different things."* Kiran
survives as the demo persona's name, nothing more. The code and every enum are
role-neutral: the person on the other side is the *user*, never the candidate.

On 2026-08-07 the requester reframed it a second time, along the same axis:
*"We built out this avatar system as an experiment and focussed on the
interviwing use case. But I think this is now more useful to the genearl
category of digital assistants that talk and need to communicate non-verbally
as well. There are now two users for this library and so it is a good time to
abstract things out better."* So **this repo is the library, not a product**,
and it has two real consumers, both voice-agent products on pipecat. The design
is [docs/design-library-split.md](docs/design-library-split.md); the standing
constraint is *do not duplicate the backend*. Where a consumer needs to signal
something the library cannot infer, the answer is **"write your own
FrameProcessor and emit the states you care about"** — explicitly YAGNI until
a third strong use case argues otherwise, conflicts included. (Cutting the
first consumer over on 2026-08-07 found a second, cheaper seam for the case
where the application's frames are just *its spelling* of something the library
already models: subclass `AvatarStateMachine`, translate in `on_frame`, and
reuse the public `tool_started`/`tool_finished` bookkeeping. That consumer's
whole remaining divergence is 90 lines.)

On 2026-08-07 the open-source question was settled the restrictive way: the
repo is **public at `voqalize/avatar` under AGPL-3.0-only**, and the two
packages — `@voqalize/avatar` on npm, `voqalize-avatar` on PyPI — publish in
lockstep from one `v<semver>` tag (`RELEASING.md`, `.github/workflows/`). AGPL
was chosen as a *starting* position, not a final one — Voqalize holds all the
copyright, so relicensing permissively later is a decision, not a project. Two
things follow for day-to-day work: **anything committed here is public**, and
the lockstep versioning is load-bearing — the two packages are two ends of one
wire format, so a version pair that can drift is a protocol mismatch waiting to
happen. The release workflow refuses a tag that disagrees with either manifest.

## Motivation, in the requester's words (the original brief)

> I want to build a javascript programmable 'talking head' 2-d animation based
> on [a reference image]. Kiran is an AI interviewer. It conducts job interviews over
> voice. The interview system has screen share enabled. The candidate turns on
> their camera and speaks normally to Kiran. Today, Kiran is an animation. I want
> to replace it with a javascript programmable widget that has various states.
> Most importantly, it needs to have basic mouth sync with the audio being
> played. There will be a server side component for this - but we don't need to
> build that. Imagine the server will tell you the state, which is an enum. For
> certain states - such as speaking - it will give us the mouth shapes as
> alphabets that are realtime synced. The harness will feed the instantaneous
> mouth shape synced to voice. We will also need an eye direction enum when Kiran
> is looking at a particular portion of the screen. I also want animations for
> common interjection phrases - okay, yes, one moment, sure, sorry, go on etc.
> These are more important to get right - because they give feedback in real
> time. So I want the talking head animation. I am okay using any library as long
> as it is open source, and I can control it via states and mouth shapes. The
> realtime aspect will come from the server - but we need some minimal
> information on how to take speech and convert it into mouth shapes that matter
> for our minimal animation. The provided image is inspiration. We can take this
> and make a less detailed version as per our needs.

## The binding references

`docs/contract-protocol.md` (server ↔ widget: every state, emotion, gaze
target, interjection, the cue and action wire formats, with when-to-send
semantics) and `docs/contract-avatar.md` (mixer ↔ face: the channel table,
apply() obligations, the new-avatar recipe). They are maintained with the code
— a vocabulary change that skips them is incomplete.
`docs/research-biomechanics.md` is the citation-backed source for every timing and
amplitude constant in the motion layers; constants derived from it say so in a
comment. `docs/research-perception.md` is its static-design sibling — how the
face is *read* rather than how it moves: face perception at tile size, resting
trust and warmth, neoteny calibration, caricature economy, long-session
comfort, latency masking ("mirrors in lifts") and listening contingency.
Face-module authoring and design-review decisions cite it the way motion
constants cite the biomechanics doc, and the staged new-avatar process in
contract-avatar.md operationalizes it.

## Constraints that follow from the brief

These are not negotiable without a conversation.

1. **The server is the source of truth, and it is out of scope here.** The
   client never decides what the agent says, what state it is in, or when. It
   receives state enums, gaze enums, action timelines and a real-time stream of
   mouth-shape letters, and its only job is to look right while rendering them.
   Do not add client-side "intelligence" about call content. (The one nuance
   since: the *listening engine* times backchannels off the user's voice — but
   the server still owns whether backchanneling is allowed at all, via the
   state, and can drive every ack explicitly.)
2. **Mouth sync is the headline feature.** Called out as "most importantly".
   Anything that degrades lipsync fidelity or timing is a regression even if it
   improves something else.
3. **Mouth shapes arrive as single letters.** The wire format is the Rhubarb
   Lip Sync A–H+X alphabet, chosen because the brief said "mouth shapes as
   alphabets" and because it gives the server team an off-the-shelf open-source
   reference implementation (`rhubarb-lip-sync`) to target.
4. **Interjections matter more than long-form speech.** Explicitly: *"These are
   more important to get right - because they give feedback in real time."* The
   avatar listens far more than it speaks; the backchannel inventory and the
   listening engine are the product. Spend effort accordingly.
5. **Interjections must work with no audio at all.** Each has baked, plausible
   default timings so it plays convincingly in muted or degraded mode. Real TTS
   clips get attached later via `attachAudio(id, url)`.
6. **Open source only, no proprietary runtime dependencies.** The widget has
   zero dependencies and no build step. (`tools/` has its own package.json —
   dev tooling only, nothing ships from there.)
7. **The reference image is inspiration, not a target to match pixel-for-pixel.**
   Fidelity to the *character* matters; fidelity to the rendering does not.
8. **Screen share is on and the user's camera is on.** The avatar shares screen
   real estate with a live video call. Keep idle motion low-amplitude and
   low-frequency — a jittery avatar costs the video encoder real bitrate for no
   communicative gain. Deliberate stillness (the profile system's holds) is
   both a cue and a bitrate saving. `CANT_HEAR` is the one state allowed to
   spend amplitude, because the lean *is* the message.
9. **The avatar has no arms and no hands.** Both original rigs carried a full
   forearm/hand chain — nine channels, several hundred lines of geometry each,
   the most defect-prone code in the project — and the requester had it removed
   on 2026-08-05 after seeing it rendered: *"I am not happy with the arm waving
   animation at all… I would rather not add all the complexity for a 1% use
   case."* Later the same day they softened the diagnosis: *"the hands and
   fingers just looked super weird, but I think that was just how we
   implemented it."* So the door is ajar — but do not re-add arms without
   asking. The former arm-gesture IDs (`WAVE`, `THUMBS_UP`, `SHRUG`,
   `GO_ON_ARM`, `RAISE_HAND`) keep their meanings, re-authored from face,
   shoulders and torso. **Adding a channel to `params.js` that only one avatar
   can render is the shape of the mistake to avoid**, whatever the body part.
   **There is still no arm — but since 2026-08-07 there is a hand**
   (`src/hand.js`, promoted from `experiments/arm-gesture/` after the
   stakeholder saw it: *"generally speaking - happy with the inclusion of the
   arm"*). It clears constraint 9 by being the other design entirely: no
   forearm, no parameter channel, no per-face geometry — one drawing that rises
   past the frame's bottom edge, placed from `META.viewBox`, painted in the
   mounted face's theme, appended over its SVG. A face that never plays a
   gesture renders exactly what it rendered before. Adding an *arm* still needs
   a conversation.

## Current directives (updated 2026-08-07)

- **New avatars follow the staged process** in contract-avatar.md § Adding a
  new avatar, grounded in `docs/research-perception.md`: a stakeholder-supplied
  reference image is the identity spec (stage 0) → distill silhouette +
  identity marks (stage 1, bar: squint test) → production calibration against
  the brief on a 130 px acceptance surface (stage 2 — the reference stops
  being the bar) → independent fresh-eyes design review, then stakeholder
  (stage 3). The evidence, one day apart: `koel`, authored from a text brief,
  passed every rig check and was rejected on sight; `myna`, authored
  reference-first then calibrated by this process, was approved.
- **`myna` is stakeholder-approved (2026-08-07) and ships as the third
  avatar.** The static character is signed off; the animation-gap review (an
  animation expert found the current motion not up to the mark) is the next
  piece of work, and already has seeded items — see Known gaps.

- **`peep` is `DEFAULT_AVATAR` and the rig to author against.** *"No need to
  focus on the others till biomechanics is proven."* Author, judge and
  screenshot on peep, then confirm on the others. `sweep()` runs every
  registered rig — a crash there is a parameter-space bug that would bite peep
  too.
- **Three avatars, all line art.** Stakeholders accepted `peep` and `wren`
  (and later `myna`) and rejected the other two, which were deleted on
  2026-08-06 — *"I suggest we
  delete the two altogether"*. The new-vs-retrofit question that was pending is
  therefore closed in favour of *new*: every future avatar is hand-authored in
  the peep idiom, sharing the `line-art.js` taper/region construction kit.
  Retrofitting has nothing left to retrofit.
- **Biomechanics maturity before artistic polish.** Styling and branding come
  after the motion is right, and in the peep idiom when they come.

## Architecture in one paragraph

The face is a ~30-dimensional float vector (`src/params.js`). Visemes,
emotions, gaze poses and gesture keyframes are all named vectors in that space,
so blending is arithmetic rather than SVG path surgery. Per frame, layers mix
in a fixed order — base pose (state+emotion) → gaze → visemes → clip deltas →
idle — with clips and idle *additive* so they compose instead of fighting.
Every channel then chases its target via a frame-rate-independent exponential
approach at a per-channel time constant; that single mechanism supplies the
face's sense of mass and gives viseme co-articulation for free. Above the
mixer: each state carries an idle *profile* (blink rate, breath rate/amplitude,
sway, holds, typing rhythm, glance patterns — `DEFAULT_PROFILE` in
`src/idle.js`), a `ListeningEngine` times backchannels off the user's voice
(`setUserAudio`/`setUserSpeaking`), and `perform()` runs server-assembled
action timelines against the audio clock. Beside the mixer rather than inside
it: `src/hand.js`, which writes a transform on its own SVG group — no channel,
no smoothing, timelines authored as *delivered* motion. See `README.md` for the
design narrative and `docs/contract-protocol.md` for the wire surface.

## The two abstractions that matter

**The parameter vector** (`src/params.js`) is the waist of the system. Every
generator above it — visemes, emotions, gaze, idle, clips — emits a partial
vector, and the mixer sums them. Nothing above the renderer knows what a face
looks like; nothing below it knows what a call is. A change that makes a
generator reach for an SVG element, or makes the renderer reach for a state
name, has broken the shape of the codebase even if it looks fine on screen.

**The avatar** is a module exporting a factory and a descriptor:

```js
createFace(mount, theme) -> { svg, apply(params), theme, destroy() }
META = { viewBox: {x,y,w,h}, mouthCrop: {x,y,w,h} }
```

`src/avatar.js` holds the `AVATARS` registry of `{ create, meta }` records;
`createAvatar({ avatar: 'name' })` picks one, `createAvatar({ face: fn })`
passes a bare factory the rig has never heard of (meta then falls back to the
svg's viewBox). The registry was factories-only until there were three faces —
the schema was *discovered*, not guessed: all three needed exactly a framing
rect and a mouth rect to stop the tooling hard-coding per-avatar tables, and
nothing else, so that is all META carries. The shared renderer plumbing (pose
transforms, the memoized `set()`, the invariant apply() skeleton) lives in
`src/face-core.js`; a face module supplies static art, a spec of named scalars,
and hooks only where its model genuinely diverges (peep's bean eyes). The full
recipe: docs/contract-avatar.md § Adding a new avatar.

Three ship, all line art: **`peep`** (`src/face-peep.js`, the default —
Open Peeps–style, hand-authored in 760x950), **`wren`** (`src/face-wren.js`,
the second character, same window), and **`myna`** (`src/face-myna.js`, same
window — the first avatar built by the staged process: distilled from a
stakeholder reference asset, then production-calibrated at 130 px; approved
2026-08-07). All are built on one rule the retired rigs
did not follow: **no strokes anywhere**. Every line is a filled path, which is
what lets a mark swell and taper the way a drawn line does; uniform
`stroke-width` is exactly what makes vector line art read as clip art. Three
helpers in `src/line-art.js` do all of it — `taper`, `taperRing`, `region` —
and widths are a *profile across the whole mark* in normalized `s ∈ [0,1]`,
never per-node, so the profile survives re-authoring the points.

Two earlier rigs, `classic` (hand-authored, 320x400) and `blue-shirt` (a
cleaned auto-trace in native 1024x1024), were deleted on 2026-08-06. They are
in git history, and several comments in `face-peep.js` still set a number
against `blue-shirt`'s — deliberately, because peep's travels were derived by
converting from a rig 2.6x its size and the conversion is where the bodies are
buried.

### Do not chase parity between the faces

**A visual improvement lands in peep and stops there** (see Current
directives). The avatars are separate drawings, not renderings of one drawing — a
fix that reads on one frequently means nothing on the other. The registry key
for the original rig used to be `default`, which became a lie the moment it
stopped being the one we ship: a key is a name, `DEFAULT_AVATAR` is the
choice.

A hard-won corollary from the compound-states work: **a minimal line face
swallows small deltas.** Peep's ink moves whole units or it doesn't move, and
its resting mouth is drawn smiling, so "not smiling" must be authored clearly
negative and concentration must be brows-*down* — pose values for peep are set
from the contact sheet's extremes row, not from what a fleshed rig would need.

### `peep` has no dark mode, and that was decided

A value-swapped `THEME_DARK` was built and removed on 2026-08-05 after the
requester saw it: *"Inverted looks horrible. Don't even try to fix it. Lets
keep the variables but not add the complexity of managing the dark mode."* The
theme *keys* stay — every colour the rig paints is an overridable key — but
there is no second palette and no `dark` selector. The underlying reason it
cannot be a colour change: inverting a two-value line drawing turns the black
hair white, which ages the character a decade or two, and keeping it dark on a
dark ground means outlining the hair mass. That is geometry wearing a
palette's clothes. (Related: there is deliberately no barrel `THEME` export —
each face owns its palette; `api.theme` is the mounted one.)

## Working conventions

- **`src/` is ES modules with no build step, and that is a constraint, not a
  convenience.** Consequence: the demo needs an HTTP server; `file://` will not
  load modules. `python3 serve.py 8777` — see *Verifying* for why it must not
  be `python3 -m http.server`. It also means every rig page loads the same
  files a consumer installs, so what you screenshot is what ships. `client/`
  *is* compiled (TypeScript, `tsc` only, no bundler) — that is the whole
  exception, it emits to `client/dist`, and nothing in `src/` may come to
  depend on it. A change that would make the widget need a build has broken
  the shape of the project even if it works.
- **Face modules (plus `face-core.js`) are the only files that know what a face
  looks like.** Restyling a character, or adding an avatar, must not change the
  parameter contract. If a visual change requires touching `params.js`, that's
  a signal to reconsider — and if it requires touching anything outside
  `src/face*.js`, it's a bug. `src/hand.js` is the one drawing that is not a
  face and not per-face: it knows what a *hand* looks like, takes the mounted
  face's window and palette, and knows nothing else about the character.
- **The mouth priority rule is invariant:** server viseme track > clip mouth
  track > amplitude fallback. A clip firing mid-speech contributes head and
  brows only (`MOUTH_LOCK` in `src/avatar.js` — exactly `GROUPS.mouth`).
- **Never schedule against wall time.** Cue tracks and `perform()` timelines
  run off the audio clock. Cues lead by 40ms because perceptual tolerance is
  asymmetric; action timelines fire verbatim — gesture lead is authored into
  `t` by the composer.
- **Clip keyframes are not what the face does — the smoothing is between
  them.** A channel chasing an oscillating target attenuates by
  `1/sqrt(1 + (ω·TAU)²)` and lags by `arctan(ω·TAU)`. The nod inventory is
  authored with peaks pre-compensated for the head's 160ms `TAU` (a rendered
  0.30 nod is written ~0.55), and channels with different `TAU` are already
  phase-shifted relative to each other for free — a deliberate lead or lag has
  to be authored on top of what the mixer is already supplying, not from zero.
  Keep gesture oscillations under ~1.5 Hz: above that line a nod stops reading
  as attention and starts reading as impatience. The frame-edge hand is outside
  both halves of this rule — it takes no smoothing at all, and its waves run
  2.8–3.0 Hz, because the ceiling is about *nods*: 2–3 Hz is the social wave
  band and the bottom of it reads as tired.
- **Autonomy is contingent, never decorative.** Backchannels time off the
  user's voice when a signal is supplied (pause-onset windows, refractory
  gaps); the random-timer path exists only as the no-signal fallback. Some cues
  are server-sent only and must never fire autonomously: `BLINK_LONG` (it
  measurably shortens the user's next answer), both head shakes (an agent must
  not disagree by accident).
- **Verify visually, on peep, in the browser or headlessly.** The rig is
  judged by eye — every defect this project has found was found by looking: a
  viseme collision between `G` and `B`, sclera exposed when looking down, a
  compound state that read as *asleep* instead of busy, screenshot flukes that
  were really mid-blink frames (param-gate your sampling). Numbers passing is
  not evidence a change is good.
- **Comments explain the perceptual *why*, not the mechanics.** The non-obvious
  reasons things are the way they are (blinks are asymmetric, the head
  under-rotates, `SORRY` lives in one brow channel, why CANT_HEAR's brows go
  *down*) are the actual value in this code and are easy to "clean up" by
  accident. Constants taken from the research doc cite it.

## Verifying

Three suites, and they answer different questions. The rig is judged by eye;
the packages are judged by test.

```
node tools/sweep.mjs            # the rig conformance gate — run before committing src/
npm test                        # client/: dispatcher logic + a jsdom package-boundary smoke
npm run build                   # client/ -> client/dist; also runs on `npm install`
cd py && uv run pytest          # the pipecat backend, 169 tests
```

`npm test` deliberately does **not** test the rig. A DOM emulator cannot tell
you whether a face reads as *thinking* or as *asleep*, and every defect this
project has found was found by looking. The one jsdom test that touches the
widget mounts every registered avatar and checks the SVG lands in the DOM —
that proves the *package boundary*, not the drawing.

The Python suite runs against the real `avatarsync` binary over a real pipe;
if it skips, `native/avatarsync/build.sh --res-only` regenerates the model
tree it needs. It is also run at the declared pipecat floor (`>=1.4`), not
just the resolved version — `py/tests/helpers.py` spans the one constructor
that moved, so "we support 1.4" is a claim a test actually checks.

Serve first — ES modules will not load over `file://`:

```
python3 serve.py 8777
```

**Not** `python3 -m http.server`. It sends `Last-Modified` and no
`Cache-Control`, so browsers apply heuristic freshness and stop revalidating
edited modules entirely. That has cost this project three separate debugging
sessions, one of which produced a module error (`does not provide an export
named 'RANGE'`) that was simply a lie. `serve.py` is the same server with
`Cache-Control: no-store`. Resist fixing a stale module with a `?v=` query
string: it puts two copies of the same module in the graph, which fails
differently and worse.

**Headless, for agents and CI** — `tools/` (node + puppeteer; serves the repo
itself, no serve.py needed; any page console error is a hard failure):

```
node tools/sweep.mjs               # the conformance gate; run before committing src/
node tools/shot.mjs <page> -o x.png [--selector css]   # render and LOOK at it
node tools/baseline.mjs            # deterministic render set -> .review/baseline-<sha>/
node tools/diff.mjs a.png b.png    # pixel diff; the refactor-proof workflow is
                                   # baseline -> change -> baseline -> diff
node tools/motion.mjs --state LISTENING --span 40 --tag x   # how much MOVES, in px
```

`motion.mjs` is the only tool that answers a question about a *sequence*. It
steps `demo/rig/body-lab.html` (seeded RNG installed before module import,
`{manual:true}`, fixed 1/60 s ticks) and reports delivered travel in CSS pixels
by image-registering each frame against the first, split into a head band and a
torso band. It writes a `-map.png` heat overlay (a grey torso in that image *is*
the "the body is static" complaint) and a `-extremes.png` that superimposes the
two frames furthest apart laterally in red and blue — the width of the fringe is
the excursion, and whether that excursion reads as a person re-settling or as
the drawing sliding is the call the numbers cannot make. Two probes that look
reasonable and report zero on a visibly moving body are documented in the file:
silhouette edges and ink centroid both fail because peep's shirt deliberately
runs off both frame edges.

The baseline pages (contact-sheet, torso-check, clip-strip) render via direct
`apply()` or deterministic stepping — twice-rendered diffs are 0 pixels, which
is what makes refactors provable. Live-mixer pages have random idle and are for
sweep and eyeballs, not pixel comparison.

**There are two entry points.** Everything else is rig tooling behind one
index, because six sibling pages read as six ways in when only two are ever the
answer to "show me the avatar".

| page | what it's for |
|---|---|
| `demo/call.html` | **the one to show people.** A Meet-style two-tile call with mic VAD, floor management and the token log. Hold `Space` to be the user — no microphone needed. `?avatar=NAME` or the side-panel picker swaps the rig live. |
| `index.html?avatar=NAME` | the full harness, driving one avatar as a host would — every state, emotion, gaze, viseme, interjection, hand gesture, and a user-speaking toggle for the listening engine. |

`demo/rig/` is the avatar-development set, indexed at `demo/rig/index.html` —
for *building or repairing a rig*, a different job from demoing one:

| page | what it's for |
|---|---|
| `demo/rig/rig-check.html` | every registered avatar side by side through live `createAvatar` instances. Same command, same moment, so any on-screen difference is the avatar's, never the driving's. |
| `demo/rig/contact-sheet.html?face=NAME` | static poses for one avatar — every viseme, emotion, gaze target and channel extreme, straight from `apply(p)`, no mixer, no clock. Mouth-detail row crops via `META.mouthCrop`. |
| `demo/rig/torso-check.html?face=NAME` | shoulder / lean / trunk-turn / head-pose combinations, which only fail *together*. This is where a rig leaks background from behind the shirt if it is going to. The `(worst)` rows are the failure envelope, well past anything the mixer sends. |
| `demo/rig/body-lab.html?face=NAME&state=…` | the rig driven by hand, deterministically: seeded RNG, `{manual:true}`, `window.stepTo(t)` in 1/60 s ticks. Not for looking at — it exists so `tools/motion.mjs` can difference frames and call the result a measurement. Every other page is stochastic, so no two runs of the liveness layer were ever comparable. `&gesture=HI&at=0.4` fires a hand gesture at a known sim time, which is the only way to screenshot one at peak. |
| `demo/rig/clip-strip.html?clip=NAME` | a gesture clip as a filmstrip: a real `ClipPlayer` stepped in 1/60s ticks with the mixer's own smoothing, so phase relationships are legible in a still. `&n=32` finer, `&crop=` to reframe. Cue tracks are not applied — a shut mouth in the strip is the harness, not the rig. |
| `demo/rig/expression-lab.html` | clip and beat authoring against real audio. |
| `demo/rig/lipsync-eval.html` | cue tracks A/B, sphinx vs phonetic. |

The clip JSON and audio stay in `demo/` rather than moving down with the pages —
`call.html` plays the same files, and one copy of a hundred wavs is the point.
Both lab pages carry a `DATA = '../'` constant for the hop back up.

`rig-check.html` console API — `sweep()` is the conformance test:

```js
await sweep()   // every state, emotion, gaze, interjection and hand gesture on
                // every avatar, then a viseme track. Asserts params finite and
                // |v| <= 2, svg.isConnected, and checkHandFraming per avatar.
                // Returns {ok, problems}.
pose({ headYaw: -1, headRoll: 1 }, 800)  // hold a raw vector on all rigs
unpose()
rigs                                     // [{name, avatar}, ...]
```

`sweep()` catches dead avatars, NaN leaks and detached SVGs. It cannot catch
anything about how the face *looks* — passing it is not evidence a change is
good. It reaches shoulder/torso channels only through whichever clips use them;
sweeping those directly is a `setOverrides` loop over `[-1, 0, 1]`.

Techniques worth reusing:

- **Crop the viewBox after `apply()`** to inspect a feature. Safe because
  nothing in the rig writes `viewBox` — every pose channel is a transform or a
  path, never the camera. At avatar size a viseme is ~40px tall and letter
  collisions are invisible without the crop.
- **Hide a layer and re-screenshot** to attribute a defect to it.
- **Param-gate screenshot sampling** (wait until `avatar.params.lidL` is low
  before shooting) — mid-blink and mid-wander frames masquerade as rig bugs.

## What building the second and third avatars taught us

Kept because it is the evidence the abstraction answers to — items marked ✓
have since been absorbed by `face-core.js`/`META`, and the lesson is why.

- ✓ **`viewBox` cannot be a rig constant.** Hosts read `META.viewBox` (or
  `api.meta`); nothing assumes one aspect ratio.
- **Layer sets are art-dependent.** 7 layers for the first rig, 4 for the line
  art; parallax multipliers follow the art, not a standard. Still per-face spec.
- ✓ **`apply()` is not per-avatar.** Three line-for-line identical
  implementations were the evidence; `face-core.js` is the consequence. What
  remains per-face is exactly the genuinely divergent models (eye bean, brow
  point-lists, mouth contour) as hooks.
- ✓ **The contract exposes no landmarks.** `META.mouthCrop` was the missing
  landmark; the tooling's hard-coded tables are gone.
- **Auto-traced art fails in ways hand-authored art does not.** Zero-overlap
  seams under parallax, truncation at the source crop, hard edges that appear
  under motion. This is most of why the traced rig was the one stakeholders
  rejected hardest, and why every avatar from here is hand-authored.
- **Art units are per-rig, and copying a magnitude between rigs is silent.**
  peep's shoulders once moved at 40% strength because a value came over from a
  2.67x-larger rig without its `units` factor; nothing threw and `sweep()` passed. Rotations
  are the trap inside the trap — degrees are degrees and must *not* be
  converted, while a translation in the same block must be. `face-core` keeps
  `units` a separate spec factor (pre-multiplying changes float rounding and
  costs literal pixels in the diff).
- **A channel has to mean what an author assumes it means.** peep's
  `mouthOpen` originally measured lip-centreline gap; the drawn lip band is ~11
  units thick, so the mouth stayed shut below 0.25 — where two visemes live.
  The channel now denotes the *visible aperture*. Authors of `visemes.js` never
  see a rig; whatever a channel measures must be the thing they think they are
  asking for.
- **Two visemes can be numerically distinct and visually identical.** `G` and
  `B` both drew a white strip over a dark slit. Separating them needed a
  *shape* difference, not amplitude — visible only on the mouth-detail crop.

## Layout

```
src/params.js          parameter space, smoothing constants, channel groups
src/face-core.js       what every face shares: renderer shell, pose mechanics,
                       shared feature fragments; per-face spec plugs in
src/face-peep.js       the `peep` avatar (default); line art, no strokes anywhere
src/face-wren.js       the `wren` avatar; the second line-art character
src/face-myna.js       the `myna` avatar; first built by the staged process
src/line-art.js        the stroke engine all faces share: taper / taperRing / region
src/visemes.js         A-H protocol, cue hygiene, scheduling, server mapping tables
src/emotions.js        six affect poses
src/gaze.js            12 named targets, saccade + head-follow model
src/idle.js            per-state profiles (blink/breath/sway/weight-shift/holds/
                       rhythm),
                       ListeningEngine (contingent backchannels), glance/flick
src/clips.js           keyframe player for gesture timelines
src/interjections.js   the 26 interjection clips
src/hand.js            the frame-edge hand: four gestures, no rig channel, placed
                       from META.viewBox alone
src/perform.js         action-timeline player: the composable vocabulary
src/audio-fallback.js  WebAudio amplitude/spectral lipsync fallback
src/avatar.js          public API + per-frame mixer + the AVATARS registry
src/avatar.d.ts        hand-maintained types for the public surface. The widget
                       has no compiler; written against contract-protocol.md
package.json           @voqalize/avatar — subpaths . / ./pipecat / ./react
serve.py               dev server with no-store; use this, not http.server
LICENSE                AGPL-3.0-only; py/LICENSE is a copy, because a wheel
                       carries its own
RELEASING.md           one tag publishes both packages; the OIDC setup each
                       registry needs
.github/workflows/     ci.yml (the gate, also called by release), wheels.yml (the
                       canonical per-platform native build), release.yml

                       -- the browser client (TypeScript; the one build step) --
client/src/types.ts        the wire vocabulary; twin of messages.py
client/src/AvatarClient.ts turn-clock anchor + cue splice, framework-free
client/src/useAvatar.ts    the React mount lifecycle
client/src/Avatar.tsx      the call-tile component over useAvatar
client/src/pipecat.ts client/src/react.ts   the two subpath barrels
client/test/           vitest: dispatcher logic + a jsdom package-boundary smoke
client/dist/           built by `npm run build`; gitignored, published

                       -- the pipecat backend (pypi: voqalize-avatar) --
py/src/voqalize_avatar/state_machine.py  base states, inferred from stock frames
py/src/voqalize_avatar/frames.py         AvatarControlFrame — the extension seam
py/src/voqalize_avatar/processor.py      the FrameProcessor; RTVI server-messages
py/src/voqalize_avatar/visemes.py        the three-leg viseme engine + splice
py/src/voqalize_avatar/avatarsync.py     resident subprocess pool for the aligner
py/scripts/fit_durations.py  refits duration_table.json (the fast leg's phone
                       weights) from any {text, audio_ms} corpus
py/tests/              169 tests; green at the declared pipecat floor and above

native/avatarsync/     the Rhubarb Lip Sync fork: patch, src, build.sh, binaries.
                       build.sh is the LOCAL loop; wheels.yml is what ships.
                       The binary + model tree ride inside the pypi wheel, so
                       `pip install voqalize-avatar` needs no second artifact
py/scripts/stage_native.py  stages that payload and derives the wheel's platform
                       tag by reading the compiled binary

docs/contract-protocol.md   the server <-> widget contract (binding)
docs/contract-avatar.md     the mixer <-> face contract + new-avatar recipe (binding)
docs/design-library-split.md  why this is a library; what each artifact owns
docs/research-biomechanics.md  the numbers behind the motion constants
docs/research-perception.md    how the face is read: likability, tile-size
                       legibility, latency masking, listening contingency

tools/                 headless: shot / sweep / diff / baseline / motion (dev-only deps)

                       -- the two entry points --
index.html             the full harness, driving one avatar as a host would
demo/demo.js demo.css  the harness's controls and styling
demo/call.html         the Meet-style call demo — the page to show people
demo/floor.js          turn-taking demo driver: barge-in, acks, floor claim
demo/vad.js            mic voice activity — silero via CDN, RMS fallback

                       -- shared clip data --
demo/perf-clips.json   16 scripted turns: audio, cue tracks, gesture beats
demo/perf-audio/       the TTS clips those turns play
demo/eval-clips.json demo/eval-audio/   24 clips the lipsync eval scores against

                       -- rig tooling; only when building or repairing an avatar --
demo/rig/index.html    the index for everything below, and the only way in
demo/rig/rig-check.html      all avatars side by side, live; sweep()
demo/rig/contact-sheet.html  static poses for one avatar
demo/rig/torso-check.html    shoulder / lean / turn / head combinations
demo/rig/body-lab.html       the rig stepped by hand, seeded — motion.mjs's driver
demo/rig/clip-strip.html     a gesture clip as a filmstrip
demo/rig/expression-lab.html clip and beat authoring against real audio
demo/rig/lipsync-eval.html   cue tracks A/B, sphinx vs phonetic

experiments/rhubarb-textsync/   server-side, ships nowhere near the widget:
                       A-H letters from text before the audio exists
```

## Known gaps

- **Floor management lives in `demo/`, not `src/`.** It is a stand-in for
  server decisions, and every decision it makes is announced through `emit` so
  the demo shows the token stream a real server would send. Moving it into
  `src/` would put call logic below the waist of the system — see constraint 1.
- **The 2026-08 motion review is graded and largely closed.** An external
  motion review (written against sl-web-face and Live2D as references, PR #1's
  `docs/motion-gaps.md`) was graded on 2026-08-07 against the product frame —
  *does any state misread?* — rather than the review's own realism frame.
  Adopted: ballistic head-follow braking (`gaze.js`; the stop is the cue that
  attention landed) and smile-corner decay during speech (`avatar.js` mixer,
  `SPEAK_SMILE_RETAIN`; research-perception.md §3). Checked and closed: myna's
  hair rides the head layer by construction, no plait fix needed. Deferred
  with reasons on record: the turn-morph experiment (PR #1 stays open as
  evidence — realism, not legibility, and per-avatar authoring cost fights the
  staged process), viseme salience ordering (measured incidence: 8 sub-30ms
  collisions in 1,213 shipped cue gaps), and the minimum-hold question (logged
  in research-biomechanics.md §1.4). Rejected outright: a Live2D-style clip
  priority mechanism — it would let the client refuse server commands, which
  violates constraint 1; our arbitration (backchannels gated on no clip
  playing, server clips always win, timelines fire verbatim) is the design.
- **The frame-edge hand shipped (2026-08-07) and the experiment is retired.**
  `experiments/arm-gesture/` was accepted after five cuts and is now
  `src/hand.js` (it is in git history if the rejected cuts are ever wanted).
  The wire question it left open was answered the conservative way: a *separate*
  `gesture(id)` verb over four ids of its own (`HI`, `BYE`, `THUMBS_UP`,
  `ONE_MOMENT`), not a hand variant on the existing interjection ids — two live
  consumers exist, and `interject('WAVE')` silently growing a hand on upgrade is
  a behaviour change nobody asked for. The hand plays the face half itself.
  What is still open: `GO_ON` has no hand version and was cut structurally (a
  real "go on" is a finger curl, and a splayed palm at that height reads as
  *stop*) — reviving it means a new shape, not new timing. Every avatar gets the
  hand for free; `checkHandFraming` gates each one in `sweep()`.
- **A `speak` verb inside `perform()` timelines was deliberately deferred** —
  speech defines the clock a performance rides on; the composed unit stays
  `{audio, cues, beats}` as sibling calls. Rationale in contract-protocol.md.
