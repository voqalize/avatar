// The driver's pose vocabulary, as data.
//
// `drivers.js` emits { poseName: weight } maps and nothing else; a name it asks
// for that the rig does not have is silently dropped by `rig.js`, so a typo
// shows up as a feature that simply never animates. That failure mode is why
// this file exists: the driver builds its names from these lists, and the
// authoring-side checker (`author/validate.mjs`) validates against the same
// lists. One source, so the two cannot drift.
//
// 73 required pose names + 3 optional `wardrobe/*` + 9 optional `rhubarb/*`
// + 4 optional `gaze/*`, and 6 track names.

export const VISEMES = [
  'viseme/100 - silence', 'viseme/101 - A,AI', 'viseme/102 - a', 'viseme/103 - ae',
  'viseme/104 - O', 'viseme/105 - i', 'viseme/107 - p,b,m', 'viseme/108 - L',
  'viseme/109 - v,f', 'viseme/110 - U', 'viseme/112 - o', 'viseme/113 - s,z',
  'viseme/114 - ol', 'viseme/115 - sh,tsh,zh, dzh', 'viseme/116 - th', 'viseme/118 - kgn',
];

// The six eye states the expression x blink cross-fade can reach.
export const eyePose = (n) => `eye/eyes-${n}`;
export const EYE_STATES = ['idle_closed', 'idle_wide', 'happy', 'happy_closed', 'sad', 'sad_closed'];
export const EYE_POSES = EYE_STATES.map(eyePose);

// Six feature axes, each with a +100 and a -100 extreme.
export const MORPH_AXES = ['head', 'lips', 'nose', 'brows', 'eyes', 'distance'];
export const MORPH_POSES = MORPH_AXES.flatMap((a) => [`morph/${a}_100`, `morph/${a}_-100`]);

// The iris hue ladder: 37 steps of 10 degrees, zero-padded to three digits.
// The driver holds one or two neighbouring rungs and the runtime crossfades
// them solid-to-solid in RGBA.
export const hueKey = (n) => `hue/${String(n).padStart(3, '0')}`;
export const HUE_STEP = 10;
export const HUE_LADDER = Array.from({ length: 360 / HUE_STEP + 1 }, (_, i) => hueKey(i * HUE_STEP));

// Two overlays on top of whatever hue is showing. They pull in opposite
// directions: saturation-0 drains colour, brightness-0 lifts a black overlay.
export const IRIS_SATURATION = 'iris/eyes-saturation-0';
export const IRIS_BRIGHTNESS = 'iris/eyes-brightness-0';
export const IRIS_POSES = [IRIS_SATURATION, IRIS_BRIGHTNESS];

// Optional by design: these three only fire when state.hair / suit / glassesOff
// are raised, and they exist for the bitmap-backed mascot. A hand-authored
// vector avatar that covers 73 of 76 names is complete, not incomplete.
export const WARDROBE_HAIR = 'wardrobe/hair-blonde';
export const WARDROBE_SUIT = 'wardrobe/suit-black';
export const WARDROBE_GLASSES = 'wardrobe/glasses-off';
export const WARDROBE_POSES = [WARDROBE_HAIR, WARDROBE_SUIT, WARDROBE_GLASSES];

// Optional the same way: GAZE. The four names are the extremes of the driver's
// `pupilX`/`pupilY` channels (-1..1, + x = the viewer's right, + y = down), so
// a mixer reaches an arbitrary gaze by holding ONE of each pair at |channel|
// and the two axes compose. They are named for what a VIEWER sees, not for
// whose left it is.
//
// Optional because an eye that cannot look anywhere but forward is still a
// complete face — ink and facet do not implement these and are not incomplete
// — and because a rig that does implement them costs four poses to say so.
export const GAZE_DIRS = ['left', 'right', 'up', 'down'];
export const GAZE_POSES = GAZE_DIRS.map((d) => `gaze/${d}`);

// The driver's boot state, as data — and the only three numbers in it that any
// AUTHORING-time code has to know. `drivers.js` sets these three on
// `this.state` (drivers.js:34-36); it deliberately does NOT import them, so
// this list is a mirror and has to be kept in step by hand.
//
// They are here because they are load-bearing on the far side of the pipeline:
// the base iris paint in a rig file is solved backwards from where these
// defaults should land (see `author/rig.mjs` solveIrisBase), so changing one of
// them silently changes the colour of every avatar's eyes.
export const DRIVER_DEFAULTS = { hue: 200, saturation: 0.15, brightness: 0.5 };

// Tracks, not poses. `breathing` and `subtle` run forever under the ambient
// amplitude; the four idle one-shots are shuffled, so every one of them must
// start and end on the exact rest pose.
export const AMBIENT_TRACKS = ['breathing', 'subtle'];
export const IDLE_CLIPS = ['idle 1', 'idle 2', 'idle 3', 'idle 4'];
export const TRACKS = [...AMBIENT_TRACKS, ...IDLE_CLIPS];

// --- mouth part: the Rhubarb letters ---------------------------------------
// The nine-letter Rhubarb alphabet (A–H plus X for silence), which is the
// alphabet voqalize's lip-sync speaks and the condensation of the Preston Blair
// set that every open-source aligner already targets. A rig gets these when its
// mouth is `author/parts/mouth.mjs` — they are baked straight from that
// contract's own `VISEME_SHAPES` (author/parts/mouth-tables.mjs) with no
// hand-tuning, so they are a PROOF that the channel mapping lands on the right
// nine shapes as much as they are a vocabulary.
//
// OPTIONAL, and they stay optional: `ink` and `facet` still hold their mouths
// inline against the pre-channel keys and have no way to bake them, and the
// 16-code mascot set above remains the required one for every rig.
export const RHUBARB_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'];
export const RHUBARB_POSES = RHUBARB_LETTERS.map((l) => 'rhubarb/' + l);

export const REQUIRED_POSES = [...VISEMES, ...EYE_POSES, ...MORPH_POSES, ...HUE_LADDER, ...IRIS_POSES];
export const OPTIONAL_POSES = [...WARDROBE_POSES, ...RHUBARB_POSES, ...GAZE_POSES];
