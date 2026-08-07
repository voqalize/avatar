# tools/ — headless render, screenshot and diff

Dev-only tooling (the widget itself stays dependency-free). Each script serves
the repo root itself with `Cache-Control: no-store` — no `serve.py` needed —
loads a page in headless Chromium, and treats any page error, `console.error`
or failed request as fatal: a screenshot of a broken page looks like evidence.

```
cd tools && npm install     # once; puppeteer bundles its own Chromium
```

## The four commands

```sh
node tools/shot.mjs 'demo/rig/contact-sheet.html?face=peep' -o /tmp/peep.png
node tools/shot.mjs 'demo/rig/clip-strip.html?clip=SHRUG' --selector '#g'
    # [-o out.png] [--selector css] [--width N] [--scale N] [--wait ms|expr]

node tools/sweep.mjs
    # the conformance gate: rig-check's sweep() headless. Run before any
    # commit that touches src/. Exit 0 iff ok.

node tools/baseline.mjs [outDir]
    # the standard verification set into .review/baseline-<sha>/ by default:
    # contact sheet + torso sheet + NOD_SMALL/SHRUG filmstrips, per avatar.
    # Avatar list comes from the registry, so new avatars join automatically.

node tools/diff.mjs a.png b.png [-o diff.png] [--threshold 0]
    # changed-pixel count; exit 1 above threshold (default: any change fails).
```

## Workflows

**Prove a refactor changed nothing on screen:**

```sh
node tools/baseline.mjs /tmp/before
# ...refactor...
node tools/baseline.mjs /tmp/after
for f in /tmp/before/*.png; do node tools/diff.mjs "$f" "/tmp/after/$(basename "$f")"; done
```

This is a real guarantee, not a smoke test: the baseline pages render through
direct `apply()` or fixed-tick `ClipPlayer` stepping — no live mixer, no
randomness — and double-rendering the same tree produces pixel-identical
output (verified 12/12 at 2x scale). Any nonzero diff is a real change.

**Iterate on a pose or clip:** render, look at the PNG, adjust, repeat.

```sh
node tools/shot.mjs 'demo/rig/clip-strip.html?clip=NOD_SLOW&face=peep&n=32' --selector '#g' -o /tmp/nod.png
```

**What the baseline cannot see:** live-mixer behavior (idle motion, gaze
saccades, backchannel timing) is intentionally excluded — it is random and
time-based, so it can never be pixel-compared. `sweep.mjs` covers it for
sanity (finite, in-range params); judging its *feel* still needs a human and
a real browser.
