# Releasing

One package, one pipeline, no long-lived credentials.

**The JavaScript arrives here already reviewed.** `packages/avatar/` is
exported from a private working tree as one commit per release, carrying an
`Exported-From:` trailer that names the private revision. So
`@voqalize/avatar`'s version bump belongs in that export commit, and a fix to it
is made over there.

| package | registry | tag | workflow | what's in it |
|---|---|---|---|---|
| [`@voqalize/avatar`](https://www.npmjs.com/package/@voqalize/avatar) | npm | `npm-v<semver>` | `release-npm.yml` | the loader: `createAvatar` (`.`) and `<Avatar>` (`./react`) |

`voqalize-avatar` on PyPI was released from here too, under `py-v<semver>`
tags, until it was deprecated. Its releases and tags stay; its source and its
workflows are in this repository's history. Up to 0.3.0 both packages shipped
together from one `v<semver>` tag, and those tags stay as well.

**What is in the npm tarball, and why.** `files` is `dist`, which is the
compiled loader and the pin naming the runtime it loads. The package has no
dependencies and ships no characters. The runtime and the characters are hosted
on `avatar.voqalize.com`, so what a release pins is the runtime URL in
`dist/pin.js`. The package-contents step in `ci-js.yml` is what holds this here.

## Compatibility

A release of `@voqalize/avatar` is pinned to one runtime, and the runtime is
what talks to the Voqalize platform, so the npm version alone decides what a
browser runs. Before a release is published, its runtime is already on the
host; a release never names a file the host does not serve. Older releases stay
installable and keep working.

## Cutting a release

```sh
# the export commit carries the version bump; tag it
git tag -a npm-v0.5.0 -m "@voqalize/avatar 0.5.0"
git push origin main npm-v0.5.0
```

Push the tag by name. The root `package.json` is the workspace manifest and
publishes nothing; its version is not read by anything.

The workflow runs `ci-js.yml` first (the loader's tests, its packed install and
the client-js floor), then publishes, then opens a GitHub release whose notes
diff against the previous `npm-v` tag. If a publish fails, fix the cause and
re-run: **Actions → release-npm → Run workflow**, and pick the *tag* as the
ref.

Pre-release tags work too. `npm-v0.5.0-rc.1` publishes under npm's `next`
dist-tag, never `latest`, so `npm install` does not hand it to everyone. Only
`-alpha.N`, `-beta.N` and `-rc.N` are accepted; anything else is rejected at
the guard rather than at upload.

## How publishing is trusted

No credential is stored in this repository. npm mints a short-lived OIDC token
for *this repo running this workflow*, which cannot be copied out, cannot be
used from a fork, and expires in minutes.

| registry | trusted publisher | GitHub environment |
|---|---|---|
| npm | `voqalize/avatar`, workflow `release-npm.yml` | `npm` |

**A trusted publisher is keyed to the exact workflow filename**, and that is the
one thing here that has actually bitten: the entry was first registered against
a combined `release.yml` that predated the split, and a publish under a
filename the registry does not name is refused at upload, after the tag is
pushed and after CI has gone green. Renaming the release workflow means editing
the registry entry in the same breath. The environment name is pinned by the
entry too.

npm additionally attaches a **provenance attestation** — a signed statement
linking the tarball to this workflow run and this commit, which is the only way
a consumer can check that what they installed was built from what they can read.
npm's first publish was manual, because npm has no pending-publisher
equivalent, and *Require two-factor authentication and disallow tokens* in the
org settings is what closes the door that left open.

### Fallback: a token

If trusted publishing is blocked, the workflow takes a classic token with a
two-line change. Prefer OIDC — a token in `secrets` is a credential that
outlives the person who created it.

```yaml
# .github/workflows/release-npm.yml, npm job
      - run: npm publish --provenance --access public --tag "${{ needs.guard.outputs.dist-tag }}"
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}      # granular access token, "publish"
```
