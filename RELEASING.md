# Releasing

Two packages, one tag, no long-lived credentials.

| package | registry | what's in it |
|---|---|---|
| [`@voqalize/avatar`](https://www.npmjs.com/package/@voqalize/avatar) | npm | the widget (`src/`) plus the `./pipecat` and `./react` subpaths |
| [`voqalize-avatar`](https://pypi.org/project/voqalize-avatar/) | PyPI | the pipecat processor, state machine, wire and viseme engine |

They version in lockstep and ship together. They are two ends of one wire
format — the widget renders what the backend sends — so a version pair that can
drift is a protocol mismatch waiting to be debugged in production. `.github/workflows/release.yml`
refuses to publish either half if the tag disagrees with either manifest.

## Cutting a release

```sh
# 1. bump both manifests to the same version
#      package.json        "version": "0.2.0"
#      py/pyproject.toml   version = "0.2.0"
# 2. commit, then
git tag v0.2.0
git push origin main --follow-tags
```

That is all. The workflow runs the full CI gate first (widget sweep, client
tests, backend tests at both ends of the pipecat range), then publishes npm and
PyPI in parallel, then opens a GitHub release with generated notes.

If one half fails and the other succeeded, fix the cause and re-run: **Actions →
release → Run workflow**, and pick the *tag* as the ref. The successful half
will fail with "already published", which is the correct and harmless outcome.

Pre-release tags work too — `v0.2.0-rc.1` matches the trigger, and npm will tag
it `latest` unless you add `--tag next` to the publish step, so use them
deliberately.

## One-time setup

Three things, none of which store a secret in this repository. Both registries
accept a short-lived OIDC token that GitHub mints for *this repo running this
workflow*, which is strictly better than a token in `secrets`: it cannot be
copied out, cannot be used from a fork, and expires in minutes.

### 1. GitHub environments

**Settings → Environments**, create two, named exactly:

- `npm`
- `pypi`

Leave them unprotected for now, or add a required reviewer on both if you want
a human to approve every publish. The names matter — both registries pin their
trust to the environment name below.

### 2. PyPI

PyPI supports a *pending* publisher, so this can be done before the project
exists.

1. Log in as the account that should own the project → **Your projects → Publishing**
   → *Add a new pending publisher*.
2. Fill in:
   - PyPI Project Name: `voqalize-avatar`
   - Owner: `voqalize`
   - Repository name: `avatar`
   - Workflow name: `release.yml`
   - Environment name: `pypi`
3. Save. The first tagged release creates the project and claims the name.

Move the project into a PyPI **organization** afterwards if you want the
`voqalize` name held there too — PyPI has no scopes, so `voqalize-` is the
namespace and holding the org name is what stops someone else using it.

### 3. npm

npm has no pending-publisher equivalent, so the very first publish is manual
and everything after it is automatic.

```sh
# a. create the org that owns the scope — free for public packages
#    https://www.npmjs.com/org/create   ->   name: voqalize
# b. from a clean checkout of the tag, as a member of that org:
npm login
npm ci
npm publish --access public
```

Then, on the package page: **Settings → Trusted publisher → GitHub Actions**

- Organization or user: `voqalize`
- Repository: `avatar`
- Workflow filename: `release.yml`
- Environment: `npm`

From the next tag on, the workflow publishes with no credential and attaches a
**provenance attestation** — a signed statement linking the tarball to this
workflow run and this commit, which is the only way a consumer can check that
what they installed is built from what they can read. Turn on *Require two-factor
authentication and disallow tokens* in the org settings once this works; it
closes the door the manual publish left open.

### Fallback: tokens

If trusted publishing is blocked for either registry, the workflows take
classic tokens with a two-line change each. Prefer OIDC — a token in `secrets`
is a credential that outlives the person who created it.

```yaml
# .github/workflows/release.yml, npm job
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}      # granular access token, "publish"
```

```yaml
# .github/workflows/release.yml, pypi job
      - uses: pypa/gh-action-pypi-publish@release/v1
        with:
          packages-dir: py/dist
          password: ${{ secrets.PYPI_API_TOKEN }}
```

## The PyPI side is five artifacts, not one

`voqalize-avatar` publishes one wheel per platform — each carrying the
`avatarsync` aligner and its 56 MB acoustic model, hence ~44 MB apiece — plus a
source-only sdist. `pip install voqalize-avatar` gives a working aligner with no
path, no environment variable and no second artifact to ship. That is the whole
reason the wheels are platform-specific.

| artifact | tag as of the last build |
|---|---|
| Linux x86-64 | `py3-none-manylinux_2_25_x86_64` |
| Linux aarch64 | `py3-none-manylinux_2_25_aarch64` |
| macOS arm64 | `py3-none-macosx_11_0_arm64` |
| sdist | source only; installs, runs, no visemes |

There is deliberately **no Intel macOS wheel**. The aligner builds and runs there
perfectly well; what does not work is installing the package at all, because
`pipecat-ai` requires `onnxruntime` and onnxruntime publishes no macOS x86-64
wheel. Uploading one would advertise a platform where `pip install` cannot
resolve. The reasoning is in `wheels.yml` beside the row it replaced.

The linux tags are *reported*, not chosen: the build runs in the
`manylinux_2_28` image, but the binary's highest versioned glibc symbol is 2.25,
so that is the floor it actually earned and the tag it gets. Do not edit this
table to declare something — read it off a build.

`py3-none-<platform>`: the Python is pure and the payload is not, so one wheel
serves every supported interpreter on that platform.

[`.github/workflows/wheels.yml`](.github/workflows/wheels.yml) is **canonical**
and its matrix is the supported-platform list — adding a row is how this project
supports a new platform. `native/avatarsync/build.sh` is the local development
loop and publishes nothing; every distributed byte is compiled in that workflow
from the pinned upstream tarball.

Three properties are enforced rather than trusted, because each failure mode is
silent:

- **The wheel tag is derived from the binary**, not declared.
  `py/scripts/stage_native.py` reads the highest versioned glibc symbol (Linux)
  or the recorded deployment target (macOS). A binary built somewhere newer
  moves its own tag instead of installing onto machines it cannot run on.
- **A dynamically linked libstdc++ is rejected outright.** A wheel tag can only
  express a glibc floor, so that dependency would be invisible to pip and fail
  at the user's first sentence. `build.sh` links it statically; staging refuses
  a binary where it did not take.
- **A payload-free wheel fails the build.** Skip staging and hatchling happily
  produces a 64 KB `py3-none-any` wheel that publishes, installs everywhere and
  has no lipsync. Both the wheel job and the publish job refuse it.

Each wheel is also installed into a clean venv and made to emit real cues before
it is uploaded — the artifact is tested, not the tree it came from.
