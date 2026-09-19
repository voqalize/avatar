# The 2.5-D characters

Three characters ship as compiled binaries: **`tara`**, **`tushar`** and
**`tanya`**. Each is a complete `createAvatar` module, imported the same way as
any other avatar in this package, and driven by the same wire — the same states,
the same actions, the same cue-synced mouth
([contract-wire.md](contract-wire.md)).

```js
import { createAvatar } from '@voqalize/avatar/avatars/tara';
// or: @voqalize/avatar/avatars/tushar
//     @voqalize/avatar/avatars/tanya

const avatar = createAvatar({ mount: el, client: pipecatClient });
```

Nothing above the renderer changes. They are not a second contract, a second
lifecycle or a second vocabulary: the mixer that does states, gaze, blinks,
idle motion, clips and per-channel smoothing for the SVG faces does all of it
here too, and the only thing that is different is what draws the last frame.
A server that has never heard of these characters drives one correctly.

## What they are

A photograph of a face, projected onto shallow geometry, with the parts that
have to *move* built as geometry rather than painted: the eyes, the teeth and
the lip line. Hence 2.5-D rather than 3-D — there is no full head behind the
face, and the camera does not orbit.

None of the three depicts a real person. Each begins as an image from a
generative model and is licensed as artwork, which is what makes it shippable at
all — see **Licence** below.

## Three.js is an optional peer

```sh
npm install three        # >=0.180 <0.187
```

`three` is declared as an *optional* peer dependency, and the import that needs
it lives behind these three entry points. An SVG or Canvas consumer never
downloads it, and installing this package without it is not a warning to
suppress — it is the expected case.

## The asset is fetched at runtime

Each character is one `.glb` in the package's `assets/` directory, between 0.5
and 0.8 MB, resolved as

```js
new URL('../../assets/tara.glb', import.meta.url)
```

— deliberately that spelling and not a bundler's asset import, because it is the
one form that survives Vite, webpack, Rollup, esbuild, a plain `tsc` output and
a browser loading the module directly. What it asks of your build is that it can
emit or serve a `.glb` sitting inside a dependency: bundlers do this by default
for `new URL(…, import.meta.url)`, and a hand-rolled static server needs the
file to be reachable rather than tree-shaken away.

The file is fetched when the avatar mounts, not when the module is imported.
`onReady` fires once it is in the scene, which is for a capture tool; a consumer
does not need it.

## Size, and what it costs

The characters are drawn, judged and budgeted at a **400 × 300 CSS tile at device
pixel ratio 2** (`SHIPPING_SURFACE`) — the size a bot's tile actually is in a
call. Mount one smaller and it is still right; mount one much larger and it is
a 400-pixel-wide face scaled up, because the texture it is wearing has that many
pixels of detail in it and no more.

The drawing buffer is clamped to that ceiling whatever the mount size, so a
full-screen tile does not quietly ask a laptop for four times the fill rate. Each
character is under 11,000 triangles, one draw call per mesh, no lights and no
shadow pass; the atlases travel inside the file.

## What they can do that a face cannot

The head turns. Its envelope is `HEAD_DEG` — **15° of yaw, 24° of pitch, 8° of
roll** — and it is a measured limit rather than a taste: past it the flat
projection stops reading as a head that turned. The library keeps every head
motion inside it, so there is nothing to configure and nothing to get wrong.

A pose the head *holds* is a stricter case than a motion that passes through an
angle and returns, and it has its own per-character numbers — roughly a third of
the envelope, because the eye behind a flat projection never foreshortens and a
sustained turn is where that shows. They are measured by eye and recorded in
`packages/avatar/client/three/motion-limits.json` (exported as `MOTION_LIMITS`), and the
characters apply them themselves: nothing to set here either.

They also answer to more action ids than the core vocabulary has words for. A
server asks for `ACKNOWLEDGE` and is never wrong; a server that knows one of
these is mounted can ask for a particular *kind* of nod instead, because the
wire's action id is open and an unknown one is ignored in silence. The
declaration of what a mounted character answers to is its `supports` export
([design-avatar-interface.md](design-avatar-interface.md)).

## What you cannot do

There is no pose API, no channel access, no per-character tuning beyond the
three gains every avatar takes (`mouthGain`, `gestureGain`, `motionGain`), and no
renderer interface. The rig, its calibration and the pipeline that compiles a
character are implementation details, and the pipeline is not published. A
character is a finished binary here, the same way an SVG face is a finished
drawing.

They also have no arms, which is the library's oldest standing constraint and
not an omission ([README.md](../README.md)).

## Licence

**The three `.glb` files are artwork, licensed
[CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)** — separately from the
MIT code around them, and the package manifest declares the pair as
`MIT AND CC-BY-4.0`. Using one in your product is fine, including commercially;
it asks for a credit:

> Character art © 2026 Voqalize, CC-BY 4.0.

Each file carries the same statement inside it, in the glTF `asset.copyright`
field, so the terms survive the file being copied out of `node_modules`. The full
text is `LICENSE-CC-BY-4.0`, and the package's own `assets/README.md` is the
short version.
