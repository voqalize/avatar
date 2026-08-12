# Rive rig proof

Studio now has a temporary `rive-bob` avatar option. It uses the downloaded
`28111-53105-bob-lip-sync-character-system-in-rive.riv` file through the Rive
canvas runtime and keeps the existing `AvatarRig` contract unchanged:

```ts
apply({ pose, hand })
destroy()
```

The asset was selected from the downloaded set because its embedded names show
the closest semantic surface to our rig: `Viseme X` and `Viseme A`–`H`,
`pupils_X/Y`, `Head_Rotation_X/Y`, eyebrow controls, `mouth_mood`, breath, and
the `Lip Sync`, `Pupils`, and `Poses` state machines. The other candidates are
primarily timeline/idle/gesture assets or expose less of the speech surface.

The adapter discovers the actual state-machine input names and types after the
file loads and prints the report as `Rive Bob contract` in the Studio console.
Unknown controls are safely ignored, so the bridge remains compatible with
the downloaded asset rather than pretending it has the full SVG channel set.

Run the experiment with:

```sh
npm run studio:dev
```

Choose `rive-bob` in the Studio avatar selector, then use Rig review, Rig
visemes, and Gesture review. The adapter maps the existing pose vector to the
asset's numeric inputs and maps the semantic hand frame to Bob's private pose
selector. The downloaded file is not modified; `demo/rive/bob.riv` is only a
symlink to the Downloads copy.

This proves integration feasibility, not visual parity. The immediate next
authoring pass would be to replace the heuristic viseme selector with exact
input ranges from the runtime report and decide whether Bob's pose machine can
provide sufficiently readable hand actions for production.
