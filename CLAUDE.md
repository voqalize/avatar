# Avatar

The public release path for `@voqalize/avatar`, and the home of the deprecated
`voqalize-avatar`. What each is and how a consumer uses it:
[README.md](README.md). **Everything committed here is public.**

> **Only part of this repository is editable here.**
> `packages/avatar/` is a **build output**: it is developed in a private
> working tree and arrives as one synthesised commit per release, carrying an
> `Exported-From:` trailer naming the private revision. Editing it here is
> editing a build output. The next export overwrites it, silently, and no test
> catches that. A fix to it is made in the working tree and lands with the next
> release.
>
> `packages/avatar-py/`, `apps/server/`, `.github/`, the root manifests and the
> root documents are this repository's own; no export writes them, and
> `scope.yml` fails a pull request that reaches outside
> `packages/avatar-py/`, `apps/server/`, `.github/` and `CONTRIBUTING.md`. How a
> release is cut is [RELEASING.md](RELEASING.md). If your checkout has a
> `packages/avatar-3d/`, you are in the working tree and none of this applies to
> you.

## What ships

- **`@voqalize/avatar`** (npm, MIT) is a loader and nothing else. It imports the
  Voqalize avatar runtime from `https://avatar.voqalize.com` at the version it
  was released with. The runtime, the characters and everything about how the
  avatar talks to the platform are not in this repository and are not described
  here. Keep it that way: a document here does not explain how the avatar works
  inside, what it sends or receives, or how a character is made.
- **`voqalize-avatar`** (PyPI, MIT) is deprecated, and 0.4.1 is its last
  release. `apps/server/`, its demo call, is deprecated with it. A small fix for
  someone still on it is fine; new features are not.

## Running and verifying

```sh
pnpm test                                  # the loader's tests
cd packages/avatar-py && uv run pytest     # the deprecated backend
cd apps/server && uv run --project ../../packages/avatar-py --group server --group dev python -m pytest
```

`pnpm test` runs here as well as in the working tree, and is the gate the export
tool proves a release against before its commit exists.
