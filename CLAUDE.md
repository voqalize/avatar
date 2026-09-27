# Avatar

The public release path for `@voqalize/avatar`. What it is and how a consumer
uses it: [README.md](README.md). **Everything committed here is public.**

> **Only part of this repository is editable here.**
> `packages/avatar/` and the licence are a **build output**: they are developed
> in a private working tree and arrive as one synthesised commit per release,
> carrying an `Exported-From:` trailer naming the private revision. Editing them
> here is editing a build output. The next export overwrites them, silently,
> and no test catches that. A fix is made in the working tree and lands with
> the next release.
>
> `.github/`, the root manifests and the root documents are this repository's
> own; no export writes them. How a release is cut is
> [RELEASING.md](RELEASING.md). If your checkout has a `packages/avatar-3d/`,
> you are in the working tree and none of this applies to you.

## What ships

**`@voqalize/avatar`** (npm, MIT) is a loader and nothing else. It imports the
Voqalize avatar runtime from `https://avatar.voqalize.com` at the version it
was released with. The runtime, the characters and everything about how the
avatar talks to the platform are not in this repository and are not described
here. Keep it that way: a document here does not explain how the avatar works
inside, what it sends or receives, or how a character is made, and it does not
list the characters.

## Running and verifying

```sh
pnpm test         # the loader's tests
pnpm typecheck
```

`pnpm test` runs here as well as in the working tree, and is the gate the export
tool proves a release against before its commit exists.
