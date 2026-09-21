# The character binaries

The 2.5-D characters, one compiled file each:

| file | character | what it is |
|---|---|---|
| `tara.glb` | tara | the first; shallow geometry under a projected portrait |
| `tushar.glb` | tushar | the second, her scripts with his landmarks |
| `tanya.glb` | tanya | the third, built from supplied reference images |
| `tess.glb` | tess | the fourth, from a single supplied reference sheet |

They are loaded for you. `@voqalize/avatar/avatars/tara` resolves the file beside
itself and hands it to a loader; you never name a path, and the only reason to
know these are here is the licence below. `three` is an *optional* peer of this
package, so importing a drawing instead of a character downloads none of this.

Each file carries geometry, one morph target per pose channel, and its texture
atlases as WebP — which is most of the bytes, because the atlases are
photographs. **They are build outputs. Do not hand-edit one**; there is nothing
in this directory to regenerate it from, and the next release overwrites it.

## Licence: CC-BY 4.0

The rest of this package is MIT. These files are artwork, not code, so they
carry an artwork licence: **Creative Commons Attribution 4.0 International**, the
full text in `LICENSE-CC-BY-4.0` at the package root. Use them in a product,
commercially, modified or retextured, and credit us:

> Character art © 2026 Voqalize, CC-BY 4.0.

That is the whole obligation. There is no non-commercial clause, no
no-derivatives clause — the renderer's entire job is deforming these meshes, so a
no-derivatives licence would forbid the only use there is — and no share-alike, so
retexturing a character does not oblige you to publish the result.

The licence is also written inside each file, in the glTF copyright field. A
binary gets copied out of a dependency tree and passed around; a string in the
file is the only way terms travel with it.

## The faces are synthetic

Every character began as an image from a generative model — OpenAI's and
Google's — and **none of them depicts a real person**. Any resemblance to one is
coincidence, not a likeness, and there are no personality rights attached to any
of them. What we did with that image is ours: the geometry, the measured
landmarks, the projection, the relighting and the authored morph targets are all
human work, and they are the substance of what is licensed here.

The tooling that turns a portrait into one of these files is not published.
