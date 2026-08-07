# Design — why this is a library

*Written 2026-08-07, when the avatar stopped being one product's animation and
became a component with more than one consumer. The binding vocabulary is
unchanged: [contract-protocol.md](contract-protocol.md) and
[contract-avatar.md](contract-avatar.md) still govern.*

The avatar began as the talking head for a single voice-agent product, and the
backend half of it — the pipecat processor, the state machine, the wire, the
viseme engine — was built inside that product's repository. Then a second
application wanted the same face. The two applications run different pipecat
versions, different LLM services, different frontends and different deploy
pipelines, and neither could adopt the other's copy. Everything below follows
from that.

The failure mode to avoid was already visible before the split: the second
consumer had a byte-for-byte copy of the widget vendored into its frontend,
kept in step by a sync script, and it was four commits stale — no `myna`, no
body motion, no `line-art.js`. A sync script is a duplication with a cron job
attached. **The standing constraint on this work was: do not duplicate the
backend.**

## Decisions

### 1. This repo is the library. Everything moves here.

This repo already owned the two binding contracts, the three rigs and the whole
visual-verification apparatus. The backend halves came to the contracts, not
the other way round. Each consumer keeps its own deploy plumbing — that is the
application's, not the library's.

### 2. Two published packages, and one thing that is deliberately not a package

| artifact | registry | contents | deps |
|---|---|---|---|
| `@voqalize/avatar` | npm | the widget (`src/`) + `./pipecat` + `./react` subpaths | none; optional peers |
| `voqalize-avatar` | pypi | processor, state machine, wire, viseme engine, `avatarsync` runtime | `pipecat-ai>=1.4,<2` |
| `native/avatarsync` | *not a package* | the C++ fork, its build, the prebuilt binaries | — |
| — | — | `docs/` contracts, binding for all of them | — |

**One npm package with subpath exports, not three packages.** The widget is
zero-dependency and must stay that way; `@voqalize/avatar/pipecat` adds
`@pipecat-ai/client-js` as an *optional peer* and `@voqalize/avatar/react` adds
`react`. A consumer that wants only the widget pays for only the widget, and
the vendored-copy problem disappears because there is nothing left to vendor.

*Optional has to be true, not just declared.* One runtime `import` of a peer is
enough to make an entire subpath fail to load without it installed — even for a
host that never calls the function that needs it. `AvatarClient` imports its
pipecat types type-only and spells the three event names it subscribes to as
local literals for exactly this reason, with a test pinning them against the
real enum. The check that catches the regression is packing the tarball and
importing it from a clean project; CI does it on every push.

**One pypi package, because the binary was never a pip problem.** The obvious
move is to split the native half into its own wheel, and the code says not to:
the whole lipsync stack is stdlib plus a subprocess, with *zero*
avatar-specific Python dependencies. The runtime wrapper is ordinary Python and
ships with everything else; the 3 MB binary and the 56 MB acoustic model ship
the way each consumer already ships large artifacts — a build-cache step, or a
`COPY` into an image — and the application tells the library where that landed
by passing `avatarsync=<dir>`. Splitting the wheel would buy a dependency edge
nobody needs and a second version to keep in step.

**The path is an argument, never an environment variable.** This was briefly
the other way round (`AVATARSYNC_HOME`, `AVATARSYNC_BIN`, `AVATARSYNC_RES`,
`AVATARSYNC_PROCS`) and it was wrong for the reason all library-level env
reading is wrong: it is a hidden input. The caller cannot see it in the call, two
engines in one interpreter cannot disagree about it, a test cannot set it
without mutating global state the next test inherits, and when it is missing the
failure is silence — a session that quietly runs without lipsync — rather than a
`TypeError` at the seam. Configuration that reaches a library through the
process environment has skipped the API, which is the one place its meaning is
documented and checked. Reading the environment is an *application's* job;
`voqalize-avatar` does none of it.

What this does buy: **the viseme leg is optional at runtime, not at install
time.** `build_viseme_engine()` never raises — a missing binary is an ordinary
condition, logged once, and the session runs state-channel-only. So an
application can land states, gaze and interjections by simply not shipping the
binary yet, and turn visemes on later by adding a `COPY` and one argument. The
degradation is bounded: the widget falls back to `src/audio-fallback.js`, the
WebAudio amplitude path it has carried since day one for exactly this. Mouth
sync is the headline feature (brief, constraint 2), so this is a sequencing
decision, not an acceptable end state.

### 3. Distribution: public registries, restrictive licence

The repo is **public at `voqalize/avatar` under AGPL-3.0-only**, and both
halves publish to public registries: `@voqalize/avatar` on npm,
`voqalize-avatar` on PyPI. The licence is the restrictive end of open source
deliberately — self-hosting and modification are free, offering a modified
version over a network is not — and it is a starting position, not a final one.
Voqalize holds all the copyright, so relicensing permissively later is a
decision rather than a project; the reverse is not true, which is why the
restrictive end is the safe place to start.

Public registries were also the cheapest answer operationally. The alternative
considered was private git dependencies for both halves, and its own strongest
counter-argument was credentials: a Docker build that installs from PyPI needs
no `--mount=type=ssh`, no build token and no private registry. Publishing
removes the whole class.

**Names.** npm has scopes, so the scope *is* the namespace: one package,
`@voqalize/avatar`, with the three subpaths. PyPI has no scopes, so the
conventional stand-in is a hyphenated prefix — `voqalize-avatar`, importing as
`voqalize_avatar`, which is what the code already said. Both were free.
Rejected: `pipecat-avatar` (reads as an official pipecat package, and pipecat
ships its avatar integrations as extras of `pipecat-ai` itself rather than as
separate distributions, so there is no third-party convention to join) and
`voqalize-avatar-pipecat` (the dependency is already declared in metadata, and
the suffix forecloses a non-pipecat backend).

**One version, one tag, both packages.** They are two ends of one wire format,
so a version pair that can drift is a protocol mismatch waiting to be debugged
in production. `.github/workflows/release.yml` refuses to publish either half
if the tag disagrees with either manifest, and publishes both or neither.
Neither registry holds a long-lived credential — both accept an OIDC token
minted for this repository running this workflow. Setup and the token fallback
are in `RELEASING.md`.

The one thing that is still not a package is the native aligner; see the
`native/avatarsync` note in decision 2.

### 4. Two tiers of state, and the seam between them

This is the core of the design and the thing the library exists to get right.

**Tier 1 — base states, from stock pipecat frames, zero backend awareness.**
The state machine reads only frames that any pipecat pipeline produces, and
delivers `IDLE`, `LISTENING`, `THINKING`, `SPEAKING`, `TAKING_FLOOR`,
`WAITING_FOR_USER`, `YIELDED`, `DEGRADED`, `OFFLINE`, the `speech` clock
anchor, `user speaking` truth, and the whole viseme leg off `TTSAudioRawFrame`.
Drop `AvatarProcessor` into a pipeline between TTS and the output transport and
this works — that is the promise, and it is what makes the library adoptable.

The pin is `pipecat-ai >= 1.4, < 2`, and it is an honest one: every frame the
state machine reads exists in 1.4.0, including `FunctionCallsStartedFrame`,
`FunctionCallInProgressFrame`, `UserTurnInferenceCompletedFrame` and
`RTVIServerMessageFrame`. CI runs the suite at the declared floor as well as at
the resolved version, so "we support 1.4" is a claim a test checks.

**Tier 2 — composite states, which need to know what the application is doing.**
`TYPING`, `TYPING_CHAT`, `SEARCHING_SCREEN`, `REVIEWING_SCREEN`, `DISTRACTED`,
`CANT_HEAR`, `WANTS_IN`, and every deliberate interjection or `perform()`
timeline. No amount of frame-watching infers these correctly, and a library
that guessed would nod at the wrong moment.

The motivating case is concrete and not hypothetical: an LLM service that runs
its tools *out of process* pushes `LLMFullResponseStartFrame` but never pushes
`FunctionCallsStartedFrame`, because the pipeline never sees the calls. Such an
application gets every base state for free and gets nothing tool-driven until
it says so itself. That is not a gap to paper over — it is what the seams are
for.

**Seam one: a library-defined frame.**

```python
@dataclass
class AvatarControlFrame(DataFrame):
    """An explicit avatar instruction from the application's own pipeline."""
    message: AvatarMessage        # the same builders the state machine uses
```

The convention, per the brief for this work: **write your own FrameProcessor
and push `AvatarControlFrame` for the states you care about.**

**Seam two: subclass the state machine.** Every frame in the pipeline traverses
`AvatarProcessor`, which hands each one to `AvatarStateMachine.on_frame`. An
application whose own frames are simply *its spelling* of something the library
already models can subclass, intercept those frames, and call `super().on_frame`
for everything else. That is one pipeline seat instead of two, and tool
bookkeeping stays shared: `tool_started` / `tool_finished` are public on the
base class precisely so an application whose LLM runs out of process gets the
dedup, the parallel-call hold and the `tool_states` lookup rather than
re-implementing them approximately. Overriding `next_ctx()` is the same story
for the turn id, when the application has a real one rather than a counter.

The first application cut over to this library needed 90 lines of subclass and
nothing else.

Use whichever seam fits: a control frame when the signal originates somewhere
else in the pipeline (or in application code that can push a frame), a subclass
when the application's frames are its own spelling of what the state machine
already models.

**Conflicts are deferred, deliberately.** An explicit control frame simply wins
and is applied in arrival order alongside the heuristics; there is no priority
lattice, no TTL, no ownership tracking. That is YAGNI until a third consumer
produces a real collision, and the brief says so. What the library *does* owe
is that the collision be observable — every message carries its origin
(`heuristic` or `control`) in the emitted wire payload's debug field, so when
the fight happens we can see it rather than reason about it.

**One convenience that is not a third tier.** `FunctionCallInProgressFrame`
carries `function_name`, so `AvatarProcessor(tool_states={"search_web":
AvatarState.SEARCHING_SCREEN})` is a dict lookup, roughly ten lines, and it
covers the single most common Tier 2 need without anyone writing a processor.
It is stock-frame-driven, so it stays in Tier 1's implementation; it is opt-in,
so it stays out of Tier 1's promise. An application whose LLM hides its tool
calls cannot use it — a useful reminder that it is a convenience, not the seam.

### 5. The widget's public surface does not change

`createAvatar`, `setState`, `interject`, `speak`/`pushCues`, `perform`,
`setUserAudio`/`setUserSpeaking` are what both contracts describe and what
consumers already drive. Nothing in this reorganization touches `src/params.js`
or any face module. If it does, something has gone wrong — the reorganization
is above the waist of the system, and the waist is exactly where it should not
reach.

### 6. React is a peer at `>=18`, not a dependency at 19

The two consumers were on different major versions of React, and a binding
pinned to one of them would have been vendored by the other — which is the
problem this whole exercise exists to end. `react`, `react-dom` and
`@pipecat-ai/client-js` are all declared **optional** peers. The root export
needs none of them, and a host that only mounts the widget should not be told
it is missing React.

## Layout

`src/`, `demo/` and `tools/` stayed exactly where they were. Moving `src/`
would break every rig page and every headless tool for no gain a consumer can
see, and the widget is this repo's primary artifact — it has earned the short
path. The backend material arrived as siblings:

```
src/                    the widget — npm root export
  avatar.d.ts           its types, hand-maintained next to the code
client/                 AvatarClient (splice, clock anchor) + React binding
                        -> @voqalize/avatar/pipecat, @voqalize/avatar/react
py/                     voqalize-avatar: pyproject + src/voqalize_avatar/ + tests
native/avatarsync/      the rhubarb fork: patch, src, build.sh, binaries
docs/                   the contracts, binding for both packages
package.json            @voqalize/avatar, three subpath exports
demo/ tools/            the rig demos and the headless verification tooling
```

`py/scripts/fit_durations.py` fits the per-phone weights in
`duration_table.json`, which the fast viseme leg reads, so it lives beside the
table. It takes `--cache` for any `{text, audio_ms}` corpus.

`client/` is compiled with plain `tsc` — no bundler, no tsup. The emitted
modules keep their relative import of `../../src/avatar.js`, which from
`client/dist/` resolves to the package's own `src/`, so there is exactly one
copy of the widget in a consumer's graph. A bundler would have inlined a second
one into the React binding, which is how a "widget updated but the React tile
didn't" bug gets built.

`files` lists `client/dist` explicitly rather than relying on the `client`
directory, because `client/dist` is gitignored and npm applies `.gitignore`
*within* a `files` entry — an explicitly named path is the documented way to
win that argument. `npm pack` is the check: all three faces, both contracts.

## What the split cost, and what it left behind

The first cutover moved ~3,570 lines out of the consumer and put 90 back. The
consumer's pipeline file changed by six lines. Its frontend package went from a
vendored widget plus its own dispatcher to a ~30-line preset of one `accept`
predicate. Everything stayed green on both sides.

Two things worth recording because they will recur:

**A `link:`-shaped trap.** While a consumer points at a sibling checkout rather
than a published version, the linked package brings its own `node_modules` —
and this repo's `@pipecat-ai/client-js` shadowed the consumer's, producing a
`PipecatClient` type mismatch. Pinning to the consumer's exact version is the
workaround; a registry install publishes no `node_modules` and the peer
resolves from the consumer, so the pin widens again the moment the dependency
becomes an ordinary version.

**No transport change is needed to adopt this.** The obvious-looking move —
turning on `video_out_enabled` in the transport params — is the integration
path for server-side video avatars, and it is the wrong one here. This avatar
is a JS widget rendering in the browser from data-channel messages; there is no
video track, and that is the entire point of it being cheap. The client seam is
wherever the app renders the bot's tile today.
