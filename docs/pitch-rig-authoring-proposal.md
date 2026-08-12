# Pitch-capable SVG rig: proposed authoring contract

## Why this exists

The original shared rig has a single `head` group. Its `headPitch` channel can
only move that group vertically, which reads as a bob rather than a nod. A
pitch-capable avatar needs the neck to remain behind a separately movable skull
and face surface.

This proposal deliberately adds grouping and calibration, not a library of
per-expression replacement paths. It is a small extension to the existing SVG
authoring interface and preserves all wire events and public rig parameters.

## Required SVG groups

Every pitch-capable face exposes these top-level semantic groups:

| Group | Contents | Existing work |
| --- | --- | --- |
| `neck` | neck fill and neck contour marks, extending behind the collar | **new split** from the old `head` group |
| `skull` | ears, face/head silhouette, jaw-under mark, head-locked hair underlay | **new split** from the old `head` group |
| `features` | brows, eyes, nose, mouth | already required |
| `hair` | foreground hair mass | already required |
| `body` | torso and clothing | already required |

The only new asset operation is splitting the old `head` group. No paths need
to be redrawn for a first migration; the neck must simply run behind the skull
far enough to stay covered during its allowed pitch range.

## Per-avatar calibration

Each face supplies one `pitch` block alongside its existing `POSE` constants:

```js
pitch: {
  headLayers: ['skull', 'features', 'hair'],
  neckLayer: 'neck',
  hinge: { x: 380, y: 620 },
  neckBase: { x: 380, y: 720 },
  headTravel: 1.0,
  neckTravel: 0.22,
  foreshorten: 0.040,
  neckCompress: 0.034,
}
```

This is six geometry numbers, normally obtained by placing the hinge at the
base of the jaw/upper neck and reviewing a `NOD_SLOW` strip at tile size. It is
not a new state machine, clip vocabulary, or backend integration.

## Runtime behaviour

For positive `headPitch`:

1. `skull`, `features`, and `hair` move as one head surface around the hinge.
2. That surface gets a small vertical foreshortening, so its silhouette and
   facial feature spacing change at the nod's arrival.
3. `neck` moves only a fraction as far and compresses toward the collar.
4. `body` remains independent, so its existing torso/shoulder timing can act as
   secondary motion.

Yaw, roll, lipsync, gaze and all existing events continue to use their current
channels. A face without `pitch` retains legacy behaviour, which makes gradual
migration possible.

## Acceptance criteria and limits

- The jaw must meet the neck at all sampled `headPitch` values; no background
  gaps or collar leaks.
- At production tile size, `NOD_SMALL` must read as an acknowledgement and
  `NOD_SLOW` as a deliberate receipt without making the face look squashed.
- The helper cannot produce real out-of-plane 3D rotation. If the group-level
  correction still reads as squash, the next escalation is two authored pitch
  correction shapes (`pitchDown`, `pitchUp`) for skull/lower-face/neck—not more
  keyframe tuning.
