# Releasing

Two packages, two pipelines, no long-lived credentials. Both publish from this
repository, which is the only place they ever have.

**The JavaScript arrives here already reviewed.** From 0.4.0 the client and the
renderers are developed in a private working tree — the Blender pipeline that
compiles a 2.5-D character lives there and is not published
([CONTRIBUTING.md](CONTRIBUTING.md)) — and reach this repository as **one commit
per release**, synthesised by a tool in that tree from an explicit list of
paths. The commit carries an `Exported-From:` trailer naming the private revision
it was cut from, which is how the next export finds where the last one stopped.
So `packages/avatar/` and `docs/` here are a published artifact: a fix to either
is made in the working tree and arrives with the next release. The Python package
and `apps/server/` are this repository's own, are never written by an export, and
take pull requests.

| package | registry | tag | workflow | what's in it |
|---|---|---|---|---|
| [`@voqalize/avatar`](https://www.npmjs.com/package/@voqalize/avatar) | npm | `npm-v<semver>` | `release-npm.yml` | `createAvatar` (`.`), `<Avatar>` (`./react`), the widget (`./internal`) |
| [`voqalize-avatar`](https://pypi.org/project/voqalize-avatar/) | PyPI | `py-v<semver>` | `release-pypi.yml` | the pipecat processor, state machine, wire and viseme engine |

Each package releases on its own schedule with its own version number: a
backend fix neither waits on a client release nor drags one along. Each
workflow refuses to publish if its tag disagrees with its manifest, and gates
on its own package's CI (`ci-py.yml`, `ci-js.yml`) and nothing else.

Up to 0.3.0 both shipped together from one `v<semver>` tag. Those tags stay,
and each release also carries a `py-v`/`npm-v` pair on the same commit, so
either package's history reads from one tag family.

**The npm tarball's layout changed in 0.3.0.** The published manifest moved to
`packages/avatar/package.json`, the compiled client is `dist/` rather than
`client/dist/`, and `files` is now `src`, `client`, `dist` — the contract
documents no longer ship inside the package, because a second copy of `docs/`
going stale on npm is worse than a link to a public repository that is current.
The export map is unchanged, so nothing a consumer imports moved.

**0.4.0 adds bytes that are not JavaScript.** `assets/` — the three compiled
2.5-D characters — is in `files`, and so is `LICENSE-CC-BY-4.0`, which covers
them: npm auto-includes a file called `LICENSE` and nothing else, so a second
licence file that is not named in `files` silently does not ship. The manifest
declares `MIT AND CC-BY-4.0` and `three` is an *optional* peer, reachable only
from the three character entry points. Three more export paths, no removals.

## Compatibility

The version numbers do not say which halves work together; the wire does. It
has no version field (`packages/avatar-py/src/voqalize_avatar/messages.py` says
why), and the client ignores a `cmd` it does not know. So:

- **Adding** a command, or an optional field, is backward compatible and ships
  in either package alone. An older client ignores it; a newer client must not
  depend on receiving it from an older server.
- **Changing or removing** one is a breaking wire change. It ships as a new
  minor (a major after 1.0) of *both* packages, released together, and both
  release notes name the pairing.

The wire itself is [docs/contract-wire.md](docs/contract-wire.md). A consumer
picks its pair with its own pins.

## Cutting a release

```sh
# voqalize-avatar: bump packages/avatar-py/pyproject.toml, commit, then
git tag -a py-v0.3.1 -m "voqalize-avatar 0.3.1"
git push origin main py-v0.3.1

# @voqalize/avatar: bump packages/avatar/package.json, commit, then
git tag -a npm-v0.3.1 -m "@voqalize/avatar 0.3.1"
git push origin main npm-v0.3.1
```

The commit you are tagging is usually the export commit for `@voqalize/avatar`
and an ordinary pull-request merge for `voqalize-avatar`; the version bump goes
in whichever of the two it belongs to, and a wire change that breaks both is
what makes the two tags land on one commit.

Push the tag by name. The root `package.json` is the workspace manifest and
publishes nothing; its version is not read by anything and neither guard reads
it.

Each workflow runs its own package's CI gate first — `ci-py.yml` is the backend
tests at both ends of the pipecat range plus the local server's frame contract,
`ci-js.yml` is the widget sweep, the client tests and the client-js floor —
then publishes, then opens a GitHub release whose notes diff against that
package's previous tag.

The PyPI pipeline **builds every wheel before it uploads anything.** Compiling
them is the only step that fails for reasons outside this repository — a
manylinux image, a brew formula, the upstream tarball — and PyPI takes the set
whole, so a platform that fails to build publishes nothing rather than a
release whose macOS users silently have no lipsync.

If a publish fails, fix the cause and re-run: **Actions → release-pypi (or
release-npm) → Run workflow**, and pick the *tag* as the ref.

Pre-release tags work too. `npm-v0.4.0-rc.1` publishes under npm's `next`
dist-tag, never `latest`, so `npm install` does not hand it to everyone. On the
PyPI side the manifest spells a pre-release the PEP 440 way: for
`py-v0.4.0-rc.1`, `pyproject.toml` says `0.4.0rc1`, which is what PyPI stores
whatever you type. The guard derives that spelling from the tag, so a wrong one
fails before anything is uploaded. Only `-alpha.N`, `-beta.N` and `-rc.N` are
accepted; anything else is rejected at the guard rather than at upload.

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
   - Workflow name: `release-pypi.yml`
   - Environment name: `pypi`
3. Save. The first tagged release creates the project and claims the name.

The project already exists, with a publisher registered for the old combined
`release.yml`. PyPI allows several trusted publishers per project, so add one
for `release-pypi.yml` (**Your projects → voqalize-avatar → Manage →
Publishing**) before the first `py-v` tag, and delete the `release.yml` one
once a release has gone through.

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
pnpm install --frozen-lockfile   # runs `prepare`, which compiles packages/avatar/dist
cd packages/avatar && npm publish --access public
```

Then, on the package page: **Settings → Trusted publisher → GitHub Actions**

- Organization or user: `voqalize`
- Repository: `avatar`
- Workflow filename: `release-npm.yml`
- Environment: `npm`

The package's existing trusted publisher names the old combined `release.yml`;
edit it to `release-npm.yml` before the first `npm-v` tag, or that publish is
refused.

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
# .github/workflows/release-npm.yml, npm job
      - run: npm publish --provenance --access public --tag "${{ needs.guard.outputs.dist-tag }}"
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}      # granular access token, "publish"
```

```yaml
# .github/workflows/release-pypi.yml, pypi job
      - uses: pypa/gh-action-pypi-publish@release/v1
        with:
          packages-dir: packages/avatar-py/dist
          password: ${{ secrets.PYPI_API_TOKEN }}
```

## The PyPI side is four artifacts, not one

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
supports a new platform. `packages/avatar-py/native/avatarsync/build.sh` is the local development
loop and publishes nothing; every distributed byte is compiled in that workflow
from the pinned upstream tarball.

Three properties are enforced rather than trusted, because each failure mode is
silent:

- **The wheel tag is derived from the binary**, not declared.
  `packages/avatar-py/scripts/stage_native.py` reads the highest versioned glibc symbol (Linux)
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
