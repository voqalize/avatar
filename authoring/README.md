# The workshop

Where the avatars get drawn and made to move.

Everything in this directory is for building or repairing an avatar. Nothing in
it ships: the published library is `src/` and `client/`, the demo call is
`server/`, and the IDE for the published interface is `studio/`. This is the
bench behind all three.

```sh
python3 authoring/serve.py 8777      # from the repository root
open http://localhost:8777/authoring/
```

That is the whole setup. There is no build step and there is nothing to
install — the widget in `src/` is dependency-free ES modules loaded straight
into the browser, so edit a file, reload, look. (The headless tools in
`tools/` are the exception and need `pnpm install` once.)

**Use `serve.py`, not `python3 -m http.server`.** The stdlib server sends
`Last-Modified` and no `Cache-Control`, so browsers apply heuristic freshness
and quietly stop revalidating modules you have edited. That has cost this
project three debugging sessions, one of which produced a module error that was
simply a lie. Do not work around it with `?v=` either — that puts two copies of
the module in the graph and fails differently and worse.

[`index.html`](index.html) is the front door and describes every page. Start
there; this file is the part that is not on a page.

## The one rule

**The rig is judged by eye.** No suite in this repo will tell you whether a
face reads as thinking or as asleep, and every defect this project has actually
found was found by looking: a `G`/`B` viseme collision invisible without a
mouth crop, a compound state that read as *asleep* rather than busy, screenshot
flukes that turned out to be mid-blink frames.

The conformance sweep passing is not evidence a change is good. It catches
dead avatars, NaN leaks and detached SVGs — nothing about how the face *looks*.

## What each page is for

Three groups, matching the three questions.

**Is this rig correct?** — `rig-check.html` (all avatars side by side, one
command, so any difference is the drawing and never the driving),
`contact-sheet.html?face=NAME` (every viseme, emotion, gaze and channel
extreme, plus the mouth-detail row where letter collisions are visible),
`torso-check.html?face=NAME` (the channels that only fail in combination).

**Does this motion read?** — `clip-strip.html` (a gesture as a filmstrip, so
phase relationships between shoulders, brows and mouth are legible in a still),
`body-lab.html` (the mixer driven by hand under a seeded RNG — same seed, same
*t*, same pixels), `expression-lab.html` (clips and beats against real audio),
`pitch-rig-lab.html`.

**Does the mouth match the sound?** — `lipsync-review.html` (ten clips, both
viseme legs, text shown, swap mid-sentence) and `lipsync-eval.html` (the same
clips graded blind, sphinx against phonetic).

`workbench.html` is the freeform one: one avatar and every control there is.
Open it when the question is *what does it look like when…* rather than *is
this correct*.

## Things that are true here and nowhere else

- **`peep` is the rig to author against.** It is `DEFAULT_FACE`. Confirm a
  change on the others; do not chase parity between them. The avatars are
  separate drawings, not renderings of one drawing, so a fix that reads on one
  often means nothing on another.
- **A minimal line face swallows small deltas.** Peep's ink moves whole units
  or not at all, and its resting mouth is *drawn smiling* — so "not smiling"
  has to be authored clearly negative, and concentration has to be brows-*down*
  rather than merely less-up.
- **Param-gate your sampling.** A screenshot at an arbitrary moment catches
  blinks and saccades. Every page here that can be stepped, can be stepped.
- **`peep` has no dark mode and never will.** Inverting a two-value line
  drawing turns the black hair white, which ages the character a decade. Theme
  keys stay; there is no second palette.
- **Idle motion stays low-amplitude and low-frequency.** In a real call the
  screen share and the user's camera are both on, and a jittery avatar costs
  the encoder real bitrate for no communicative gain. Keep gesture oscillation
  under ~1.5 Hz — above it a nod reads as impatience rather than attention. The
  frame-edge hand is the exception: 2.8–3.0 Hz is the social wave band.
- **Clip keyframes are not what the face does — the smoothing between them
  is.** A channel chasing an oscillating target attenuates and lags, so nod
  peaks are authored pre-compensated (a rendered 0.30 is written ~0.55).
  Author a lead or lag *on top of* what the mixer already supplies, not from
  zero. The arithmetic is in
  [docs/internal-mixer.md](../docs/internal-mixer.md).

## Adding an avatar

Read [docs/authoring-a-face.md](../docs/authoring-a-face.md) first — the
process is staged, and the stage that matters is the first one: **the
stakeholder's reference image is the identity spec.** The evidence is one day
apart. `koel` was authored from a written brief, passed every check on every
page here, and was rejected on sight. `myna` was authored reference-first and
was approved. Rig conformance is necessary and is not the bar.

## Headless verification

[`tools/README.md`](tools/README.md) — screenshot a page, sweep every avatar
for conformance, render the standard baseline set and diff two of them
pixel-for-pixel. The diff is a real guarantee rather than a smoke test: the
baseline pages have no live mixer and no randomness, so two renders of the same
tree are byte-identical and any nonzero diff is a real change.

The conformance sweep is not here — it needs no browser, so it runs in
`pnpm test` (`src/conformance.js` holds the assertions). `rig-check.html`'s
**run sweep** button runs that same sweep in real time, on a face you can watch
it happen to.

```sh
pnpm install                          # once, from the repository root; for tools/
```
