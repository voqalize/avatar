# The character binaries

The 2.5-D characters, one compiled file each: `tara.glb`, `tushar.glb`,
`tanya.glb`, `tess.glb`, `tanvi.glb`.

**They are build outputs. Do not hand-edit one.**

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

## What in these files is not ours

The difference is the mesh. Every character here carries one *canonical*
topology that other people published, fitted to that character's face — the
geometry is no longer authored per face, which is what makes a landmark table
the only thing that distinguishes one file from the next. **The obligations
below travel with every file, so they are named here and again in each one's
glTF copyright field.** Neither one restricts what the rest of this package is
licensed for.

- **The face shell is MediaPipe's canonical face mesh** — Copyright The
  MediaPipe Authors, **Apache License 2.0**, the full text in
  `LICENSE-APACHE-2.0` at the package root. **Modified**: the triangles closing
  the eyes and the lips are removed so a blink and a viseme have an opening to
  be; every edge is subdivided once; rings are appended outside its face oval to
  reach the hair and the neck; and every vertex is moved onto landmarks measured
  from a photograph, which is what makes it a face rather than the reference
  head. What survives unmodified is the topology — which vertex is which point,
  and what joins them.
- **The dental arch is fitted from ICT-FaceKit** — Copyright (c) 2020 USC
  Institute for Creative Technologies, **MIT**, the same terms as this package's
  own `LICENSE`. What was taken is a measurement rather than geometry: the
  curvature of its upper arch, read off its generic head and carried here as the
  coefficients of a polynomial. None of its mesh is in this file.

## The faces are synthetic

Every character began as an image from a generative model — OpenAI's and
Google's — and **none of them depicts a real person**. Any resemblance to one is
coincidence, not a likeness, and there are no personality rights attached to any
of them. What we did with that image is ours: the geometry, the measured
landmarks, the projection, the relighting and the authored morph targets are all
human work, and they are the substance of what is licensed here.

The tooling that turns a portrait into one of these files is not published.
