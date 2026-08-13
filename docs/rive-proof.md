# Rive rig proof

Experimental, and a feasibility proof rather than a shipped avatar: Studio has a
`rive-bob` option that drives a Rive file through the unchanged
[rig contract](contract-rig.md) — `apply({pose, hand})` and `destroy()`.
`studio/src/rive-bob.ts` is the whole adapter.

```sh
npm run studio:dev      # choose `rive-bob` in the Studio avatar selector
```

The asset (`demo/rive/bob.riv`, a checked-in copy of a downloaded community
file) was picked because its embedded names sit closest to our rig's semantic
surface: `Viseme X` and `Viseme A`–`H`, `pupils_X/Y`, `Head_Rotation_X/Y`, brow
controls, `mouth_mood`, breath, and the `Lip Sync`, `Pupils` and `Poses` state
machines. The other candidates are timeline/idle/gesture assets that expose less
of the speech surface.

The adapter discovers the actual state-machine input names and types after the
file loads and prints them as `Rive Bob contract` in the Studio console. Unknown
controls are ignored, so the bridge stays compatible with the asset it was given
rather than pretending it has the full SVG channel set. The semantic hand frame
maps onto Bob's private pose selector.

**This proves integration feasibility, not visual parity.** The next authoring
pass would replace the heuristic viseme selector with exact input ranges from
the runtime report, and decide whether Bob's pose machine can carry readable
hand actions at all.
